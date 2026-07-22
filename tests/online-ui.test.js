import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const onlineScript = await readFile(
  new URL('../src/online.js', import.meta.url),
  'utf8',
);
const onlineHtml = await readFile(
  new URL('../online.html', import.meta.url),
  'utf8',
);
const styles = await readFile(
  new URL('../styles.css', import.meta.url),
  'utf8',
);

function loadForfeitRule(state) {
  const source = onlineScript.match(
    /function leavingWouldForfeitMatch\(\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(source, 'la règle de confirmation doit exister');
  const PHASE = {
    WAITING: 'waiting',
    FINISHED: 'match_finished',
  };
  return new Function(
    'state',
    'PHASE',
    `${source}; return leavingWouldForfeitMatch();`,
  )(state, PHASE);
}

test('quitter une partie active ou une révélation demande confirmation', () => {
  assert.equal(loadForfeitRule({ room: { phase: 'shared' } }), true);
  assert.equal(loadForfeitRule({ room: { phase: 'exclusive' } }), true);
  assert.equal(loadForfeitRule({ room: { phase: 'reveal' } }), true);
  assert.match(onlineScript, /window\.confirm\(/);
  assert.match(onlineScript, /donnera la victoire à votre adversaire/);
});

test('un salon en attente ou un match terminé reste quittable sans alerte', () => {
  assert.equal(loadForfeitRule({ room: { phase: 'waiting' } }), false);
  assert.equal(loadForfeitRule({ room: { phase: 'match_finished' } }), false);
  assert.equal(loadForfeitRule(null), false);
});

test('le joueur qui possède l’exclusivité est signalé sur le score PC', () => {
  assert.match(onlineHtml, /id="scoreboard" class="scoreboard"/);
  assert.match(onlineScript, /exclusive-seat-1/);
  assert.match(onlineScript, /exclusive-seat-2/);
  assert.match(styles, /scoreboard\.exclusive-seat-1 \.player-one/);
  assert.match(styles, /scoreboard\.exclusive-seat-2 \.player-two/);
  assert.match(styles, /outline: 3px solid #b8ff5a/);
});
