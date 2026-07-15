import {
  CELL,
  generatePuzzle,
  rotateCard,
  sameTrio,
} from './engine.js';

const PHASE = Object.freeze({
  SHARED: 'shared',
  ANSWER: 'answer',
  EXCLUSIVE: 'exclusive',
  REVEAL: 'reveal',
  MATCH_OVER: 'match-over',
});

const DURATION = Object.freeze({
  SHARED: 60,
  ANSWER: 10,
  EXCLUSIVE: 20,
  TOTAL: 300,
});

const CELL_CLASS = Object.freeze({
  [CELL.EMPTY]: 'empty',
  [CELL.RED]: 'red',
  [CELL.YELLOW]: 'yellow',
  [CELL.BLUE]: 'blue',
  [CELL.ORANGE]: 'orange',
  [CELL.VIOLET]: 'violet',
  [CELL.GREEN]: 'green',
  [CELL.BLACK]: 'black',
});

const state = {
  puzzle: null,
  phase: PHASE.SHARED,
  phaseRemaining: DURATION.SHARED,
  totalRemaining: DURATION.TOTAL,
  currentPlayer: null,
  answerOrigin: null,
  selectedCards: [],
  scores: { 1: 0, 2: 0 },
  round: 1,
  lastTick: performance.now(),
};

const elements = {
  modelGrid: document.querySelector('#model-grid'),
  cardsGrid: document.querySelector('#cards-grid'),
  cardTemplate: document.querySelector('#card-template'),
  verifyButton: document.querySelector('#verify-button'),
  selectionCount: document.querySelector('#selection-count'),
  phaseLabel: document.querySelector('#phase-label'),
  statusMessage: document.querySelector('#status-message'),
  phaseTimerLabel: document.querySelector('#phase-timer-label'),
  phaseTimer: document.querySelector('#phase-timer'),
  totalTimer: document.querySelector('#total-timer'),
  roundNumber: document.querySelector('#round-number'),
  revealDialog: document.querySelector('#reveal-dialog'),
  revealKicker: document.querySelector('#reveal-kicker'),
  revealTitle: document.querySelector('#reveal-title'),
  revealMessage: document.querySelector('#reveal-message'),
  solutionEquation: document.querySelector('#solution-equation'),
  nextRoundButton: document.querySelector('#next-round-button'),
  rulesButton: document.querySelector('#rules-button'),
  rulesDialog: document.querySelector('#rules-dialog'),
  closeRulesButton: document.querySelector('#close-rules-button'),
};

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function createGrid(card, className = '') {
  const grid = document.createElement('span');
  grid.className = `pixel-grid ${className}`.trim();

  card.forEach((cell) => {
    const pixel = document.createElement('span');
    pixel.className = `pixel-cell ${CELL_CLASS[cell]}`;
    grid.append(pixel);
  });

  return grid;
}

function renderGrid(container, card) {
  container.replaceChildren(...createGrid(card).children);
}

function renderCards() {
  elements.cardsGrid.replaceChildren();

  state.puzzle.cards.forEach((card, index) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const button = fragment.querySelector('.puzzle-card');
    const number = fragment.querySelector('.card-number');
    const grid = fragment.querySelector('.card-grid');

    button.dataset.cardIndex = String(index);
    button.setAttribute('aria-label', `Carte ${index + 1}`);
    number.textContent = String(index + 1).padStart(2, '0');
    grid.replaceChildren(...createGrid(card).children);
    button.addEventListener('click', () => toggleCard(index));

    elements.cardsGrid.append(fragment);
  });
}

function renderScores() {
  for (const player of [1, 2]) {
    const scoreContainer = document.querySelector(`[data-score="${player}"]`);
    scoreContainer.replaceChildren();

    for (let point = 0; point < 3; point += 1) {
      const pip = document.createElement('span');
      pip.className = `score-pip${point < state.scores[player] ? ' won' : ''}`;
      scoreContainer.append(pip);
    }
  }
}

function isSelectionPhase() {
  return state.phase === PHASE.ANSWER || state.phase === PHASE.EXCLUSIVE;
}

function renderSelection() {
  document.querySelectorAll('.puzzle-card').forEach((button) => {
    const cardIndex = Number(button.dataset.cardIndex);
    const selected = state.selectedCards.includes(cardIndex);
    button.classList.toggle('selected', selected);
    button.disabled = !isSelectionPhase();
    button.setAttribute('aria-pressed', String(selected));
  });

  elements.selectionCount.textContent = `${state.selectedCards.length} / 3`;
  elements.verifyButton.disabled = !isSelectionPhase() || state.selectedCards.length !== 3;
}

function renderPlayers() {
  document.querySelectorAll('[data-player-panel]').forEach((panel) => {
    const player = Number(panel.dataset.playerPanel);
    panel.classList.toggle('active', state.currentPlayer === player && isSelectionPhase());
  });
}

function setStatus(phaseLabel, message, timerLabel) {
  elements.phaseLabel.textContent = phaseLabel;
  elements.statusMessage.textContent = message;
  elements.phaseTimerLabel.textContent = timerLabel;
}

function updatePhaseCopy() {
  if (state.phase === PHASE.SHARED) {
    setStatus(
      'Réflexion commune',
      'J1 : Espace · J2 : Entrée. Buzzez seulement quand vous avez votre trio.',
      'Temps de réflexion',
    );
  } else if (state.phase === PHASE.ANSWER) {
    setStatus(
      `Proposition du joueur ${state.currentPlayer}`,
      `Joueur ${state.currentPlayer}, sélectionnez exactement trois cartes puis vérifiez.`,
      'Temps pour répondre',
    );
  } else if (state.phase === PHASE.EXCLUSIVE) {
    setStatus(
      `Riposte exclusive du joueur ${state.currentPlayer}`,
      `Le joueur ${state.currentPlayer} peut répondre sans être interrompu.`,
      'Temps exclusif',
    );
  }
}

function updateTimers() {
  elements.phaseTimer.textContent = formatTime(state.phaseRemaining);
  elements.totalTimer.textContent = formatTime(state.totalRemaining);
  elements.phaseTimer.classList.toggle('danger', state.phaseRemaining <= 10);
  elements.totalTimer.classList.toggle('danger', state.totalRemaining <= 30);
}

function clearSelection() {
  state.selectedCards = [];
  renderSelection();
}

function toggleCard(cardIndex) {
  if (!isSelectionPhase()) return;

  if (state.selectedCards.includes(cardIndex)) {
    state.selectedCards = state.selectedCards.filter((index) => index !== cardIndex);
  } else if (state.selectedCards.length < 3) {
    state.selectedCards = [...state.selectedCards, cardIndex];
  }

  renderSelection();
}

function startSharedMinute(message = null) {
  state.phase = PHASE.SHARED;
  state.phaseRemaining = DURATION.SHARED;
  state.currentPlayer = null;
  state.answerOrigin = null;
  clearSelection();
  updatePhaseCopy();
  if (message) elements.statusMessage.textContent = message;
  renderPlayers();
  updateTimers();
}

function startAnswer(player) {
  if (state.phase !== PHASE.SHARED) return;
  state.phase = PHASE.ANSWER;
  state.phaseRemaining = DURATION.ANSWER;
  state.currentPlayer = player;
  state.answerOrigin = PHASE.SHARED;
  clearSelection();
  updatePhaseCopy();
  renderPlayers();
  updateTimers();
}

function startExclusive(player) {
  state.phase = PHASE.EXCLUSIVE;
  state.phaseRemaining = DURATION.EXCLUSIVE;
  state.currentPlayer = player;
  state.answerOrigin = PHASE.EXCLUSIVE;
  clearSelection();
  updatePhaseCopy();
  renderPlayers();
  updateTimers();
}

function handleIncorrectAnswer() {
  const player = state.currentPlayer;
  const origin = state.answerOrigin;

  if (origin === PHASE.SHARED) {
    startExclusive(player === 1 ? 2 : 1);
    elements.statusMessage.textContent = `Réponse incorrecte du joueur ${player}. Son adversaire a 20 secondes exclusives.`;
  } else {
    startSharedMinute(`Réponse incorrecte du joueur ${player}. Une nouvelle minute commune commence.`);
  }
}

function renderSolutionEquation() {
  elements.solutionEquation.replaceChildren();
  const { trio, rotations } = state.puzzle.solution;

  trio.forEach((cardIndex, index) => {
    const cardWrap = document.createElement('div');
    cardWrap.className = 'solution-card-wrap';

    const label = document.createElement('strong');
    const degrees = rotations[index] * 90;
    label.textContent = `Carte ${cardIndex + 1} · ${degrees}°`;

    const rotatingGrid = createGrid(rotateCard(state.puzzle.cards[cardIndex], rotations[index]), 'solution-grid');
    rotatingGrid.style.setProperty('--delay', `${index * 160}ms`);

    cardWrap.append(label, rotatingGrid);
    elements.solutionEquation.append(cardWrap);

    if (index < trio.length - 1) {
      const operator = document.createElement('span');
      operator.className = 'equation-operator';
      operator.textContent = '+';
      elements.solutionEquation.append(operator);
    }
  });

  const equals = document.createElement('span');
  equals.className = 'equation-operator';
  equals.textContent = '=';
  elements.solutionEquation.append(equals);

  const modelWrap = document.createElement('div');
  modelWrap.className = 'solution-card-wrap final-model';
  const label = document.createElement('strong');
  label.textContent = 'Modèle';
  modelWrap.append(label, createGrid(state.puzzle.model, 'solution-grid'));
  elements.solutionEquation.append(modelWrap);
}

function revealRound({ winner = null, reason }) {
  state.phase = PHASE.REVEAL;
  state.currentPlayer = null;
  clearSelection();
  renderPlayers();
  renderSolutionEquation();

  if (winner) {
    elements.revealKicker.textContent = `Point pour le joueur ${winner}`;
    elements.revealTitle.textContent = 'Combinaison correcte';
  } else {
    elements.revealKicker.textContent = 'Aucun point';
    elements.revealTitle.textContent = 'Temps écoulé';
  }

  elements.revealMessage.textContent = reason;

  const matchWinner = winner && state.scores[winner] >= 3 ? winner : null;
  if (matchWinner) {
    state.phase = PHASE.MATCH_OVER;
    elements.revealKicker.textContent = `Victoire du joueur ${matchWinner}`;
    elements.revealTitle.textContent = 'Partie remportée !';
    elements.nextRoundButton.textContent = 'Rejouer un FT3';
  } else {
    elements.nextRoundButton.textContent = 'Manche suivante';
  }

  elements.revealDialog.showModal();
}

function submitAnswer() {
  if (!isSelectionPhase() || state.selectedCards.length !== 3) return;

  if (sameTrio(state.selectedCards, state.puzzle.solution.trio)) {
    const winner = state.currentPlayer;
    state.scores[winner] += 1;
    renderScores();
    revealRound({
      winner,
      reason: 'Le trio est unique. Les rotations exactes apparaissent ci-dessous.',
    });
  } else {
    handleIncorrectAnswer();
  }
}

function endRoundForTimeout(reason) {
  revealRound({ winner: null, reason });
}

function createRound() {
  state.puzzle = generatePuzzle();
  state.totalRemaining = DURATION.TOTAL;
  state.phaseRemaining = DURATION.SHARED;
  state.phase = PHASE.SHARED;
  state.currentPlayer = null;
  state.answerOrigin = null;
  state.selectedCards = [];
  state.lastTick = performance.now();

  elements.roundNumber.textContent = `Manche ${state.round}`;
  renderGrid(elements.modelGrid, state.puzzle.model);
  renderCards();
  renderSelection();
  renderPlayers();
  updatePhaseCopy();
  updateTimers();
}

function startNextRound() {
  elements.revealDialog.close();

  if (state.phase === PHASE.MATCH_OVER) {
    state.scores = { 1: 0, 2: 0 };
    state.round = 1;
    renderScores();
  } else {
    state.round += 1;
  }

  createRound();
}

function tick(now) {
  const elapsed = Math.min((now - state.lastTick) / 1000, 0.25);
  state.lastTick = now;

  if (!elements.rulesDialog.open && [PHASE.SHARED, PHASE.ANSWER, PHASE.EXCLUSIVE].includes(state.phase)) {
    state.totalRemaining -= elapsed;
    state.phaseRemaining -= elapsed;

    if (state.totalRemaining <= 0) {
      state.totalRemaining = 0;
      updateTimers();
      endRoundForTimeout('La limite totale de cinq minutes a été atteinte.');
    } else if (state.phaseRemaining <= 0) {
      state.phaseRemaining = 0;
      updateTimers();

      if (state.phase === PHASE.SHARED) {
        endRoundForTimeout('La minute de réflexion commune est écoulée.');
      } else if (state.phase === PHASE.ANSWER) {
        handleIncorrectAnswer();
      } else if (state.phase === PHASE.EXCLUSIVE) {
        startSharedMinute('Les 20 secondes exclusives sont écoulées. Une nouvelle minute commune commence.');
      }
    } else {
      updateTimers();
    }
  }

  requestAnimationFrame(tick);
}

function handleKeydown(event) {
  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault();
  }

  if (elements.rulesDialog.open || elements.revealDialog.open) return;
  if (event.repeat || state.phase !== PHASE.SHARED) return;
  if (event.code === 'Space') startAnswer(1);
  if (event.code === 'Enter') startAnswer(2);
}

elements.verifyButton.addEventListener('click', submitAnswer);
elements.nextRoundButton.addEventListener('click', startNextRound);
elements.rulesButton.addEventListener('click', () => elements.rulesDialog.showModal());
elements.closeRulesButton.addEventListener('click', () => elements.rulesDialog.close());
elements.revealDialog.addEventListener('cancel', (event) => event.preventDefault());
elements.rulesDialog.addEventListener('click', (event) => {
  if (event.target === elements.rulesDialog) elements.rulesDialog.close();
});
document.addEventListener('keydown', handleKeydown);

renderScores();
createRound();
requestAnimationFrame(tick);
