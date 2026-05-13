// ============================================================
// Chess Club Hub — Main App Controller (v2)
// Adds: Chess Clock, Computer Opponent, ELO Ratings
// ============================================================

import { initGameState, legalMoves, makeMove, color, type, PIECES, toFen } from './chess/engine.js';
import { exportPGN, downloadPGN }    from './chess/pgn.js';
import { ChessClock, TIME_CONTROLS } from './chess/clock.js';
import { DIFFICULTY_LEVELS, getBestMoveAsync } from './chess/ai.js';
import { getRatingTitle, getPlayerRating, savePlayerRating,
         updateRatingsAfterGame, getEloLeaderboard, recordGameHistory } from './chess/elo.js';
import { getProfile, saveProfile, getGames, saveGame, getGame, deleteGame,
         upsertPlayer, getLeaderboard, getTournaments, saveTournament, genId } from './storage/db.js';
import { createTournament, recordResult, getBracketSummary } from './tournament/bracket.js';
import { generateRoomCode, createRoom, joinRoom, sendMove, onMove,
         onOpponentJoin, sendChat } from './multiplayer/relay.js';

// ── State ─────────────────────────────────────────────────────

let gameState    = null;
let selected     = null;
let hints        = [];
let flipped      = false;
let gameMode     = 'local';   // 'local' | 'cpu' | 'online-host' | 'online-guest'
let myColor      = 'w';
let cpuColor     = 'b';
let cpuDifficulty = 1;
let roomCode     = null;
let playerNames  = { w: 'White', b: 'Black' };
let activeGameId = null;
let annotations  = {};
let clock        = null;
let pendingPromo = null;
let cpuThinking  = false;

// Review
let reviewGame = null;
let reviewIdx  = 0;

// ── Init UI ───────────────────────────────────────────────────

function initUI() {
  // Populate time control selects
  const tcHTML = TIME_CONTROLS.map((tc, i) =>
    `<option value="${i}">${tc.label}</option>`).join('');
  ['local-time-control','cpu-time-control','online-time-control'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = tcHTML; el.value = '4'; } // default: 5 min
  });

  // Difficulty buttons
  const diffEl = document.getElementById('difficulty-btns');
  if (diffEl) {
    diffEl.innerHTML = DIFFICULTY_LEVELS.map((d, i) =>
      `<button class="btn btn-surface btn-sm diff-btn" data-idx="${i}" onclick="setDifficulty(${i})">${d.label}</button>`
    ).join('');
    setDifficulty(1); // default: intermediate
  }

  updatePlayerFields();
  loadProfile();
  renderHome();
}

// ── Navigation ────────────────────────────────────────────────

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => nav(btn.dataset.page));
});

window.nav = function(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
  if (page === 'leaderboard') { renderLeaderboard(); renderEloLeaderboard(); }
  if (page === 'review')      renderReviewList();
  if (page === 'tournament')  renderTournaments();
  if (page === 'home')        renderHome();
};

// ── Profile ───────────────────────────────────────────────────

function loadProfile() {
  const p = getProfile();
  if (p.name) {
    document.getElementById('profile-name').value = p.name;
    updateEloBadge(p.name);
  }
  document.getElementById('stat-wins').textContent   = p.wins;
  document.getElementById('stat-losses').textContent = p.losses;
  document.getElementById('stat-draws').textContent  = p.draws;
}

function updateEloBadge(name) {
  if (!name) return;
  const player = getPlayerRating(name);
  const { title, icon } = getRatingTitle(player.rating);
  document.getElementById('elo-icon').textContent   = icon;
  document.getElementById('elo-rating').textContent = player.rating;
  document.getElementById('elo-title').textContent  = title;
}

window.saveProfileName = function() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) return toast('Enter a name first');
  const p = getProfile();
  p.name = name;
  saveProfile(p);
  updateEloBadge(name);
  toast('Profile saved ✅');
};

// ── Home ──────────────────────────────────────────────────────

function renderHome() {
  loadProfile();
  const games = getGames().slice(0, 5);
  const el = document.getElementById('home-recent-games');
  if (!games.length) { el.innerHTML = '<p style="color:var(--text-dim);font-size:.9rem;">No games yet. Play one!</p>'; return; }
  el.innerHTML = games.map(g => gameCardHTML(g)).join('');
}

function gameCardHTML(g) {
  const icon  = g.result === 'draw' ? '🤝' : g.result === 'w' ? '♔' : '♚';
  const badge = g.myResult === 'win'  ? '<span class="game-badge badge-win">WIN</span>'
              : g.myResult === 'loss' ? '<span class="game-badge badge-loss">LOSS</span>'
              : '<span class="game-badge badge-draw">DRAW</span>';
  return `<div class="game-card" onclick="loadReview('${g.id}')">
    <span class="game-result">${icon}</span>
    <div class="game-meta">
      <div class="game-players">${g.white} vs ${g.black}</div>
      <div class="game-date">${new Date(g.date).toLocaleDateString()}</div>
    </div>
    ${badge}
  </div>`;
}

// ── Play Setup ────────────────────────────────────────────────

function hideAllPanels() {
  ['local-setup','computer-setup','create-room-panel','join-room-panel']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

window.showLocalSetup    = () => { hideAllPanels(); document.getElementById('local-setup').style.display = 'block'; };
window.showComputerSetup = () => { hideAllPanels(); document.getElementById('computer-setup').style.display = 'block';
  const p = getProfile(); if (p.name) document.getElementById('cpu-player-name').value = p.name; };
window.showCreateRoom    = () => { hideAllPanels(); document.getElementById('create-room-panel').style.display = 'block';
  const p = getProfile(); if (p.name) document.getElementById('host-name').value = p.name; };
window.showJoinRoom      = () => { hideAllPanels(); document.getElementById('join-room-panel').style.display = 'block';
  const p = getProfile(); if (p.name) document.getElementById('guest-name').value = p.name; };

window.setDifficulty = function(idx) {
  cpuDifficulty = idx;
  document.querySelectorAll('.diff-btn').forEach((b, i) => {
    b.className = i === idx ? 'btn btn-gold btn-sm diff-btn' : 'btn btn-surface btn-sm diff-btn';
  });
};

window.startGame = function(mode) {
  gameMode = mode;
  let white = 'White', black = 'Black';
  let tcIdx = 4;

  if (mode === 'local') {
    white = document.getElementById('local-white').value.trim() || 'White';
    black = document.getElementById('local-black').value.trim() || 'Black';
    tcIdx = parseInt(document.getElementById('local-time-control').value);
    myColor = 'w';
  } else if (mode === 'cpu') {
    const name = document.getElementById('cpu-player-name').value.trim() || 'Player';
    let col = document.getElementById('cpu-player-color').value;
    if (col === 'r') col = Math.random() < 0.5 ? 'w' : 'b';
    myColor  = col;
    cpuColor = col === 'w' ? 'b' : 'w';
    white = col === 'w' ? name : `CPU (${DIFFICULTY_LEVELS[cpuDifficulty].label})`;
    black = col === 'b' ? name : `CPU (${DIFFICULTY_LEVELS[cpuDifficulty].label})`;
    tcIdx = parseInt(document.getElementById('cpu-time-control').value);
  }

  playerNames = { w: white, b: black };

  // Show ELO ratings next to names
  const wElo = getPlayerRating(white); const bElo = getPlayerRating(black);
  document.getElementById('elo-white').textContent = mode !== 'cpu' ? `${wElo.rating} ELO` : '';
  document.getElementById('elo-black').textContent = mode !== 'cpu' ? `${bElo.rating} ELO` : '';

  startClock(tcIdx);
  launchGame();
};

// ── Clock setup ───────────────────────────────────────────────

function startClock(tcIdx) {
  if (clock) clock.stop();
  const tc = TIME_CONTROLS[tcIdx];
  clock = new ChessClock(
    tc.minutes, tc.increment,
    times => updateTimerDisplay(times),
    loser  => handleTimeout(loser)
  );

  const showTimers = tc.minutes > 0;
  ['timer-white','timer-black'].forEach(id => {
    document.getElementById(id).style.display = showTimers ? 'inline' : 'none';
  });
  if (showTimers) updateTimerDisplay({ w: tc.minutes*60000, b: tc.minutes*60000 });
}

function updateTimerDisplay(times) {
  ['w','b'].forEach(c => {
    const el = document.getElementById(`timer-${c === 'w' ? 'white' : 'black'}`);
    if (!el) return;
    el.textContent = clock.getFormatted(c);
    el.classList.toggle('timer-low', clock.isLow(c));
  });
}

function handleTimeout(loser) {
  if (!gameState) return;
  const winner = loser === 'w' ? 'b' : 'w';
  toast(`⏰ ${playerNames[loser]}'s time ran out! ${playerNames[winner]} wins!`);
  gameState.winner = winner;
  gameState.status = 'checkmate';
  updateStatus();
  finalizeGame();
}

// ── Launch Game ───────────────────────────────────────────────

function launchGame(online = false) {
  gameState    = initGameState();
  selected     = null;
  hints        = [];
  annotations  = {};
  cpuThinking  = false;
  activeGameId = genId();

  document.getElementById('play-setup').style.display = 'none';
  document.getElementById('play-game').style.display  = 'block';
  document.getElementById('name-white').textContent   = playerNames.w;
  document.getElementById('name-black').textContent   = playerNames.b;
  document.getElementById('cpu-thinking').style.display = 'none';

  if (online) {
    document.getElementById('online-info').style.display = 'block';
    document.getElementById('active-room-code').textContent = roomCode;
    document.getElementById('chat-panel').style.display = 'block';
  } else {
    document.getElementById('online-info').style.display = 'none';
    document.getElementById('chat-panel').style.display  = 'none';
  }

  renderBoard();
  renderMoveList();
  updateStatus();
  renderCoords();

  // Start clock on first move (white)
  if (clock?.enabled) clock.start('w');

  // If playing as black vs CPU, let CPU move first
  if (gameMode === 'cpu' && cpuColor === 'w') scheduleCpuMove();
}

// ── Board Rendering ───────────────────────────────────────────

function renderBoard() {
  const board = document.getElementById('chessboard');
  board.innerHTML = '';

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flipped ? 7 - row : row;
      const c = flipped ? 7 - col : col;
      const sq = document.createElement('div');
      sq.className = `sq ${(r+c)%2===0 ? 'light' : 'dark'}`;
      sq.dataset.r = r; sq.dataset.c = c;

      const piece = gameState.board[r][c];
      if (piece) { sq.textContent = PIECES[piece]; sq.dataset.pieceColor = piece[0]; }
      if (selected && selected[0]===r && selected[1]===c) sq.classList.add('selected');
      if (hints.some(([hr,hc]) => hr===r && hc===c))
        sq.classList.add(gameState.board[r][c] ? 'capture-hint' : 'move-hint');
      if (piece && type(piece)==='K' && gameState.status==='check' && color(piece)===gameState.turn)
        sq.classList.add('in-check');

      sq.addEventListener('click', () => onSquareClick(r, c));
      board.appendChild(sq);
    }
  }
}

function renderCoords() {
  const ranks = flipped ? '12345678' : '87654321';
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  document.getElementById('rank-labels').innerHTML = ranks.split('').map(r=>`<span>${r}</span>`).join('');
  document.getElementById('file-labels').innerHTML = files.split('').map(f=>`<span>${f}</span>`).join('');
}

window.flipBoard = function() { flipped = !flipped; renderBoard(); renderCoords(); };

// ── Square Click ──────────────────────────────────────────────

function onSquareClick(r, c) {
  if (!gameState || gameState.status==='checkmate' || gameState.status==='stalemate') return;
  if (cpuThinking) return;
  if (gameMode==='cpu' && gameState.turn===cpuColor) return;
  if (gameMode!=='local' && gameMode!=='cpu' && gameState.turn!==myColor) return;

  const piece = gameState.board[r][c];

  if (selected) {
    const isHint = hints.some(([hr,hc]) => hr===r && hc===c);
    if (isHint) {
      if (type(gameState.board[selected[0]][selected[1]])==='P' && (r===0||r===7)) {
        pendingPromo = { from: selected, to: [r,c] };
        document.getElementById('promo-modal').style.display = 'flex';
        return;
      }
      executeMove(selected, [r,c]);
      return;
    }
    selected = null; hints = [];
    if (piece && color(piece)===gameState.turn) { selected=[r,c]; hints=legalMoves(gameState,r,c); }
  } else {
    if (piece && color(piece)===gameState.turn) { selected=[r,c]; hints=legalMoves(gameState,r,c); }
  }
  renderBoard();
}

// ── Execute Move ──────────────────────────────────────────────

function executeMove(from, to, promotion='Q') {
  const movingColor = gameState.turn;
  gameState = makeMove(gameState, from, to, promotion);
  selected = null; hints = [];

  // Switch clock
  if (clock?.enabled) clock.switch(movingColor);

  renderBoard();
  renderMoveList();
  updateStatus();
  autoSave();

  if (gameMode !== 'local') sendMove(roomCode, { from, to, promotion });

  if (gameState.status==='checkmate'||gameState.status==='stalemate') {
    if (clock) clock.stop();
    setTimeout(() => finalizeGame(), 400);
    return;
  }

  // CPU response
  if (gameMode==='cpu' && gameState.turn===cpuColor) scheduleCpuMove();
}

window.promote = function(piece) {
  document.getElementById('promo-modal').style.display = 'none';
  if (pendingPromo) { executeMove(pendingPromo.from, pendingPromo.to, piece); pendingPromo=null; }
};

// ── CPU Move ──────────────────────────────────────────────────

function scheduleCpuMove() {
  if (cpuThinking) return;
  cpuThinking = true;
  document.getElementById('cpu-thinking').style.display = 'block';

  getBestMoveAsync(gameState, cpuDifficulty).then(move => {
    cpuThinking = false;
    document.getElementById('cpu-thinking').style.display = 'none';
    if (!move || !gameState) return;
    executeMove(move.from, move.to);
  });
}

// ── Remote moves ──────────────────────────────────────────────

function handleRemoteMove(moveData) {
  if (color(gameState.board[moveData.from[0]][moveData.from[1]])===myColor) return;
  executeMove(moveData.from, moveData.to, moveData.promotion||'Q');
}

// ── Online rooms ──────────────────────────────────────────────

window.createOnlineRoom = async function() {
  const name = document.getElementById('host-name').value.trim() || 'Host';
  const tcIdx = parseInt(document.getElementById('online-time-control').value);
  roomCode = generateRoomCode();
  playerNames = { w: name, b: '...' };
  gameMode = 'online-host'; myColor = 'w';
  document.getElementById('room-code-display').style.display = 'block';
  document.getElementById('room-code-text').textContent = roomCode;
  try {
    await createRoom(roomCode, name);
    onOpponentJoin(guestName => { playerNames.b = guestName; toast(`${guestName} joined!`); startClock(tcIdx); launchGame(true); });
    onMove(handleRemoteMove);
  } catch(e) { toast('Firebase not configured. See README.'); console.error(e); }
};

window.joinOnlineRoom = async function() {
  const name = document.getElementById('guest-name').value.trim() || 'Guest';
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length!==6) return toast('Enter a 6-character room code');
  gameMode='online-guest'; myColor='b'; roomCode=code;
  try {
    const data = await joinRoom(code, name);
    playerNames = { w: data.host, b: name };
    onMove(handleRemoteMove);
    startClock(4);
    launchGame(true);
  } catch(e) { toast(e.message||'Could not join room'); }
};

window.copyRoomCode = () => { navigator.clipboard.writeText(roomCode); toast('Room code copied!'); };

// ── Status bar ────────────────────────────────────────────────

function updateStatus() {
  const el = document.getElementById('game-status');
  const { status, turn, winner } = gameState;
  el.className = 'status-bar ' + status;
  if (status==='checkmate') el.textContent = `♛ Checkmate! ${playerNames[winner]} wins!`;
  else if (status==='stalemate') el.textContent = `🤝 Stalemate — Draw!`;
  else if (status==='check') el.textContent = `⚠️ ${playerNames[turn]} is in Check!`;
  else if (status==='draw') el.textContent = `🤝 Draw (50-move rule)`;
  else el.textContent = `${playerNames[turn]}'s turn`;

  document.getElementById('bar-white').classList.toggle('active', turn==='w');
  document.getElementById('bar-black').classList.toggle('active', turn==='b');
}

// ── Move list ─────────────────────────────────────────────────

function renderMoveList() {
  const el = document.getElementById('move-list');
  const hist = gameState.history;
  let html = '';
  for (let i=0;i<hist.length;i+=2) {
    const wm=hist[i], bm=hist[i+1];
    html+=`<div class="move-pair">
      <span class="move-num">${i/2+1}.</span>
      <span class="move-san${i===hist.length-1?' active':''}">${moveSAN(wm)}</span>
      ${bm?`<span class="move-san${i+1===hist.length-1?' active':''}">${moveSAN(bm)}</span>`:''}
    </div>`;
  }
  el.innerHTML = html || '<span style="color:var(--text-dim)">No moves yet</span>';
  el.scrollTop = el.scrollHeight;
}

function moveSAN(m) {
  if (!m) return '';
  const files='abcdefgh', ranks='87654321';
  const t=type(m.piece), dest=files[m.to[1]]+ranks[m.to[0]];
  if (t==='P') return (m.captured||Math.abs(m.to[1]-m.from[1])===1) ? files[m.from[1]]+'x'+dest : dest;
  return t+(m.captured?'x':'')+dest;
}

// ── Game actions ──────────────────────────────────────────────

window.offerDraw = function() {
  if (!gameState) return;
  if (confirm('Accept a draw?')) { gameState.status='stalemate'; if(clock)clock.stop(); finalizeGame('draw'); }
};

window.resignGame = function() {
  if (!gameState||!confirm('Resign?')) return;
  const winner = gameState.turn==='w'?'b':'w';
  gameState.winner=winner; gameState.status='checkmate';
  if(clock)clock.stop();
  updateStatus(); finalizeGame();
};

window.endAndSave = function() { autoSave(true); toast('Game saved!'); backToSetup(); };

function backToSetup() {
  document.getElementById('play-setup').style.display='block';
  document.getElementById('play-game').style.display='none';
  hideAllPanels();
}

// ── ELO finalization ──────────────────────────────────────────

function finalizeGame(forceResult) {
  const { status, winner } = gameState;
  let result = forceResult;
  if (!result) {
    if (status==='checkmate') result = winner;
    else result = 'draw';
  }

  autoSave(true, result);

  // Skip ELO update for CPU games or no result yet
  if (gameMode==='cpu' || !result) {
    setTimeout(() => { showEloModal(null); }, 300);
    return;
  }

  const eloResult = updateRatingsAfterGame(playerNames.w, playerNames.b, result);
  setTimeout(() => showEloModal(eloResult, result), 300);
}

function showEloModal(eloResult, result) {
  const modal = document.getElementById('elo-modal');
  const title = document.getElementById('elo-modal-title');
  const body  = document.getElementById('elo-modal-body');

  if (!eloResult) {
    // CPU game — just show result
    const { status, winner } = gameState;
    title.textContent = status==='checkmate' ? `${playerNames[winner]} wins! 🎉`
                      : status==='stalemate' ? "Stalemate — Draw! 🤝" : "Game Over";
    body.innerHTML = `<p style="color:var(--text-dim);text-align:center;">ELO ratings are tracked in Club (non-CPU) games.</p>`;
  } else {
    const wTitle = getRatingTitle(eloResult.newWhiteRating);
    const bTitle = getRatingTitle(eloResult.newBlackRating);
    const msg = result==='w' ? `${playerNames.w} wins! 🎉`
              : result==='b' ? `${playerNames.b} wins! 🎉`
              : "Draw! 🤝";
    title.textContent = msg;
    body.innerHTML = `
      <div style="display:flex;gap:1rem;justify-content:center;margin-bottom:1rem;">
        <div style="text-align:center;flex:1;">
          <div style="font-size:1.5rem;">${wTitle.icon}</div>
          <div style="font-weight:700;">${playerNames.w}</div>
          <div style="font-size:1.4rem;font-family:monospace;color:var(--gold);">${eloResult.newWhiteRating}</div>
          <div style="font-size:.85rem;color:${eloResult.changeA>=0?'var(--emerald)':'var(--red)'};">
            ${eloResult.changeA>=0?'+':''}${eloResult.changeA} ELO
          </div>
          <div style="font-size:.75rem;color:var(--text-dim);">${wTitle.title}</div>
        </div>
        <div style="text-align:center;flex:1;">
          <div style="font-size:1.5rem;">${bTitle.icon}</div>
          <div style="font-weight:700;">${playerNames.b}</div>
          <div style="font-size:1.4rem;font-family:monospace;color:var(--gold);">${eloResult.newBlackRating}</div>
          <div style="font-size:.85rem;color:${eloResult.changeB>=0?'var(--emerald)':'var(--red)'};">
            ${eloResult.changeB>=0?'+':''}${eloResult.changeB} ELO
          </div>
          <div style="font-size:.75rem;color:var(--text-dim);">${bTitle.title}</div>
        </div>
      </div>`;
  }

  modal.style.display = 'flex';
}

window.closeEloModal = function() {
  document.getElementById('elo-modal').style.display = 'none';
  backToSetup();
  renderHome();
};

// ── Auto-save ─────────────────────────────────────────────────

function autoSave(final=false, result) {
  const profile = getProfile();
  const myName  = profile.name||'Me';
  const r       = result || gameState.winner || (gameState.status==='stalemate'?'draw':null);

  const record = {
    id: activeGameId, white: playerNames.w, black: playerNames.b,
    date: new Date().toISOString(), result: r, moves: gameState.history,
    status: gameState.status, annotations,
    myResult: !r?null: r==='draw'?'draw':
      playerNames[r]?.toLowerCase()===myName.toLowerCase()?'win':'loss',
    mode: gameMode,
  };
  saveGame(record);

  if (final && r) {
    const myRole = playerNames.w.toLowerCase()===myName.toLowerCase()?'w':'b';
    const myRes  = r==='draw'?'draw':r===myRole?'win':'loss';
    const p = getProfile();
    if(myRes==='win') p.wins++; if(myRes==='loss') p.losses++; if(myRes==='draw') p.draws++;
    saveProfile(p);
    upsertPlayer(playerNames.w, r==='draw'?'draw':r==='w'?'win':'loss');
    upsertPlayer(playerNames.b, r==='draw'?'draw':r==='b'?'win':'loss');
  }
}

// ── Chat ──────────────────────────────────────────────────────

window.sendChatMsg = function() {
  const input=document.getElementById('chat-input');
  const text=input.value.trim();
  if(!text||!roomCode) return;
  const sender=gameMode==='online-host'?playerNames.w:playerNames.b;
  sendChat(roomCode,sender,text);
  appendChat(sender,text);
  input.value='';
};

function appendChat(sender,text) {
  const box=document.getElementById('chat-messages');
  box.innerHTML+=`<div class="chat-msg"><span class="sender">${sender}:</span> ${text}</div>`;
  box.scrollTop=box.scrollHeight;
}

// ── Review ────────────────────────────────────────────────────

function renderReviewList() {
  const games=getGames();
  const el=document.getElementById('review-games-list');
  if(!games.length){el.innerHTML='<p style="color:var(--text-dim);">No saved games yet.</p>';return;}
  el.innerHTML=games.map(g=>gameCardHTML(g)).join('');
}

window.loadReview = function(id) {
  reviewGame=getGame(id); if(!reviewGame) return;
  reviewIdx=reviewGame.moves.length;
  document.getElementById('review-list').style.display='none';
  document.getElementById('review-board-view').style.display='block';
  renderReviewBoard(); renderReviewMoveList();
};

window.backToList = function() {
  document.getElementById('review-list').style.display='block';
  document.getElementById('review-board-view').style.display='none';
  engineController?.abort();
  renderReviewList();
};

// ── Lichess cloud engine eval ─────────────────────────────────

let engineController = null;

async function fetchEngineEval(fen) {
  const evalEl   = document.getElementById('engine-eval');
  const linesEl  = document.getElementById('engine-lines');
  const depthEl  = document.getElementById('engine-depth');
  const statusEl = document.getElementById('engine-status');

  engineController?.abort();
  engineController = new AbortController();

  evalEl.textContent  = '…';
  evalEl.style.color  = 'var(--text-dim)';
  linesEl.innerHTML   = '';
  depthEl.textContent = '';
  statusEl.textContent = '';

  try {
    const res = await fetch(
      `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=3`,
      { signal: engineController.signal }
    );
    if (!res.ok) { statusEl.textContent = 'Position not in cloud cache'; evalEl.textContent = '—'; return; }
    const data = await res.json();
    depthEl.textContent = `depth ${data.depth}`;
    const pvs = data.pvs || [];
    if (!pvs.length) { evalEl.textContent = '—'; return; }

    const top = pvs[0];
    if (top.mate != null) {
      const m = top.mate;
      evalEl.textContent = m > 0 ? `M${m}` : `-M${Math.abs(m)}`;
      evalEl.style.color = m > 0 ? 'var(--emerald)' : 'var(--red)';
    } else {
      const cp = top.cp / 100;
      evalEl.textContent = (cp >= 0 ? '+' : '') + cp.toFixed(2);
      evalEl.style.color = cp > 0.3 ? 'var(--emerald)' : cp < -0.3 ? 'var(--red)' : 'var(--text)';
    }

    linesEl.innerHTML = pvs.map(pv => {
      const score = pv.mate != null
        ? (pv.mate > 0 ? `M${pv.mate}` : `-M${Math.abs(pv.mate)}`)
        : ((pv.cp >= 0 ? '+' : '') + (pv.cp / 100).toFixed(2));
      const moves = pv.moves.split(' ').slice(0, 6).join(' ');
      return `<div><span style="color:var(--gold);display:inline-block;min-width:3.5rem;">${score}</span>${moves}</div>`;
    }).join('');
  } catch (e) {
    if (e.name !== 'AbortError') { statusEl.textContent = 'Engine unavailable'; evalEl.textContent = '—'; }
  }
}

window.reviewNav = function(dir) {
  if(!reviewGame)return;
  const max=reviewGame.moves.length;
  if(dir==='start') reviewIdx=0; if(dir==='end') reviewIdx=max;
  if(dir==='prev')  reviewIdx=Math.max(0,reviewIdx-1);
  if(dir==='next')  reviewIdx=Math.min(max,reviewIdx+1);
  renderReviewBoard(); renderReviewMoveList();
};

function renderReviewBoard() {
  const board=document.getElementById('review-board');
  board.innerHTML='';
  let state=initGameState();
  for(let i=0;i<reviewIdx;i++){const m=reviewGame.moves[i];state=makeMove(state,m.from,m.to,m.promotion||'Q');}
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const sq=document.createElement('div');
    sq.className=`sq ${(r+c)%2===0?'light':'dark'}`;
    const piece=state.board[r][c]; if(piece) { sq.textContent=PIECES[piece]; sq.dataset.pieceColor=piece[0]; }
    board.appendChild(sq);
  }
  document.getElementById('annotation-text').value=(reviewGame.annotations||{})[reviewIdx]||'';
  fetchEngineEval(toFen(state));
}

function renderReviewMoveList() {
  const el=document.getElementById('review-move-list');
  const moves=reviewGame.moves; let html='';
  for(let i=0;i<moves.length;i+=2){
    const wm=moves[i],bm=moves[i+1];
    html+=`<div class="move-pair"><span class="move-num">${i/2+1}.</span>
      <span class="move-san${reviewIdx===i+1?' active':''}" onclick="jumpReview(${i+1})">${moveSAN(wm)}</span>
      ${bm?`<span class="move-san${reviewIdx===i+2?' active':''}" onclick="jumpReview(${i+2})">${moveSAN(bm)}</span>`:''}
    </div>`;
  }
  el.innerHTML=html||'<span style="color:var(--text-dim)">No moves</span>';
}

window.jumpReview  = function(idx){reviewIdx=idx;renderReviewBoard();renderReviewMoveList();};
window.saveAnnotation = function(){if(!reviewGame)return;reviewGame.annotations=reviewGame.annotations||{};reviewGame.annotations[reviewIdx]=document.getElementById('annotation-text').value.trim();saveGame(reviewGame);toast('Annotation saved ✅');};
window.exportCurrentGame = function(){if(!reviewGame)return;downloadPGN({white:reviewGame.white,black:reviewGame.black,result:reviewGame.result==='w'?'1-0':reviewGame.result==='b'?'0-1':'1/2-1/2',date:reviewGame.date?.slice(0,10),moves:reviewGame.moves},`${reviewGame.white}-vs-${reviewGame.black}.pgn`);};
window.deleteCurrentGame = function(){if(!reviewGame||!confirm('Delete this game?'))return;deleteGame(reviewGame.id);backToList();toast('Game deleted');};

// ── Tournament ────────────────────────────────────────────────

window.showNewTournament = ()=>{ document.getElementById('new-tournament-form').style.display='block'; updatePlayerFields(); };
window.hideNewTournament = ()=>{ document.getElementById('new-tournament-form').style.display='none'; };
document.getElementById('t-size')?.addEventListener('change', updatePlayerFields);

function updatePlayerFields() {
  const size=parseInt(document.getElementById('t-size')?.value||4);
  const container=document.getElementById('t-player-fields');
  if(!container) return;
  container.innerHTML='';
  for(let i=0;i<size;i++) container.innerHTML+=`<div class="field"><label>Player ${i+1}</label><input type="text" class="t-player" placeholder="Name..." maxlength="20" /></div>`;
}

window.createTournamentNow = function() {
  const name=document.getElementById('t-name').value.trim()||'Tournament';
  const inputs=[...document.querySelectorAll('.t-player')];
  const players=inputs.map(i=>i.value.trim()).filter(Boolean);
  if(players.length!==inputs.length) return toast('Fill in all player names');
  try{const t=createTournament(name,players);saveTournament(t);hideNewTournament();renderTournaments();toast(`Tournament "${name}" created! 🏆`);}
  catch(e){toast(e.message);}
};

function renderTournaments() {
  const list=getTournaments();
  const el=document.getElementById('tournament-list');
  if(!list.length){el.innerHTML='<p style="color:var(--text-dim)">No tournaments yet.</p>';return;}
  el.innerHTML=list.map(t=>{
    const summary=getBracketSummary(t);
    return `<div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h2 style="margin:0;">🏆 ${t.name}</h2>
        <span style="font-size:.8rem;color:var(--text-dim);">${t.status==='complete'?`👑 Winner: ${t.winner}`:'In Progress'}</span>
      </div>
      <div class="bracket">${summary.map(r=>`
        <div class="bracket-round">
          <div class="bracket-round-label">${r.label}</div>
          ${r.matches.map(m=>`<div class="bracket-match">
            <div class="bracket-player ${m.result==='white'?'winner':''} ${!m.white?'pending':''}">${m.white||'TBD'}</div>
            <div class="bracket-player ${m.result==='black'?'winner':''} ${!m.black?'pending':''}">${m.black||'TBD'}</div>
            ${m.status==='ready'&&t.status!=='complete'?`<div style="padding:.4rem;display:flex;gap:.25rem;justify-content:center;">
              <button class="btn btn-gold btn-sm"    onclick="recordTournamentResult('${t.id}','${m.id}','white')">W</button>
              <button class="btn btn-outline btn-sm" onclick="recordTournamentResult('${t.id}','${m.id}','draw')">D</button>
              <button class="btn btn-surface btn-sm" onclick="recordTournamentResult('${t.id}','${m.id}','black')">B</button>
            </div>`:''}
          </div>`).join('')}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

window.recordTournamentResult = function(tId,matchId,result) {
  let t=getTournaments().find(x=>x.id===tId); if(!t)return;
  let ri=-1,mi=-1;
  t.rounds.forEach((r,rIdx)=>r.matches.forEach((m,mIdx)=>{if(m.id===matchId){ri=rIdx;mi=mIdx;}}));
  if(ri<0) return;
  t=recordResult(t,ri,mi,result); saveTournament(t); renderTournaments();
  if(t.status==='complete'){toast(`🎉 Winner: ${t.winner}`);upsertPlayer(t.winner,'win');}
};

// ── Leaderboard ───────────────────────────────────────────────

window.switchTab = function(tab) {
  document.getElementById('lb-elo').style.display  = tab==='elo'  ? 'block' : 'none';
  document.getElementById('lb-wins').style.display = tab==='wins' ? 'block' : 'none';
  document.getElementById('tab-elo').className  = tab==='elo'  ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
  document.getElementById('tab-wins').className = tab==='wins' ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
};

function renderLeaderboard() {
  const players=getLeaderboard();
  const body=document.getElementById('leaderboard-body');
  if(!players.length){body.innerHTML='<tr><td colspan="7" style="color:var(--text-dim);text-align:center;padding:1rem;">No players yet</td></tr>';return;}
  body.innerHTML=players.map((p,i)=>{
    const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1;
    const games=p.wins+p.losses+p.draws;
    return `<tr><td class="${rc}">${medal}</td><td>${p.name}</td>
      <td class="${rc}" style="font-weight:700;">${p.wins+p.draws*.5}</td>
      <td style="color:var(--emerald);">${p.wins}</td>
      <td style="color:#ef4444;">${p.losses}</td>
      <td style="color:var(--text-dim);">${p.draws}</td>
      <td style="color:var(--text-dim);">${games}</td></tr>`;
  }).join('');
}

function renderEloLeaderboard() {
  const players=getEloLeaderboard();
  const body=document.getElementById('elo-body');
  if(!players.length){body.innerHTML='<tr><td colspan="8" style="color:var(--text-dim);text-align:center;padding:1rem;">No ELO data yet — play some rated games!</td></tr>';return;}
  body.innerHTML=players.map((p,i)=>{
    const {title,icon,color:tc}=getRatingTitle(p.rating);
    const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1;
    const games=p.gamesPlayed;
    return `<tr><td class="${rc}">${medal}</td><td style="font-weight:600;">${p.name}</td>
      <td><span style="font-size:.8rem;">${icon}</span> <span style="color:${tc};font-size:.8rem;">${title}</span></td>
      <td class="${rc}" style="font-weight:700;font-family:monospace;">${p.rating}</td>
      <td style="color:var(--emerald);">${p.wins}</td>
      <td style="color:#ef4444;">${p.losses}</td>
      <td style="color:var(--text-dim);">${p.draws}</td>
      <td style="color:var(--text-dim);">${games}</td></tr>`;
  }).join('');
}

// ── Toast ──────────────────────────────────────────────────────

function toast(msg) {
  const el=document.createElement('div'); el.className='toast'; el.textContent=msg;
  document.body.appendChild(el); setTimeout(()=>el.remove(),3000);
}
window.toast=toast;

// ── Boot ──────────────────────────────────────────────────────

initUI();
