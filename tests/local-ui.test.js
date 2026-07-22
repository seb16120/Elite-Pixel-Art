import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const localHtml = await readFile(new URL('../local.html', import.meta.url), 'utf8');
const localScript = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('la phase exclusive locale signale uniquement le joueur concerné', () => {
  assert.match(localHtml, /data-exclusive-side="1"/);
  assert.match(localHtml, /data-exclusive-side="2"/);
  assert.match(localScript, /state\.phase === PHASE\.EXCLUSIVE && state\.currentPlayer === player/);
  assert.match(styles, /\.local-exclusive-side\.active/);
  assert.match(styles, /border-color: #b8ff5a/);
});

test('les repères J1 et J2 encadrent le bouton de validation sur PC', () => {
  assert.match(localHtml, /local-exclusive-side-j1[\s\S]*id="verify-button"[\s\S]*local-exclusive-side-j2/);
  assert.match(styles, /grid-template-columns: minmax\(58px, 0\.16fr\)[\s\S]*minmax\(58px, 0\.16fr\)/);
});

test('le plateau local se compacte sur les écrans PC peu hauts', () => {
  assert.match(styles, /@media \(min-width: 951px\) and \(min-height: 700px\) and \(max-height: 1100px\)/);
  assert.match(styles, /\.local-page \.game-shell[\s\S]*height: 100dvh/);
  assert.match(styles, /\.local-page \.puzzle-layout[\s\S]*flex: 1 1 auto[\s\S]*min-height: 0/);
  assert.match(styles, /grid-template-rows: repeat\(3, minmax\(0, 1fr\)\)/);
});

test('les repères latéraux restent masqués sur smartphone', () => {
  assert.match(styles, /@media \(max-width: 950px\)[\s\S]*\.local-exclusive-side[\s\S]*display: none/);
});
