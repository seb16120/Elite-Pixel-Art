
-- Elite Pixel Art · 1v1 online beta
-- Objects are deliberately prefixed to remain isolated from Bingo and Otrio.

create table if not exists public.elite_pixel_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  score_limit smallint not null default 3 check (score_limit between 1 and 9),
  round_number smallint not null default 1 check (round_number > 0),
  phase text not null default 'waiting' check (phase in ('waiting', 'shared', 'answer', 'exclusive', 'reveal', 'match_finished')),
  active_player smallint check (active_player in (1, 2)),
  phase_deadline timestamptz,
  total_deadline timestamptz,
  puzzle_seed bigint,
  scores smallint[] not null default array[0, 0]::smallint[] check (cardinality(scores) = 2),
  round_winner smallint check (round_winner in (1, 2)),
  last_reason text,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.elite_pixel_room_players (
  room_id uuid not null references public.elite_pixel_rooms(id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 2 and 20),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, seat),
  unique (room_id, user_id)
);

create index if not exists elite_pixel_room_players_user_idx
  on public.elite_pixel_room_players (user_id, room_id);

alter table public.elite_pixel_rooms enable row level security;
alter table public.elite_pixel_room_players enable row level security;

create or replace function public.elite_pixel_is_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.elite_pixel_room_players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function public.elite_pixel_member_seat(p_room_id uuid)
returns smallint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select seat into v_seat
  from public.elite_pixel_room_players
  where room_id = p_room_id and user_id = auth.uid();

  if v_seat is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;
  return v_seat;
end;
$$;

drop policy if exists elite_pixel_rooms_select_member on public.elite_pixel_rooms;
create policy elite_pixel_rooms_select_member
  on public.elite_pixel_rooms for select to authenticated
  using (public.elite_pixel_is_member(id));

drop policy if exists elite_pixel_players_select_member on public.elite_pixel_room_players;
create policy elite_pixel_players_select_member
  on public.elite_pixel_room_players for select to authenticated
  using (public.elite_pixel_is_member(room_id));

create or replace function public.elite_pixel_random_code()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i integer;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
  end loop;
  return v_code;
end;
$$;

create or replace function public.elite_pixel_create_room(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room_id uuid;
  v_code text;
  v_name text := left(regexp_replace(trim(p_display_name), '\s+', ' ', 'g'), 20);
  i integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_name) < 2 then raise exception 'INVALID_NAME' using errcode = 'P0001'; end if;

  for i in 1..20 loop
    v_code := public.elite_pixel_random_code();
    begin
      insert into public.elite_pixel_rooms (code, host_id)
      values (v_code, auth.uid())
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  if v_room_id is null then raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001'; end if;

  insert into public.elite_pixel_room_players (room_id, seat, user_id, display_name)
  values (v_room_id, 1, auth.uid(), v_name);

  return jsonb_build_object('room_id', v_room_id, 'code', v_code, 'seat', 1);
end;
$$;

create or replace function public.elite_pixel_join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.elite_pixel_rooms%rowtype;
  v_existing smallint;
  v_name text := left(regexp_replace(trim(p_display_name), '\s+', ' ', 'g'), 20);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_name) < 2 then raise exception 'INVALID_NAME' using errcode = 'P0001'; end if;

  select * into v_room
  from public.elite_pixel_rooms
  where code = upper(trim(p_code))
  for update;

  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;

  select seat into v_existing from public.elite_pixel_room_players
  where room_id = v_room.id and user_id = auth.uid();
  if v_existing is not null then
    return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'seat', v_existing);
  end if;

  if v_room.status <> 'waiting' then raise exception 'ROOM_ALREADY_STARTED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.elite_pixel_room_players where room_id = v_room.id and seat = 2) then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  insert into public.elite_pixel_room_players (room_id, seat, user_id, display_name)
  values (v_room.id, 2, auth.uid(), v_name);
  update public.elite_pixel_rooms set version = version + 1, updated_at = now() where id = v_room.id;
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'seat', 2);
end;
$$;

create or replace function public.elite_pixel_get_state(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_result jsonb;
begin
  v_seat := public.elite_pixel_member_seat(p_room_id);
  update public.elite_pixel_room_players
  set last_seen = clock_timestamp()
  where room_id = p_room_id and user_id = auth.uid()
    and last_seen < clock_timestamp() - interval '4 seconds';

  select jsonb_build_object(
    'room', to_jsonb(r),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', p.seat,
        'display_name', p.display_name,
        'ready', p.ready,
        'joined_at', p.joined_at,
        'last_seen', p.last_seen
      ) order by p.seat)
      from public.elite_pixel_room_players p where p.room_id = r.id
    ), '[]'::jsonb),
    'seat', v_seat,
    'server_now', clock_timestamp()
  ) into v_result
  from public.elite_pixel_rooms r
  where r.id = p_room_id;

  if v_result is null then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  return v_result;
end;
$$;

create or replace function public.elite_pixel_set_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.elite_pixel_rooms%rowtype;
begin
  perform public.elite_pixel_member_seat(p_room_id);
  select * into v_room from public.elite_pixel_rooms where id = p_room_id for update;
  if v_room.status <> 'waiting' then raise exception 'ROOM_ALREADY_STARTED' using errcode = 'P0001'; end if;

  update public.elite_pixel_room_players
  set ready = p_ready, last_seen = clock_timestamp()
  where room_id = p_room_id and user_id = auth.uid();

  if (select count(*) = 2 and bool_and(ready) from public.elite_pixel_room_players where room_id = p_room_id) then
    update public.elite_pixel_rooms
    set status = 'active', phase = 'shared', puzzle_seed = floor(random() * 2147483646)::bigint + 1,
        phase_deadline = clock_timestamp() + interval '60 seconds',
        total_deadline = clock_timestamp() + interval '5 minutes',
        active_player = null, round_winner = null, last_reason = null,
        version = version + 1, updated_at = clock_timestamp()
    where id = p_room_id;
  else
    update public.elite_pixel_rooms set version = version + 1, updated_at = clock_timestamp() where id = p_room_id;
  end if;
end;
$$;

create or replace function public.elite_pixel_buzz(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_room public.elite_pixel_rooms%rowtype;
begin
  v_seat := public.elite_pixel_member_seat(p_room_id);
  select * into v_room from public.elite_pixel_rooms where id = p_room_id for update;
  if v_room.status <> 'active' or v_room.phase <> 'shared' then raise exception 'BUZZ_CLOSED' using errcode = 'P0001'; end if;
  if clock_timestamp() >= least(v_room.phase_deadline, v_room.total_deadline) then raise exception 'BUZZ_CLOSED' using errcode = 'P0001'; end if;

  update public.elite_pixel_rooms
  set phase = 'answer', active_player = v_seat,
      phase_deadline = least(total_deadline, clock_timestamp() + interval '10 seconds'),
      version = version + 1, updated_at = clock_timestamp()
  where id = p_room_id;
end;
$$;

create or replace function public.elite_pixel_resolve_answer(p_room_id uuid, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_other smallint;
  v_room public.elite_pixel_rooms%rowtype;
  v_scores smallint[];
begin
  v_seat := public.elite_pixel_member_seat(p_room_id);
  v_other := case v_seat when 1 then 2 else 1 end;
  select * into v_room from public.elite_pixel_rooms where id = p_room_id for update;
  if v_room.phase not in ('answer', 'exclusive') or v_room.active_player <> v_seat then
    raise exception 'NOT_YOUR_TURN' using errcode = 'P0001';
  end if;
  if clock_timestamp() >= least(v_room.phase_deadline, v_room.total_deadline) then
    raise exception 'ANSWER_CLOSED' using errcode = 'P0001';
  end if;

  if p_correct then
    v_scores := v_room.scores;
    v_scores[v_seat] := v_scores[v_seat] + 1;
    update public.elite_pixel_rooms
    set scores = v_scores, round_winner = v_seat, active_player = null,
        phase = case when v_scores[v_seat] >= score_limit then 'match_finished' else 'reveal' end,
        status = case when v_scores[v_seat] >= score_limit then 'finished' else 'active' end,
        last_reason = format('%s gagne la manche avec la bonne combinaison.',
          (select display_name from public.elite_pixel_room_players where room_id = p_room_id and seat = v_seat)),
        phase_deadline = null,
        finished_at = case when v_scores[v_seat] >= score_limit then clock_timestamp() else null end,
        version = version + 1, updated_at = clock_timestamp()
    where id = p_room_id;
  elsif v_room.phase = 'answer' then
    update public.elite_pixel_rooms
    set phase = 'exclusive', active_player = v_other,
        phase_deadline = least(total_deadline, clock_timestamp() + interval '20 seconds'),
        last_reason = 'Réponse incorrecte : chance exclusive à l’adversaire.',
        version = version + 1, updated_at = clock_timestamp()
    where id = p_room_id;
  else
    update public.elite_pixel_rooms
    set phase = 'shared', active_player = null,
        phase_deadline = least(total_deadline, clock_timestamp() + interval '60 seconds'),
        last_reason = 'Réponse incorrecte : le buzzer est de nouveau ouvert.',
        version = version + 1, updated_at = clock_timestamp()
    where id = p_room_id;
  end if;
end;
$$;

create or replace function public.elite_pixel_sync_clock(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.elite_pixel_rooms%rowtype;
  v_other smallint;
begin
  perform public.elite_pixel_member_seat(p_room_id);
  select * into v_room from public.elite_pixel_rooms where id = p_room_id for update;
  if v_room.status <> 'active' or v_room.phase in ('waiting', 'reveal', 'match_finished') then return; end if;

  if v_room.total_deadline is not null and clock_timestamp() >= v_room.total_deadline then
    update public.elite_pixel_rooms
    set phase = 'reveal', active_player = null, round_winner = null,
        phase_deadline = null, last_reason = 'Temps écoulé : aucun point pour cette manche.',
        version = version + 1, updated_at = clock_timestamp()
    where id = p_room_id;
  elsif v_room.phase_deadline is not null and clock_timestamp() >= v_room.phase_deadline then
    if v_room.phase = 'answer' then
      v_other := case v_room.active_player when 1 then 2 else 1 end;
      update public.elite_pixel_rooms
      set phase = 'exclusive', active_player = v_other,
          phase_deadline = least(total_deadline, clock_timestamp() + interval '20 seconds'),
          last_reason = 'Temps de réponse écoulé : chance exclusive à l’adversaire.',
          version = version + 1, updated_at = clock_timestamp()
      where id = p_room_id;
    elsif v_room.phase = 'exclusive' then
      update public.elite_pixel_rooms
      set phase = 'shared', active_player = null,
          phase_deadline = least(total_deadline, clock_timestamp() + interval '60 seconds'),
          last_reason = 'Temps exclusif écoulé : le buzzer est de nouveau ouvert.',
          version = version + 1, updated_at = clock_timestamp()
      where id = p_room_id;
    else
      update public.elite_pixel_rooms
      set phase = 'reveal', active_player = null, round_winner = null,
          phase_deadline = null, last_reason = 'Personne n’a buzzé : aucun point pour cette manche.',
          version = version + 1, updated_at = clock_timestamp()
      where id = p_room_id;
    end if;
  end if;
end;
$$;

create or replace function public.elite_pixel_next_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.elite_pixel_rooms%rowtype;
begin
  perform public.elite_pixel_member_seat(p_room_id);
  select * into v_room from public.elite_pixel_rooms where id = p_room_id for update;
  if v_room.phase not in ('reveal', 'match_finished') then raise exception 'ROUND_NOT_FINISHED' using errcode = 'P0001'; end if;

  update public.elite_pixel_rooms
  set status = 'active', phase = 'shared', active_player = null,
      round_number = case when v_room.phase = 'match_finished' then 1 else round_number + 1 end,
      scores = case when v_room.phase = 'match_finished' then array[0, 0]::smallint[] else scores end,
      puzzle_seed = floor(random() * 2147483646)::bigint + 1,
      phase_deadline = clock_timestamp() + interval '60 seconds',
      total_deadline = clock_timestamp() + interval '5 minutes',
      round_winner = null, last_reason = null, finished_at = null,
      version = version + 1, updated_at = clock_timestamp()
  where id = p_room_id;
end;
$$;

create or replace function public.elite_pixel_leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_other smallint;
  v_room public.elite_pixel_rooms%rowtype;
  v_scores smallint[];
begin
  v_seat := public.elite_pixel_member_seat(p_room_id);
  v_other := case v_seat when 1 then 2 else 1 end;
  select * into v_room from public.elite_pixel_rooms where id = p_room_id for update;

  if v_room.status = 'waiting' then
    if v_room.host_id = auth.uid() then
      delete from public.elite_pixel_rooms where id = p_room_id;
    else
      delete from public.elite_pixel_room_players where room_id = p_room_id and user_id = auth.uid();
      update public.elite_pixel_room_players set ready = false where room_id = p_room_id;
      update public.elite_pixel_rooms set version = version + 1, updated_at = clock_timestamp() where id = p_room_id;
    end if;
  elsif v_room.phase not in ('match_finished') then
    v_scores := v_room.scores;
    v_scores[v_other] := v_room.score_limit;
    update public.elite_pixel_rooms
    set status = 'finished', phase = 'match_finished', scores = v_scores,
        active_player = null, round_winner = v_other, phase_deadline = null,
        last_reason = format('%s gagne : son adversaire a quitté la partie.',
          coalesce((select display_name from public.elite_pixel_room_players where room_id = p_room_id and seat = v_other), 'L’adversaire')),
        finished_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
    where id = p_room_id;
  end if;
end;
$$;

revoke all on public.elite_pixel_rooms from anon, authenticated;
revoke all on public.elite_pixel_room_players from anon, authenticated;
grant select on public.elite_pixel_rooms to authenticated;
grant select on public.elite_pixel_room_players to authenticated;

revoke all on function public.elite_pixel_is_member(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_member_seat(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_random_code() from public, anon, authenticated;
revoke all on function public.elite_pixel_create_room(text) from public, anon, authenticated;
revoke all on function public.elite_pixel_join_room(text, text) from public, anon, authenticated;
revoke all on function public.elite_pixel_get_state(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_set_ready(uuid, boolean) from public, anon, authenticated;
revoke all on function public.elite_pixel_buzz(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_resolve_answer(uuid, boolean) from public, anon, authenticated;
revoke all on function public.elite_pixel_sync_clock(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_next_round(uuid) from public, anon, authenticated;
revoke all on function public.elite_pixel_leave_room(uuid) from public, anon, authenticated;

grant execute on function public.elite_pixel_is_member(uuid) to authenticated;
grant execute on function public.elite_pixel_member_seat(uuid) to authenticated;
grant execute on function public.elite_pixel_create_room(text) to authenticated;
grant execute on function public.elite_pixel_join_room(text, text) to authenticated;
grant execute on function public.elite_pixel_get_state(uuid) to authenticated;
grant execute on function public.elite_pixel_set_ready(uuid, boolean) to authenticated;
grant execute on function public.elite_pixel_buzz(uuid) to authenticated;
grant execute on function public.elite_pixel_resolve_answer(uuid, boolean) to authenticated;
grant execute on function public.elite_pixel_sync_clock(uuid) to authenticated;
grant execute on function public.elite_pixel_next_round(uuid) to authenticated;
grant execute on function public.elite_pixel_leave_room(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'elite_pixel_rooms'
  ) then
    alter publication supabase_realtime add table public.elite_pixel_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'elite_pixel_room_players'
  ) then
    alter publication supabase_realtime add table public.elite_pixel_room_players;
  end if;
end;
$$;

