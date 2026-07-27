-- Deux joueurs doivent confirmer la fin de manche avant que le serveur avance.
alter table public.elite_pixel_room_players
  add column if not exists round_ready boolean not null default false;

create or replace function public.elite_pixel_get_state(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  v_seat := public.elite_pixel_member_seat(p_room_id);

  update public.elite_pixel_room_players
  set presence_started_at = case
        when last_seen < v_now - interval '8 seconds' then v_now
        else presence_started_at
      end,
      last_seen = v_now
  where room_id = p_room_id
    and user_id = auth.uid()
    and last_seen < v_now - interval '4 seconds';

  select jsonb_build_object(
    'room', to_jsonb(r),
    'puzzle', (
      select jsonb_build_object(
        'id', puzzle.id,
        'cards', puzzle.cards,
        'model', to_jsonb(puzzle.model),
        'solution', case
          when r.phase in ('reveal', 'match_finished') then jsonb_build_object(
            'trio', to_jsonb(puzzle.solution_trio),
            'rotations', to_jsonb(puzzle.solution_rotations)
          )
          else null
        end
      )
      from public.elite_pixel_puzzles puzzle
      where puzzle.id = r.puzzle_id
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', player.seat,
        'display_name', player.display_name,
        'ready', player.ready,
        'round_ready', player.round_ready,
        'joined_at', player.joined_at,
        'last_seen', player.last_seen
      ) order by player.seat)
      from public.elite_pixel_room_players player
      where player.room_id = r.id
    ), '[]'::jsonb),
    'seat', v_seat,
    'server_now', v_now
  ) into v_result
  from public.elite_pixel_rooms r
  where r.id = p_room_id;

  if v_result is null then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_result;
end;
$$;

create or replace function public.elite_pixel_next_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_room public.elite_pixel_rooms%rowtype;
  v_puzzle_id uuid;
  v_all_ready boolean;
  v_now timestamptz := clock_timestamp();
begin
  v_seat := public.elite_pixel_member_seat(p_room_id);
  select * into v_room
  from public.elite_pixel_rooms
  where id = p_room_id
  for update;

  if v_room.phase not in ('reveal', 'match_finished') then
    raise exception 'ROUND_NOT_FINISHED' using errcode = 'P0001';
  end if;

  update public.elite_pixel_room_players
  set round_ready = true, last_seen = v_now
  where room_id = p_room_id and seat = v_seat;

  select count(*) = 2 and bool_and(round_ready)
  into v_all_ready
  from public.elite_pixel_room_players
  where room_id = p_room_id;

  if not coalesce(v_all_ready, false) then
    update public.elite_pixel_rooms
    set version = version + 1, updated_at = v_now
    where id = p_room_id;
    return;
  end if;

  select id into v_puzzle_id
  from public.elite_pixel_puzzles
  where id <> coalesce(v_room.puzzle_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by random()
  limit 1;

  if v_puzzle_id is null then
    raise exception 'PUZZLE_BANK_EMPTY' using errcode = 'P0001';
  end if;

  update public.elite_pixel_rooms
  set status = 'active', phase = 'shared', active_player = null,
      round_number = case when v_room.phase = 'match_finished' then 1 else round_number + 1 end,
      scores = case when v_room.phase = 'match_finished' then array[0, 0]::smallint[] else scores end,
      puzzle_seed = floor(random() * 2147483646)::bigint + 1,
      puzzle_id = v_puzzle_id,
      phase_deadline = v_now + interval '60 seconds',
      total_deadline = v_now + interval '5 minutes',
      round_winner = null, last_reason = null, finished_at = null,
      version = version + 1, updated_at = v_now
  where id = p_room_id;

  update public.elite_pixel_room_players
  set round_ready = false
  where room_id = p_room_id;
end;
$$;

revoke all on function public.elite_pixel_get_state(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_next_round(uuid) from public, anon, authenticated;
grant execute on function public.elite_pixel_get_state(uuid) to authenticated;
grant execute on function public.elite_pixel_next_round(uuid) to authenticated;

