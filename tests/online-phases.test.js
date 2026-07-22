import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/elite-pixel-online.sql', import.meta.url),
  'utf8',
);
const compactSql = sql.replace(/\s+/g, ' ');

test('un buzz ouvre une réponse exclusive de 15 secondes', () => {
  assert.match(compactSql, /elite_pixel_buzz[\s\S]*phase = 'answer', active_player = v_seat[\s\S]*interval '15 seconds'/);
});

test('une réponse ratée donne 30 secondes exclusives à l’adversaire', () => {
  assert.match(compactSql, /elsif v_room\.phase = 'answer' then[\s\S]*phase = 'exclusive', active_player = v_other[\s\S]*interval '30 seconds'/);
});

test('la fin du temps exclusif rouvre le jeu partagé pendant 60 secondes', () => {
  assert.match(compactSql, /elsif v_room\.phase = 'exclusive' then[\s\S]*phase = 'shared', active_player = null[\s\S]*interval '60 seconds'/);
});

test('la limite totale révèle la solution sans attribuer de point', () => {
  assert.match(compactSql, /clock_timestamp\(\) >= v_room\.total_deadline[\s\S]*phase = 'reveal', active_player = null, round_winner = null/);
});

test('quitter une partie active donne le match au joueur restant', () => {
  assert.match(compactSql, /elite_pixel_leave_room[\s\S]*v_scores\[v_other\] := v_room\.score_limit[\s\S]*status = 'finished', phase = 'match_finished'/);
});

test('les opérations concurrentes verrouillent le salon avant mutation', () => {
  for (const functionName of [
    'elite_pixel_join_room',
    'elite_pixel_set_ready',
    'elite_pixel_buzz',
    'elite_pixel_resolve_answer',
    'elite_pixel_sync_clock',
    'elite_pixel_next_round',
    'elite_pixel_leave_room',
  ]) {
    const start = compactSql.indexOf(`function public.${functionName}`);
    const end = compactSql.indexOf('create or replace function public.', start + 1);
    const body = compactSql.slice(start, end === -1 ? undefined : end);
    assert.notEqual(start, -1, `${functionName} doit exister`);
    assert.match(body, /for update/, `${functionName} doit verrouiller le salon`);
  }
});

test('les fonctions RPC ne sont pas exécutables par anon', () => {
  for (const functionName of [
    'elite_pixel_create_room',
    'elite_pixel_join_room',
    'elite_pixel_get_state',
    'elite_pixel_set_ready',
    'elite_pixel_buzz',
    'elite_pixel_resolve_answer',
    'elite_pixel_sync_clock',
    'elite_pixel_next_round',
    'elite_pixel_leave_room',
  ]) {
    assert.match(
      compactSql,
      new RegExp(`revoke all on function public\\.${functionName}\\([^;]+from public, anon, authenticated`),
    );
  }
});


test('une déconnexion laisse 30 secondes avant la victoire par forfait', () => {
  assert.match(compactSql, /v_other_last_seen < v_now - interval '30 seconds'/);
  assert.match(compactSql, /v_scores\[v_seat\] := v_room\.score_limit/);
  assert.match(compactSql, /status = 'finished', phase = 'match_finished'/);
  assert.match(compactSql, /ne s’est pas reconnecté dans les 30 secondes/);
});

test('une reprise tardive ne peut pas réclamer immédiatement la victoire', () => {
  assert.match(compactSql, /v_self_last_seen >= v_now - interval '10 seconds'/);
  assert.match(compactSql, /presence_started_at timestamptz not null default now\(\)/);
  assert.match(compactSql, /presence_started_at = case[\s\S]*interval '8 seconds'/);
  assert.match(compactSql, /v_self_presence_started_at <= v_now - interval '10 seconds'/);

  assert.match(compactSql, /last_seen = v_now[\s\S]*interval '4 seconds'/);
});

test('P4 regroupe la synchronisation de l’horloge et la lecture de l’état', () => {
  assert.match(compactSql, /function public\.elite_pixel_sync_state\(p_room_id uuid\)[\s\S]*perform public\.elite_pixel_sync_clock\(p_room_id\)[\s\S]*return public\.elite_pixel_get_state\(p_room_id\)/);
  assert.match(compactSql, /revoke all on function public\.elite_pixel_sync_state\(uuid\) from public, anon, authenticated/);
  assert.match(compactSql, /grant execute on function public\.elite_pixel_sync_state\(uuid\) to authenticated/);
});

test('P5 garde les solutions privées et valide les trois cartes côté serveur', () => {
  assert.match(compactSql, /create table if not exists public\.elite_pixel_puzzles/);
  assert.match(compactSql, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(compactSql, /alter table public\.elite_pixel_puzzles enable row level security/);
  assert.match(compactSql, /revoke all on table public\.elite_pixel_puzzles from public, anon, authenticated/);
  assert.match(compactSql, /create index if not exists elite_pixel_rooms_puzzle_idx/);
  assert.match(compactSql, /drop function if exists public\.elite_pixel_resolve_answer\(uuid, boolean\)/);
  assert.match(compactSql, /p_selected_cards smallint\[\]/);
  assert.match(compactSql, /v_correct := v_selected = v_solution/);
  assert.match(compactSql, /when r\.phase in \('reveal', 'match_finished'\)[\s\S]*'trio'/);
  assert.match(compactSql, /else null[\s\S]*from public\.elite_pixel_puzzles puzzle/);
});
