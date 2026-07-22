import { randomBytes } from 'node:crypto';
import {
  createSeededRandom,
  generatePuzzle,
} from '../src/engine.js';

const requested = Number(process.argv[2] ?? 128);
const count = Number.isInteger(requested) && requested > 0 ? requested : 128;
const rows = [];

for (let index = 0; index < count; index += 1) {
  const seed = randomBytes(4).readUInt32LE(0);
  const puzzle = generatePuzzle({
    random: createSeededRandom(seed),
  });
  rows.push(
    `('${JSON.stringify(puzzle.cards)}'::jsonb, `
    + `array[${puzzle.model.join(',')}]::smallint[], `
    + `array[${puzzle.solution.trio.join(',')}]::smallint[], `
    + `array[${puzzle.solution.rotations.join(',')}]::smallint[])`,
  );
}

console.log(`insert into public.elite_pixel_puzzles
  (cards, model, solution_trio, solution_rotations)
values
  ${rows.join(',\n  ')};`);
