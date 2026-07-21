export const CELL = Object.freeze({
  EMPTY: 0,
  RED: 1,
  YELLOW: 2,
  BLUE: 3,
  ORANGE: 4,
  VIOLET: 5,
  GREEN: 6,
  BLACK: 7,
  INVALID: 8,
});

export const ROTATIONS = Object.freeze([0, 1, 2, 3]);

const SECONDARY_BY_PAIR = new Map([
  [`${CELL.RED}-${CELL.YELLOW}`, CELL.ORANGE],
  [`${CELL.RED}-${CELL.BLUE}`, CELL.VIOLET],
  [`${CELL.YELLOW}-${CELL.BLUE}`, CELL.GREEN],
]);

export function rotateCard(card, quarterTurns = 0) {
  let rotated = [...card];
  const turns = ((quarterTurns % 4) + 4) % 4;

  for (let turn = 0; turn < turns; turn += 1) {
    rotated = [
      rotated[6], rotated[3], rotated[0],
      rotated[7], rotated[4], rotated[1],
      rotated[8], rotated[5], rotated[2],
    ];
  }

  return rotated;
}

export function fuseCell(values) {
  const colors = values.filter((value) => value !== CELL.EMPTY);
  if (colors.length === 0) return CELL.EMPTY;

  const counts = new Map();
  colors.forEach((color) => counts.set(color, (counts.get(color) ?? 0) + 1));

  if (counts.size === 1) return colors[0];

  if (colors.length === 2) {
    const pair = [...counts.keys()].sort((a, b) => a - b).join('-');
    return SECONDARY_BY_PAIR.get(pair);
  }

  if (counts.size === 3) return CELL.BLACK;

  if (colors.length === 3 && counts.size === 2) return CELL.INVALID;

  throw new Error('Combinaison de couleurs invalide.');
}

export function mergeCards(cards) {
  if (cards.length !== 3) {
    throw new Error('La fusion requiert exactement trois cartes.');
  }

  return Array.from({ length: 9 }, (_, index) => (
    fuseCell(cards.map((card) => card[index]))
  ));
}

export function combinationsOfThree(length) {
  const combinations = [];
  for (let first = 0; first < length - 2; first += 1) {
    for (let second = first + 1; second < length - 1; second += 1) {
      for (let third = second + 1; third < length; third += 1) {
        combinations.push([first, second, third]);
      }
    }
  }
  return combinations;
}

export function findSolutions(cards, model, { stopAt = Number.POSITIVE_INFINITY } = {}) {
  const solutions = [];

  for (const trio of combinationsOfThree(cards.length)) {
    for (const firstRotation of ROTATIONS) {
      for (const secondRotation of ROTATIONS) {
        for (const thirdRotation of ROTATIONS) {
          const rotations = [firstRotation, secondRotation, thirdRotation];
          const merged = mergeCards(trio.map((cardIndex, index) => (
            rotateCard(cards[cardIndex], rotations[index])
          )));

          if (merged.every((cell, index) => cell === model[index])) {
            solutions.push({ trio: [...trio], rotations });
            if (solutions.length >= stopAt) return solutions;
          }
        }
      }
    }
  }

  return solutions;
}

export function createSeededRandom(seed = Date.now()) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInteger(max, random) {
  return Math.floor(random() * max);
}

function cardKey(card) {
  return card.join('');
}

function hasFourDistinctRotations(card) {
  return new Set(ROTATIONS.map((rotation) => cardKey(rotateCard(card, rotation)))).size === 4;
}

function createRandomCard(random) {
  for (;;) {
    const card = Array.from({ length: 9 }, () => {
      if (random() >= 0.43) return CELL.EMPTY;
      return [CELL.RED, CELL.YELLOW, CELL.BLUE][randomInteger(3, random)];
    });

    const filledCells = card.filter((cell) => cell !== CELL.EMPTY).length;
    if (filledCells >= 2 && filledCells <= 6 && hasFourDistinctRotations(card)) {
      return card;
    }
  }
}

function sampleThreeIndices(random) {
  const indices = Array.from({ length: 9 }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(index + 1, random);
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices.slice(0, 3).sort((a, b) => a - b);
}

export function generatePuzzle({ random = Math.random, maxAttempts = 500 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const cards = [];
    const knownCards = new Set();

    while (cards.length < 9) {
      const card = createRandomCard(random);
      const key = cardKey(card);
      if (!knownCards.has(key)) {
        knownCards.add(key);
        cards.push(card);
      }
    }

    const sourceTrio = sampleThreeIndices(random);
    const sourceRotations = sourceTrio.map(() => randomInteger(4, random));
    const model = mergeCards(sourceTrio.map((cardIndex, index) => (
      rotateCard(cards[cardIndex], sourceRotations[index])
    )));

    if (model.includes(CELL.INVALID)) continue;

    const solutions = findSolutions(cards, model, { stopAt: 2 });
    if (solutions.length === 1) {
      return {
        cards,
        model,
        solution: solutions[0],
        generationAttempts: attempt,
      };
    }
  }

  throw new Error(`Impossible de générer une énigme unique après ${maxAttempts} essais.`);
}

export function sameTrio(first, second) {
  if (first.length !== 3 || second.length !== 3) return false;
  const sortedFirst = [...first].sort((a, b) => a - b);
  const sortedSecond = [...second].sort((a, b) => a - b);
  return sortedFirst.every((value, index) => value === sortedSecond[index]);
}
