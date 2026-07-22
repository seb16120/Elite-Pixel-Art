import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL,
  createSeededRandom,
  findSolutions,
  fuseCell,
  generatePuzzle,
  rotateCard,
  sameTrio,
} from '../src/engine.js';

test('une rotation à 90° place chaque case au bon endroit', () => {
  const card = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(rotateCard(card, 1), [6, 3, 0, 7, 4, 1, 8, 5, 2]);
});

test('quatre quarts de tour rendent la carte initiale', () => {
  const card = [
    CELL.RED, CELL.EMPTY, CELL.BLUE,
    CELL.YELLOW, CELL.EMPTY, CELL.EMPTY,
    CELL.EMPTY, CELL.RED, CELL.BLUE,
  ];
  assert.deepEqual(rotateCard(card, 4), card);
  assert.deepEqual(rotateCard(rotateCard(rotateCard(rotateCard(card, 1), 1), 1), 1), card);
});

test('les règles de fusion produisent les couleurs attendues', () => {
  assert.equal(fuseCell([CELL.EMPTY, CELL.EMPTY, CELL.EMPTY]), CELL.EMPTY);
  assert.equal(fuseCell([CELL.RED, CELL.RED, CELL.EMPTY]), CELL.RED);
  assert.equal(fuseCell([CELL.RED, CELL.YELLOW, CELL.EMPTY]), CELL.ORANGE);
  assert.equal(fuseCell([CELL.RED, CELL.BLUE, CELL.EMPTY]), CELL.VIOLET);
  assert.equal(fuseCell([CELL.YELLOW, CELL.BLUE, CELL.EMPTY]), CELL.GREEN);
  assert.equal(fuseCell([CELL.RED, CELL.YELLOW, CELL.BLUE]), CELL.BLACK);
});

test('une combinaison X + X + Y est toujours invalide', () => {
  const primaryColors = [CELL.RED, CELL.YELLOW, CELL.BLUE];
  for (const repeated of primaryColors) {
    for (const different of primaryColors.filter((color) => color !== repeated)) {
      assert.equal(fuseCell([repeated, repeated, different]), CELL.INVALID);
    }
  }
});

test('la comparaison des trios ignore uniquement leur ordre', () => {
  assert.equal(sameTrio([1, 4, 8], [8, 1, 4]), true);
  assert.equal(sameTrio([1, 4, 8], [1, 4, 7]), false);
  assert.equal(sameTrio([1, 4], [1, 4]), false);
});

test('les énigmes générées possèdent exactement une solution', () => {
  for (const seed of [1, 42, 20260722]) {
    const puzzle = generatePuzzle({ random: createSeededRandom(seed) });
    assert.equal(puzzle.cards.length, 9);
    assert.equal(puzzle.model.includes(CELL.INVALID), false);
    assert.equal(findSolutions(puzzle.cards, puzzle.model, { stopAt: 2 }).length, 1);
  }
});
