import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BrainyMatchHistory,
  createFriendlyLocalMatch,
} from '../src/brainy-history.js';

const migration = await readFile(
  new URL('../supabase/20260723223000_integrate_brainy_games_history.sql', import.meta.url),
  'utf8',
);
const localHtml = await readFile(new URL('../local.html', import.meta.url), 'utf8');
const localScript = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const onlineScript = await readFile(new URL('../src/online.js', import.meta.url), 'utf8');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function localEvent() {
  return createFriendlyLocalMatch({
    gameId: 'elite-pixel-art',
    matchId: 'epa-local:test',
    startedAt: '2026-07-23T20:00:00.000Z',
    endedAt: '2026-07-23T20:05:00.000Z',
    format: { type: 'first_to', target_score: 2 },
    participants: [
      { player_id: crypto.randomUUID(), seat: 1, team_id: null, outcome: 'win', score: 2 },
      { player_id: crypto.randomUUID(), seat: 2, team_id: null, outcome: 'loss', score: 1 },
    ],
  });
}

test('une partie locale reste en file hors ligne puis se synchronise sans changer d’identifiant', async () => {
  const storage = memoryStorage();
  let online = false;
  const calls = [];
  const history = new BrainyMatchHistory({
    supabaseClient: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { already_present: false }, error: null };
      },
    },
    storage,
    onlineState: () => online,
  });
  const event = localEvent();

  const offlineResult = await history.queueAndSync(event);
  assert.equal(offlineResult.sync.offline, true);
  assert.equal(history.pending()[0].event_id, event.event_id);
  assert.equal(calls.length, 0);

  online = true;
  const onlineResult = await history.flush();
  assert.equal(onlineResult.synced[0].event_id, event.event_id);
  assert.equal(calls[0].name, 'submit_friendly_local_match');
  assert.equal(calls[0].args.p_event.event_id, event.event_id);
  assert.deepEqual(history.pending(), []);
});

test('le mode local associe explicitement le profil connecté à J1 ou J2', () => {
  assert.match(localHtml, /id="brainy-profile-seat"/);
  assert.match(localScript, /profileSeat = Number\(elements\.brainyProfileSeat\.value\)/);
  assert.match(localScript, /gameId: 'elite-pixel-art'/);
  assert.equal(localEvent().category, 'friendly_local');
  assert.match(localScript, /validationReference: 'elite-pixel-art:local-ui:v1'/);
});

test('le résultat online est publié par un déclencheur serveur et jamais par le navigateur', () => {
  assert.match(migration, /after update of status, phase on public\.elite_pixel_rooms/);
  assert.match(migration, /'friendly_online'/);
  assert.match(migration, /'server'/);
  assert.match(migration, /join public\.profiles profile on profile\.id = player\.user_id/);
  assert.doesNotMatch(onlineScript, /insert\(['"]match_events/);
  assert.match(onlineScript, /le résultat amical sera validé et enregistré par Supabase/);
});

test('chaque revanche online reçoit un identifiant idempotent distinct', () => {
  assert.match(migration, /new\.match_series_id := gen_random_uuid\(\)/);
  assert.match(migration, /old\.phase = 'match_finished'/);
  assert.match(migration, /new\.match_started_at := clock_timestamp\(\)/);
});
