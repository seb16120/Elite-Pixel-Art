import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [indexHtml, localHtml, onlineHtml, localJs, onlineJs, sql] = await Promise.all([
  read('../index.html'), read('../local.html'), read('../online.html'),
  read('../src/app.js'), read('../src/online.js'), read('../supabase/elite-pixel-online.sql'),
]);
test('le mode local demande FT1, FT2 ou FT3 avant de démarrer', () => {
  assert.match(indexHtml, /id="format-dialog"/);
  for (const limit of [1, 2, 3]) assert.match(indexHtml, new RegExp(`local\\.html\\?ft=${limit}`));
  assert.match(localJs, /\[1, 2, 3\]\.includes\(requested\)/);
  assert.match(localJs, /state\.scores\[winner\] >= SCORE_LIMIT/);
  assert.match(localHtml, /id="score-format"/);
});
test('le créateur online choisit le format transmis à Supabase', () => {
  for (const limit of [1, 2, 3]) assert.match(onlineHtml, new RegExp(`name="score-limit" value="${limit}"`));
  assert.match(onlineJs, /p_score_limit: chosenLimit/);
  assert.match(onlineJs, /point < scoreLimit\(\)/);
  assert.match(onlineHtml, /id="waiting-format"/);
});
test('Supabase refuse tout format autre que FT1, FT2 ou FT3', () => {
  const compact = sql.replace(/\s+/g, ' ');
  assert.match(compact, /p_score_limit smallint default 2/);
  assert.match(compact, /p_score_limit not in \(1, 2, 3\)/);
  assert.match(compact, /check \(score_limit in \(1, 2, 3\)\)/);
  assert.match(compact, /elite_pixel_create_room\(text, smallint\) to authenticated/);
});
