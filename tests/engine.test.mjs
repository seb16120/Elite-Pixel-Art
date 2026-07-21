import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL,
  createSeededRandom,
  findSolutions,
  fuseCell,
  generatePuzzle,
  mergeCards,
  rotateCard,
  sameTrio,
} from '../src/engine.js';

test('quatre quarts de tour rendent la carte originale', () => {
  const card = [1, 2, 3, 0, 1, 2, 3, 0, 1];
  assert.deepEqual(rotateCard(card, 4), card);
  assert.deepEqual(rotateCard(rotateCard(card, 1), 3), card);
});

test('les trois couleurs primaires produisent le noir', () => {
  assert.equal(fuseCell([CELL.RED, CELL.YELLOW, CELL.BLUE]), CELL.BLACK);
});

test('deux couleurs différentes sans troisième couleur produisent une secondaire', () => {
  assert.equal(fuseCell([CELL.RED, CELL.YELLOW, CELL.EMPTY]), CELL.ORANGE);
  assert.equal(fuseCell([CELL.RED, CELL.BLUE, CELL.EMPTY]), CELL.VIOLET);
  assert.equal(fuseCell([CELL.YELLOW, CELL.BLUE, CELL.EMPTY]), CELL.GREEN);
});

test('une superposition de type X + X + Y est invalide', () => {
  assert.equal(fuseCell([CELL.RED, CELL.RED, CELL.BLUE]), CELL.INVALID);
  assert.equal(fuseCell([CELL.YELLOW, CELL.BLUE, CELL.BLUE]), CELL.INVALID);
});

test('deux couleurs identiques et une case vide conservent la couleur', () => {
  assert.equal(fuseCell([CELL.RED, CELL.RED, CELL.EMPTY]), CELL.RED);
});

test('la fusion se fait case par case', () => {
  const red = Array(9).fill(CELL.RED);
  const yellow = Array(9).fill(CELL.YELLOW);
  const empty = Array(9).fill(CELL.EMPTY);
  assert.deepEqual(mergeCards([red, yellow, empty]), Array(9).fill(CELL.ORANGE));
});

test('une énigme générée possède exactement un trio et une disposition', () => {
  const puzzle = generatePuzzle({ random: createSeededRandom(42) });
  const solutions = findSolutions(puzzle.cards, puzzle.model, { stopAt: 2 });

  assert.equal(solutions.length, 1);
  assert.deepEqual(solutions[0], puzzle.solution);
});

test('la comparaison d’un trio ignore l’ordre de sélection', () => {
  assert.equal(sameTrio([1, 4, 7], [7, 1, 4]), true);
  assert.equal(sameTrio([1, 4, 7], [1, 4, 8]), false);
});
