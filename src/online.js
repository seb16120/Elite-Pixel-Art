import {
  CELL,
  rotateCard,
} from './engine.js';

const { url, publishableKey } = window.ELITE_PIXEL_SUPABASE ?? {};
const supabaseFactory = window.supabase?.createClient;

const PHASE = Object.freeze({
  WAITING: 'waiting',
  SHARED: 'shared',
  ANSWER: 'answer',
  EXCLUSIVE: 'exclusive',
  REVEAL: 'reveal',
  FINISHED: 'match_finished',
});

const PRESENCE = Object.freeze({
  OFFLINE_AFTER_MS: 8_000,
  RECONNECT_GRACE_MS: 30_000,
});

const SYNC = Object.freeze({
  ACTIVE_POLL_MS: 5_000,
  WAITING_POLL_MS: 15_000,
  FINISHED_POLL_MS: 30_000,
});

const CELL_CLASS = {
  [CELL.EMPTY]: 'empty',
  [CELL.RED]: 'red',
  [CELL.YELLOW]: 'yellow',
  [CELL.BLUE]: 'blue',
  [CELL.ORANGE]: 'orange',
  [CELL.VIOLET]: 'violet',
  [CELL.GREEN]: 'green',
  [CELL.BLACK]: 'black',
};

const el = Object.fromEntries([
  'lobby-shell', 'connection-panel', 'connection-status', 'lobby-screen',
  'create-form', 'create-name', 'join-form', 'join-name', 'room-code',
  'brainy-history-status',
  'waiting-screen', 'waiting-code', 'waiting-format', 'copy-code-button', 'copy-link-button',
  'players-list', 'ready-button', 'leave-button', 'waiting-notice',
  'game-shell', 'game-leave-button', 'connection-dot', 'connection-label',
  'game-code', 'scoreboard', 'player-one-name', 'player-two-name', 'round-number',
  'score-format', 'rules-format', 'phase-label', 'status-message', 'buzz-button', 'phase-timer-label',
  'mobile-online-buzzer',
  'phase-timer', 'total-timer', 'model-grid', 'cards-grid',
  'selection-count', 'verify-button', 'rules-button', 'rules-dialog',
  'close-rules-button', 'reveal-dialog', 'reveal-kicker', 'reveal-title',
  'reveal-message', 'solution-equation', 'next-round-button',
  'close-reveal-button', 'end-menu-button', 'main-menu-button', 'card-template',
].map((id) => [id, document.getElementById(id)]));

let client;
let roomId = localStorage.getItem('elite-pixel-room-id');
let state = null;
let puzzle = null;
let puzzleSeed = null;
let selectedCards = [];
let serverOffset = 0;
let channel = null;
let pollTimer = null;
let refreshInFlight = null;
let lastRenderVersion = null;
let connected = false;
let wakeLock = null;
let finishedDialogDismissed = false;
let renderedSolutionKey = null;
let presenceWarningActive = false;
let brainyProfile = null;

function onlineGameInProgress() {
  return Boolean(state && state.room.phase !== PHASE.WAITING && state.room.phase !== PHASE.FINISHED);
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || !onlineGameInProgress() || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) {
    try { await lock.release(); } catch {}
  }
}

function syncWakeLock() {
  if (onlineGameInProgress()) void requestWakeLock();
  else void releaseWakeLock();
}

function show(node, visible = true) {
  node?.classList.toggle('hidden', !visible);
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 20);
}

function scoreLimit() {
  const value = Number(state?.room?.score_limit);
  return [1, 2, 3].includes(value) ? value : 3;
}
function scoreFormat() { return `FT${scoreLimit()}`; }

function roomCodeFromUrl() {
  return new URLSearchParams(location.search).get('room')?.trim().toUpperCase() ?? '';
}

function formatError(error) {
  const message = error?.message ?? String(error ?? 'Erreur inconnue');
  const known = {
    ROOM_NOT_FOUND: 'Ce salon est introuvable.',
    ROOM_FULL: 'Ce salon contient déjà deux joueurs.',
    ROOM_ALREADY_STARTED: 'Cette partie a déjà commencé.',
    NOT_MEMBER: 'Vous ne faites plus partie de ce salon.',
    NOT_YOUR_TURN: 'Ce n’est pas votre temps de réponse.',
    BUZZ_CLOSED: 'Le buzzer est déjà fermé.',
    PLAYER_NOT_READY: 'Les deux joueurs doivent être prêts.',
    INVALID_SELECTION: 'Sélection invalide.',
    PUZZLE_NOT_READY: 'L’énigme serveur n’est pas prête.',
  };
  return Object.entries(known).find(([code]) => message.includes(code))?.[1] ?? message;
}

function setNotice(message, isError = false) {
  el['waiting-notice'].textContent = message;
  el['waiting-notice'].classList.toggle('error', isError);
}

function setConnection(isConnected, label = isConnected ? 'Synchronisé' : 'Reconnexion…') {
  connected = isConnected;
  el['connection-label'].textContent = label;
  el['connection-dot'].classList.toggle('online', isConnected);
}

function setBrainyHistoryStatus(message, linked = false) {
  el['brainy-history-status'].textContent = message;
  el['brainy-history-status'].classList.toggle('brainy-history-linked', linked);
}

async function refreshBrainyProfileStatus(session) {
  if (!session?.user || session.user.is_anonymous) {
    brainyProfile = null;
    setBrainyHistoryStatus(
      'Sans profil BGW : la partie reste jouable, mais elle ne sera pas ajoutée à un historique personnel.',
    );
    return;
  }

  const { data: profile, error } = await client
    .from('profiles')
    .select('id, display_name')
    .eq('id', session.user.id)
    .maybeSingle();
  brainyProfile = error ? null : profile;

  if (!brainyProfile) {
    setBrainyHistoryStatus(
      'Compte reconnu, mais profil BGW introuvable : le résultat ne sera pas relié.',
    );
    return;
  }

  setBrainyHistoryStatus(
    `Profil BGW relié à ${brainyProfile.display_name} · le résultat amical sera validé et enregistré par Supabase.`,
    true,
  );
  el['create-name'].value = brainyProfile.display_name.slice(0, 20);
  el['join-name'].value = brainyProfile.display_name.slice(0, 20);
}

async function rpc(name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

async function ensureSession() {
  if (!url || !publishableKey || !supabaseFactory) {
    throw new Error('La configuration Supabase est absente.');
  }

  client = supabaseFactory(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  let { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  if (!session) {
    const result = await client.auth.signInAnonymously();
    if (result.error) throw result.error;
    session = result.data.session;
  }
  client.realtime.setAuth(session.access_token);
  await refreshBrainyProfileStatus(session);
}

function buildGrid(container, cells) {
  container.replaceChildren();
  cells.forEach((value) => {
    const cell = document.createElement('span');
    cell.className = `pixel-cell ${CELL_CLASS[value] ?? 'empty'}`;
    container.append(cell);
  });
}

function renderCards() {
  el['cards-grid'].replaceChildren();
  if (!puzzle) return;
  puzzle.cards.forEach((card, index) => {
    const fragment = el['card-template'].content.cloneNode(true);
    const button = fragment.querySelector('.puzzle-card');
    fragment.querySelector('.card-number').textContent = index + 1;
    buildGrid(fragment.querySelector('.card-grid'), card);
    button.dataset.cardIndex = index;
    button.classList.add(`model-slot-${CELL_CLASS[puzzle.model[index]] ?? 'empty'}`);
    button.classList.toggle('selected', selectedCards.includes(index));
    button.disabled = !canChooseCards();
    button.addEventListener('click', () => toggleCard(index));
    el['cards-grid'].append(fragment);
  });
}

function canChooseCards() {
  if (!state) return false;
  return [PHASE.ANSWER, PHASE.EXCLUSIVE].includes(state.room.phase)
    && state.room.active_player === state.seat;
}

function toggleCard(index) {
  if (!canChooseCards()) return;
  const position = selectedCards.indexOf(index);
  if (position >= 0) selectedCards.splice(position, 1);
  else if (selectedCards.length < 3) selectedCards.push(index);
  renderSelection();
  renderCards();
}

function renderSelection() {
  el['selection-count'].textContent = `${selectedCards.length} / 3`;
  el['verify-button'].disabled = selectedCards.length !== 3 || !canChooseCards();
  const exclusiveTurn = state.room.phase === PHASE.EXCLUSIVE
    && state.room.active_player === state.seat;
  el['verify-button'].classList.toggle('exclusive-turn', exclusiveTurn);
}

function renderScores() {
  const scores = state.room.scores ?? [0, 0];
  [1, 2].forEach((seat) => {
    const holder = document.querySelector(`[data-score="${seat}"]`);
    holder.replaceChildren();
    for (let point = 0; point < scoreLimit(); point += 1) {
      const pip = document.createElement('i');
      pip.className = point < (scores[seat - 1] ?? 0) ? 'score-pip won' : 'score-pip';
      holder.append(pip);
    }
    document.querySelector(`[data-player-panel="${seat}"]`)?.classList.toggle(
      'active',
      state.room.active_player === seat,
    );
  });
}

function getPlayer(seat) {
  return state.players.find((player) => player.seat === seat);
}

function playerName(seat) {
  return getPlayer(seat)?.display_name ?? `Joueur ${seat}`;
}

function opponentReconnectStatus() {
  if (!state || state.room.status !== 'active') return null;
  const opponentSeat = state.seat === 1 ? 2 : 1;
  const opponent = getPlayer(opponentSeat);
  if (!opponent?.last_seen) return null;

  const ageMs = Math.max(
    0,
    Date.now() + serverOffset - new Date(opponent.last_seen).getTime(),
  );
  if (ageMs < PRESENCE.OFFLINE_AFTER_MS) return null;

  return {
    name: opponent.display_name,
    remainingMs: Math.max(0, PRESENCE.RECONNECT_GRACE_MS - ageMs),
  };
}

function renderPresenceWarning() {
  const reconnect = opponentReconnectStatus();
  if (!reconnect) {
    if (presenceWarningActive) {
      presenceWarningActive = false;
      setPhaseCopy();
    }
    return;
  }

  presenceWarningActive = true;
  el['phase-label'].textContent = 'Adversaire déconnecté';
  el['status-message'].classList.add('presence-warning');
  el['status-message'].textContent = `Reconnexion de ${reconnect.name} : ${formatDuration(reconnect.remainingMs)} avant victoire par forfait.`;
}

function createPuzzle(nextPuzzle) {
  if (!nextPuzzle?.id || !Array.isArray(nextPuzzle.cards) || !Array.isArray(nextPuzzle.model)) return;
  const nextKey = `${nextPuzzle.id}:${nextPuzzle.solution ? 'revealed' : 'hidden'}`;
  if (nextKey === puzzleSeed) return;

  puzzleSeed = nextKey;
  puzzle = {
    cards: nextPuzzle.cards,
    model: nextPuzzle.model,
    solution: nextPuzzle.solution,
  };
  selectedCards = [];
  buildGrid(el['model-grid'], puzzle.model);
  renderCards();
  renderSelection();
}

function setPhaseCopy() {
  const room = state.room;
  el['status-message'].classList.remove('presence-warning');
  el['buzz-button'].disabled = room.phase !== PHASE.SHARED || !connected;
  el['mobile-online-buzzer'].disabled = room.phase !== PHASE.SHARED || !connected;
  const ownTurn = room.active_player === state.seat;
  const copies = {
    [PHASE.SHARED]: ['Buzzer ouvert', 'Espace ou Entrée : soyez le premier à répondre.', 'Temps de réflexion'],
    [PHASE.ANSWER]: ownTurn
      ? ['À vous', 'Sélectionnez exactement trois cartes.', 'Temps de réponse']
      : ['Adversaire', `${playerName(room.active_player)} compose sa réponse…`, 'Temps de réponse'],
    [PHASE.EXCLUSIVE]: ownTurn
      ? ['Seconde chance', 'Vous avez l’exclusivité : choisissez trois cartes.', 'Temps exclusif']
      : ['Adversaire', `${playerName(room.active_player)} a une chance exclusive.`, 'Temps exclusif'],
    [PHASE.REVEAL]: ['Manche terminée', room.last_reason ?? 'La solution est affichée.', 'Résultat'],
    [PHASE.FINISHED]: ['Match terminé', room.last_reason ?? `Le ${scoreFormat()} est terminé.`, 'Résultat'],
  };
  const [label, message, timerLabel] = copies[room.phase] ?? ['Synchronisation', 'État de partie en cours…', 'Temps'];
  el['phase-label'].textContent = label;
  el['status-message'].textContent = message;
  el['phase-timer-label'].textContent = timerLabel;
}

function renderSolutionEquation() {
  el['solution-equation'].replaceChildren();
  if (!puzzle?.solution) return;
  puzzle.solution.trio.forEach((cardIndex, index) => {
    const card = document.createElement('div');
    card.className = 'solution-card-wrap';
    const grid = document.createElement('span');
    grid.className = 'pixel-grid solution-grid';
    const rotation = puzzle.solution.rotations?.[index] ?? 0;
    buildGrid(grid, rotateCard(puzzle.cards[cardIndex], rotation));
    grid.style.setProperty('--delay', `${index * 180}ms`);
    if (rotation > 0) {
      grid.classList.add('needs-rotation');
      grid.style.setProperty('--start-rotation', `${rotation * -90}deg`);
    }
    const label = document.createElement('strong');
    label.textContent = `Carte ${cardIndex + 1} · ${rotation * 90}°`;
    card.append(label, grid);
    el['solution-equation'].append(card);
    if (index < 2) {
      const plus = document.createElement('span');
      plus.className = 'equation-operator';
      plus.textContent = '+';
      el['solution-equation'].append(plus);
    }
  });
  const equals = document.createElement('span');
  equals.className = 'equation-operator';
  equals.textContent = '=';
  const model = document.createElement('div');
  model.className = 'solution-card-wrap final-model';
  const label = document.createElement('strong');
  label.textContent = 'Modèle';
  const grid = document.createElement('span');
  grid.className = 'pixel-grid solution-grid';
  buildGrid(grid, puzzle.model);
  model.append(label, grid);
  el['solution-equation'].append(equals, model);
}

function playSolutionAnimations() {
  const grids = [...el['solution-equation'].querySelectorAll('.solution-grid')];
  grids.forEach((grid) => grid.classList.remove('solution-animating'));
  void el['solution-equation'].offsetWidth;
  requestAnimationFrame(() => {
    grids.forEach((grid) => grid.classList.add('solution-animating'));
  });
}

function renderDialog() {
  const phase = state.room.phase;
  const finished = phase === PHASE.FINISHED;
  if (![PHASE.REVEAL, PHASE.FINISHED].includes(phase)) {
    finishedDialogDismissed = false;
    renderedSolutionKey = null;
    show(el['end-menu-button'], false);
    if (el['reveal-dialog'].open) el['reveal-dialog'].close();
    return;
  }
  show(el['close-reveal-button'], finished);
  show(el['main-menu-button'], finished);
  show(el['end-menu-button'], finished && finishedDialogDismissed);
  el['reveal-kicker'].textContent = finished ? `${scoreFormat()} terminé` : 'Manche terminée';
  el['reveal-title'].textContent = state.room.last_reason ?? 'Voici la combinaison unique';
  el['reveal-message'].textContent = phase === PHASE.FINISHED
    ? `Vous pouvez analyser la solution, puis relancer un nouveau ${scoreFormat()}.`
    : 'Comparez votre raisonnement à la solution avant la manche suivante.';
  el['next-round-button'].textContent = finished ? `Nouveau ${scoreFormat()}` : 'Manche suivante';
  const solutionKey = `${puzzleSeed}:${state.room.round_number}`;
  if (renderedSolutionKey !== solutionKey) {
    renderSolutionEquation();
    renderedSolutionKey = solutionKey;
  }
  if (!finishedDialogDismissed && !el['reveal-dialog'].open) {
    el['reveal-dialog'].showModal();
    playSolutionAnimations();
  }
}

function renderWaiting() {
  show(el['lobby-shell']);
  show(el['game-shell'], false);
  show(el['connection-panel'], false);
  show(el['lobby-screen'], false);
  show(el['waiting-screen']);
  el['waiting-code'].textContent = state.room.code;
  el['waiting-format'].textContent = scoreFormat();
  el['players-list'].replaceChildren();
  state.players.forEach((player) => {
    const article = document.createElement('article');
    article.className = 'player-line';
    const name = document.createElement('strong');
    name.textContent = player.display_name;
    const ready = document.createElement('span');
    ready.className = player.ready ? 'ready-pill ready' : 'ready-pill';
    ready.textContent = player.ready ? 'Prêt' : 'En préparation';
    article.append(name, ready);
    el['players-list'].append(article);
  });
  const me = getPlayer(state.seat);
  el['ready-button'].textContent = me?.ready ? 'Je ne suis plus prêt' : 'Je suis prêt';
  setNotice(state.players.length < 2 ? 'Partagez le code avec votre adversaire.' : 'Les deux joueurs peuvent se déclarer prêts.');
}

function renderGame() {
  show(el['lobby-shell'], false);
  show(el['game-shell']);
  const waitingForOpponent = [PHASE.ANSWER, PHASE.EXCLUSIVE].includes(state.room.phase)
    && state.room.active_player !== state.seat;
  el['game-shell'].classList.toggle('waiting-turn', waitingForOpponent);
  const exclusiveSeat = state.room.phase === PHASE.EXCLUSIVE
    ? state.room.active_player
    : null;
  el.scoreboard.classList.toggle('exclusive-seat-1', exclusiveSeat === 1);
  el.scoreboard.classList.toggle('exclusive-seat-2', exclusiveSeat === 2);
  el['game-code'].textContent = state.room.code;
  el['score-format'].textContent = scoreFormat();
  el['rules-format'].textContent = scoreFormat();
  el['player-one-name'].textContent = playerName(1);
  el['player-two-name'].textContent = playerName(2);
  el['round-number'].textContent = `Manche ${state.room.round_number}`;
  createPuzzle(state.puzzle);
  renderScores();
  setPhaseCopy();
  renderCards();
  renderSelection();
  renderDialog();
}

function stateSignature(next = state) {
  if (!next) return '';
  const players = next.players
    .map((player) => `${player.seat}-${player.display_name}-${player.ready}`)
    .join('|');
  return `${next.room.version}:${players}`;
}

function renderChangedState() {
  const signature = stateSignature();
  if (signature !== lastRenderVersion) {
    lastRenderVersion = signature;
    render();
  }
  tick();
}

function render() {
  if (!state) return;
  if (state.room.phase === PHASE.WAITING) renderWaiting();
  else renderGame();
  syncWakeLock();
}

function remaining(deadline) {
  if (!deadline) return 0;
  return Math.max(0, new Date(deadline).getTime() - (Date.now() + serverOffset));
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function tick() {
  if (!state || state.room.phase === PHASE.WAITING) return;
  el['phase-timer'].textContent = formatDuration(remaining(state.room.phase_deadline));
  el['total-timer'].textContent = formatDuration(remaining(state.room.total_deadline));
  renderPresenceWarning();
}

function pollDelay() {
  if (!state || state.room.phase === PHASE.WAITING) return SYNC.WAITING_POLL_MS;
  if (state.room.phase === PHASE.FINISHED) return SYNC.FINISHED_POLL_MS;
  return SYNC.ACTIVE_POLL_MS;
}

function schedulePoll(delay = pollDelay()) {
  clearTimeout(pollTimer);
  if (!roomId) return;
  pollTimer = setTimeout(async () => {
    await refreshState();
    schedulePoll();
  }, delay);
}

async function refreshState({ syncClock = true } = {}) {
  if (!roomId) return;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const next = await rpc(
        syncClock ? 'elite_pixel_sync_state' : 'elite_pixel_get_state',
        { p_room_id: roomId },
      );
      if (!next?.room) throw new Error('ROOM_NOT_FOUND');
      state = next;
      serverOffset = new Date(next.server_now).getTime() - Date.now();
      setConnection(true);
      renderChangedState();
    } catch (error) {
      setConnection(false);
      if (error?.message?.includes('NOT_MEMBER') || error?.message?.includes('ROOM_NOT_FOUND')) {
        clearRoom();
        showLobby(formatError(error), true);
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function applyRealtimeRoom(payload) {
  if (!state || payload.eventType === 'DELETE' || !payload.new?.id) return;
  const puzzleChanged = payload.new.puzzle_id !== state.room.puzzle_id;
  const solutionRevealed = [PHASE.REVEAL, PHASE.FINISHED].includes(payload.new.phase)
    && !state.puzzle?.solution;

  state = { ...state, room: payload.new };
  if (puzzleChanged || solutionRevealed) {
    void refreshState({ syncClock: false });
  } else {
    renderChangedState();
  }
  schedulePoll();
}

function applyRealtimePlayer(payload) {
  if (!state) return;
  const changed = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!changed?.seat) return;

  const players = state.players.filter((player) => player.seat !== changed.seat);
  if (payload.eventType !== 'DELETE') players.push(changed);
  players.sort((left, right) => left.seat - right.seat);
  state = { ...state, players };
  renderChangedState();
}

async function subscribeToRoom() {
  if (channel) await client.removeChannel(channel);
  channel = client.channel(`elite-pixel-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'elite_pixel_rooms', filter: `id=eq.${roomId}` },
      applyRealtimeRoom,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'elite_pixel_room_players', filter: `room_id=eq.${roomId}` },
      applyRealtimePlayer,
    )
    .subscribe((status) => {
      const subscribed = status === 'SUBSCRIBED';
      setConnection(subscribed, subscribed ? 'Synchronisé' : 'Reconnexion…');
      if (subscribed && state) void refreshState();
    });
  schedulePoll(0);
}

function saveRoom(id) {
  roomId = id;
  localStorage.setItem('elite-pixel-room-id', id);
}

function clearRoom() {
  roomId = null;
  state = null;
  puzzle = null;
  puzzleSeed = null;
  selectedCards = [];
  lastRenderVersion = null;
  finishedDialogDismissed = false;
  presenceWarningActive = false;
  void releaseWakeLock();
  localStorage.removeItem('elite-pixel-room-id');
  clearTimeout(pollTimer);
  pollTimer = null;
  if (channel) client.removeChannel(channel);
  channel = null;
}

function showLobby(message = '', isError = false) {
  show(el['lobby-shell']);
  show(el['game-shell'], false);
  show(el['connection-panel'], false);
  show(el['waiting-screen'], false);
  show(el['lobby-screen']);
  if (message) {
    el['connection-status'].classList.toggle('error', isError);
    el['connection-status'].textContent = message;
    show(el['connection-panel']);
  }
}

async function enterRoom(id) {
  saveRoom(id);
  await subscribeToRoom();
  await refreshState({ syncClock: false });
}

async function createRoom(event) {
  event.preventDefault();
  const name = cleanName(el['create-name'].value);
  const chosenLimit = Number(new FormData(el['create-form']).get('score-limit'));
  if (name.length < 2 || ![1, 2, 3].includes(chosenLimit)) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await rpc('elite_pixel_create_room', {
      p_display_name: name,
      p_score_limit: chosenLimit,
    });
    await enterRoom(result.room_id);
  } catch (error) {
    showLobby(formatError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function joinRoom(event) {
  event.preventDefault();
  const name = cleanName(el['join-name'].value);
  const code = el['room-code'].value.trim().toUpperCase();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await rpc('elite_pixel_join_room', { p_code: code, p_display_name: name });
    await enterRoom(result.room_id);
  } catch (error) {
    showLobby(formatError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function setReady() {
  const me = getPlayer(state.seat);
  try {
    await rpc('elite_pixel_set_ready', { p_room_id: roomId, p_ready: !me.ready });
    await refreshState({ syncClock: false });
  } catch (error) {
    setNotice(formatError(error), true);
  }
}

async function buzz() {
  if (!state || state.room.phase !== PHASE.SHARED || !connected) return;
  el['buzz-button'].disabled = true;
  try {
    await rpc('elite_pixel_buzz', { p_room_id: roomId });
    await refreshState({ syncClock: false });
  } catch (error) {
    el['status-message'].textContent = formatError(error);
    await refreshState();
  }
}

async function verifyAnswer() {
  if (!canChooseCards() || selectedCards.length !== 3) return;
  el['verify-button'].disabled = true;
  try {
    await rpc('elite_pixel_resolve_answer', {
      p_room_id: roomId,
      p_selected_cards: selectedCards,
    });
    selectedCards = [];
    await refreshState({ syncClock: false });
  } catch (error) {
    el['status-message'].textContent = formatError(error);
    await refreshState();
  }
}

async function nextRound() {
  el['next-round-button'].disabled = true;
  finishedDialogDismissed = false;
  show(el['end-menu-button'], false);
  try {
    await rpc('elite_pixel_next_round', { p_room_id: roomId });
    if (el['reveal-dialog'].open) el['reveal-dialog'].close();
    await refreshState({ syncClock: false });
  } catch (error) {
    el['reveal-message'].textContent = formatError(error);
  } finally {
    el['next-round-button'].disabled = false;
  }
}

function leavingWouldForfeitMatch() {
  return Boolean(
    state
    && state.room.phase !== PHASE.WAITING
    && state.room.phase !== PHASE.FINISHED
  );
}

async function leaveRoom() {
  if (!roomId) return;
  if (
    leavingWouldForfeitMatch()
    && !window.confirm(
      'Quitter maintenant donnera la victoire à votre adversaire. Voulez-vous vraiment quitter le salon ?',
    )
  ) return;

  try { await rpc('elite_pixel_leave_room', { p_room_id: roomId }); } catch {}
  clearRoom();
  showLobby();
}

async function copyText(text, button, successLabel) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = successLabel;
  } catch {
    button.textContent = 'Copie impossible';
  }
  setTimeout(() => { button.textContent = original; }, 1800);
}

function bindEvents() {
  el['create-form'].addEventListener('submit', createRoom);
  el['join-form'].addEventListener('submit', joinRoom);
  el['room-code'].addEventListener('input', () => { el['room-code'].value = el['room-code'].value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  el['ready-button'].addEventListener('click', setReady);
  el['buzz-button'].addEventListener('click', buzz);
  el['mobile-online-buzzer'].addEventListener('click', buzz);
  el['verify-button'].addEventListener('click', verifyAnswer);
  el['next-round-button'].addEventListener('click', nextRound);
  el['main-menu-button'].addEventListener('click', () => {
    clearRoom();
  });
  el['close-reveal-button'].addEventListener('click', () => {
    if (state?.room.phase !== PHASE.FINISHED) return;
    finishedDialogDismissed = true;
    el['reveal-dialog'].close();
    show(el['end-menu-button']);
  });
  el['end-menu-button'].addEventListener('click', () => {
    if (state?.room.phase !== PHASE.FINISHED) return;
    finishedDialogDismissed = false;
    show(el['end-menu-button'], false);
    el['reveal-dialog'].showModal();
    playSolutionAnimations();
  });
  el['leave-button'].addEventListener('click', leaveRoom);
  el['game-leave-button'].addEventListener('click', leaveRoom);
  el['copy-code-button'].addEventListener('click', () => copyText(state.room.code, el['copy-code-button'], 'Code copié !'));
  el['copy-link-button'].addEventListener('click', () => {
    const link = new URL('online.html', location.href);
    link.searchParams.set('room', state.room.code);
    copyText(link.href, el['copy-link-button'], 'Lien copié !');
  });
  el['rules-button'].addEventListener('click', () => el['rules-dialog'].showModal());
  el['close-rules-button'].addEventListener('click', () => el['rules-dialog'].close());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    syncWakeLock();
    if (roomId) {
      void refreshState();
      schedulePoll();
    }
  });
  window.addEventListener('online', () => {
    if (!roomId) return;
    void refreshState();
    schedulePoll();
  });
  window.addEventListener('offline', () => setConnection(false));
  document.addEventListener('pointerdown', syncWakeLock);
  document.addEventListener('keydown', (event) => {
    if (!['Space', 'Enter'].includes(event.code) || event.repeat) return;
    if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    buzz();
  });
}

async function init() {
  bindEvents();
  const inviteCode = roomCodeFromUrl();
  if (inviteCode) el['room-code'].value = inviteCode;
  try {
    await ensureSession();
    if (roomId) {
      try {
        const savedState = await rpc('elite_pixel_get_state', { p_room_id: roomId });
        if (savedState?.room?.phase === PHASE.FINISHED) {
          clearRoom();
          showLobby();
          return;
        }
        await enterRoom(roomId);
        return;
      } catch {
        clearRoom();
      }
    }
    showLobby();
  } catch (error) {
    showLobby(`Connexion impossible : ${formatError(error)}`, true);
  }
}

setInterval(tick, 250);
init();

