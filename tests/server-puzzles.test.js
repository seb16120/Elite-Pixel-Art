import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeededRandom,
  findSolutions,
  generatePuzzle,
} from '../src/engine.js';

test('le générateur produit une banque d’énigmes uniques', () => {
  for (let seed = 1001; seed <= 1128; seed += 1) {
    const puzzle = generatePuzzle({
      random: createSeededRandom(seed),
    });
    const solutions = findSolutions(puzzle.cards, puzzle.model, { stopAt: 2 });

    assert.equal(solutions.length, 1, `unicité de l’énigme ${seed}`);
    assert.deepEqual(solutions[0], puzzle.solution, `solution de l’énigme ${seed}`);
  }
});
