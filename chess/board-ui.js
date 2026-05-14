// ============================================================
// Chess Club Hub — Board UI
// SVG pieces, drag & drop, animation, highlights, captured trays
// ============================================================

// ── SVG Piece Definitions (Merida / Lichess style) ───────────

const SVG = {
  wK: `<svg viewBox="0 0 45 45" class="piece"><g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#fff" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5.5-11.5-15-7.5C3 14.5 5 23 8 27l4.5 10z" fill="#fff"/><path d="M12.5 30c5.5-3 14.5-3 20 0M12.5 33.5c5.5-3 14.5-3 20 0M12.5 37c5.5-3 14.5-3 20 0"/></g></svg>`,
  wQ: `<svg viewBox="0 0 45 45" class="piece"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM24.5 7.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16 8.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM33 8.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/><path d="M9 26c8.5-8.5 15.5-8.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z" stroke-linecap="butt"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1 2.5-1 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c4-1.5 17-1.5 21 0" fill="none"/></g></svg>`,
  wR: `<svg viewBox="0 0 45 45" class="piece"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 39h27v-3H9zM12 36v-4h21v4M11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap="butt"/><path d="M34 14l-3 3H14l-3-3"/><path d="M31 17v12.5H14V17" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/><path d="M11 14h23" fill="none" stroke-linejoin="miter"/></g></svg>`,
  wB: `<svg viewBox="0 0 45 45" class="piece"><g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g fill="#fff" stroke-linecap="butt"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-.5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></g><path d="M17.5 26h10M15 30h15" stroke-linejoin="miter"/></g></svg>`,
  wN: `<svg viewBox="0 0 45 45" class="piece"><g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#fff"/><path d="M24 18c.38 5.12-1.8 8.36-5 10l-5 2c-4 1-2.69 2.42-.5 6 1.54 1 3 1.5 3 5.5 0 0 1.5 1 3.5 1h2c.5-2.5 3-4 3-5.5 0-2.5-1.5-4-2-5.5 0 0 .5-2 1.5-3.5" fill="#fff"/><path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5.43-9.75a.5 1.5 55 1 1-.87-.5.5 1.5 55 0 1 .87.5z" fill="#000" stroke="#000"/></g></svg>`,
  wP: `<svg viewBox="0 0 45 45" class="piece"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  bK: `<svg viewBox="0 0 45 45" class="piece"><g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#000" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5.5-11.5-15-7.5C3 14.5 5 23 8 27l4.5 10z" fill="#000"/><path d="M12.5 30c5.5-3 14.5-3 20 0M12.5 33.5c5.5-3 14.5-3 20 0M12.5 37c5.5-3 14.5-3 20 0" stroke="#fff"/></g></svg>`,
  bQ: `<svg viewBox="0 0 45 45" class="piece"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM24.5 7.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16 8.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM33 8.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/><path d="M9 26c8.5-8.5 15.5-8.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z" stroke-linecap="butt"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1 2.5-1 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c4-1.5 17-1.5 21 0" stroke="#fff" fill="none"/></g></svg>`,
  bR: `<svg viewBox="0 0 45 45" class="piece"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 39h27v-3H9zM12.5 32l1.5-2.5h17l1.5 2.5zM12 36v-4h21v4" stroke-linecap="butt"/><path d="M14 29.5v-13h17v13" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M14 16.5L11 14h23l-3 2.5" stroke-linecap="butt"/><path d="M11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap="butt"/><path d="M12 35.5h21M13 31.5h19M14 29.5h17M14 16.5h17M11 14h23" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="miter"/></g></svg>`,
  bB: `<svg viewBox="0 0 45 45" class="piece"><g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g fill="#000" stroke-linecap="butt"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-.5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></g><path d="M17.5 26h10M15 30h15" stroke="#fff" stroke-linejoin="miter"/></g></svg>`,
  bN: `<svg viewBox="0 0 45 45" class="piece"><g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#000"/><path d="M24 18c.38 5.12-1.8 8.36-5 10l-5 2c-4 1-2.69 2.42-.5 6 1.54 1 3 1.5 3 5.5 0 0 1.5 1 3.5 1h2c.5-2.5 3-4 3-5.5 0-2.5-1.5-4-2-5.5 0 0 .5-2 1.5-3.5" fill="#000"/><path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5.43-9.75a.5 1.5 55 1 1-.87-.5.5 1.5 55 0 1 .87.5z" fill="#fff" stroke="#fff"/></g></svg>`,
  bP: `<svg viewBox="0 0 45 45" class="piece"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

const PIECE_VALUES = { Q: 9, R: 5, B: 3, N: 3, P: 1 };

// ── Module state ──────────────────────────────────────────────

let _boardEl   = null;
let _onMove    = null;   // callback(from, to, promotion)
let _onPreMove = null;   // callback(from, to)

// Drag state
let _drag = null; // { fromR, fromC, floatEl, ... }

// ── Public API ────────────────────────────────────────────────

export function mount(boardEl, { onMove, onPreMove }) {
  _boardEl   = boardEl;
  _onMove    = onMove;
  _onPreMove = onPreMove ?? null;
  _boardEl.addEventListener('pointerdown', _onPointerDown);
}

export function render(gameState, {
  selected      = null,
  hints         = [],
  lastMove      = null,
  preMove       = null,
  capturedByTop    = [],
  capturedByBottom = [],
  flipped       = false,
  interactive   = true,
} = {}) {
  _buildSquares(gameState, { selected, hints, lastMove, preMove, flipped, interactive });
  _renderCaptured('captured-top',    capturedByTop);
  _renderCaptured('captured-bottom', capturedByBottom);
}

export function animateMove(from, to, pieceCode, onComplete) {
  const pieceSvg = SVG[pieceCode] ?? '';
  const fromEl = _squareEl(from[0], from[1]);
  const toEl   = _squareEl(to[0],   to[1]);
  if (!fromEl || !toEl || !pieceSvg) { onComplete(); return; }

  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();

  const float = document.createElement('div');
  float.innerHTML = pieceSvg;
  float.style.cssText = `
    position:fixed;left:${fr.left}px;top:${fr.top}px;
    width:${fr.width}px;height:${fr.height}px;
    pointer-events:none;z-index:999;
    transition:transform 180ms cubic-bezier(0.16,1,0.3,1);
  `;
  document.body.appendChild(float);

  // Hide the piece on the source square during flight
  const srcPiece = fromEl.querySelector('svg');
  if (srcPiece) srcPiece.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    float.style.transform = `translate(${tr.left - fr.left}px,${tr.top - fr.top}px)`;
  });

  float.addEventListener('transitionend', () => {
    float.remove();
    if (srcPiece) srcPiece.style.visibility = '';
    onComplete();
  }, { once: true });
}

// ── Internal: board rendering ─────────────────────────────────

const FILES = 'abcdefgh';
const RANKS = '87654321';

function _buildSquares(gameState, { selected, hints, lastMove, preMove, flipped, interactive }) {
  _boardEl.innerHTML = '';

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flipped ? 7 - row : row;
      const c = flipped ? 7 - col : col;

      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      sq.dataset.r = r;
      sq.dataset.c = c;

      // Highlights
      if (lastMove) {
        if (lastMove.from[0] === r && lastMove.from[1] === c) sq.classList.add('last-from');
        if (lastMove.to[0]   === r && lastMove.to[1]   === c) sq.classList.add('last-to');
      }
      if (selected && selected[0] === r && selected[1] === c) sq.classList.add('selected');
      if (preMove) {
        if (preMove.from[0] === r && preMove.from[1] === c) sq.classList.add('premove');
        if (preMove.to[0]   === r && preMove.to[1]   === c) sq.classList.add('premove');
      }

      const isHint = hints.some(([hr, hc]) => hr === r && hc === c);
      if (isHint) {
        sq.classList.add(gameState.board[r][c] ? 'capture-hint' : 'move-hint');
      }

      // In-check highlight
      const piece = gameState.board[r][c];
      if (piece && (gameState.status === 'check' || gameState.status === 'checkmate') &&
          piece[1] === 'K' && piece[0] === gameState.turn) {
        sq.classList.add('in-check');
      }

      // Piece SVG
      if (piece && SVG[piece]) sq.innerHTML = SVG[piece];

      // Coordinate labels on edge squares
      if ((!flipped && c === 0) || (flipped && c === 7)) {
        const span = document.createElement('span');
        span.className = 'coord-rank';
        span.textContent = RANKS[r];
        sq.appendChild(span);
      }
      if ((!flipped && r === 7) || (flipped && r === 0)) {
        const span = document.createElement('span');
        span.className = 'coord-file';
        span.textContent = FILES[c];
        sq.appendChild(span);
      }

      if (interactive || isHint) sq.style.cursor = 'pointer';
      _boardEl.appendChild(sq);
    }
  }
}

function _squareEl(r, c) {
  return _boardEl ? _boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`) : null;
}

// ── Internal: captured pieces tray ───────────────────────────

function _renderCaptured(elId, pieces) {
  const el = document.getElementById(elId);
  if (!el) return;

  const sorted = [...pieces].sort((a, b) => (PIECE_VALUES[b[1]] ?? 0) - (PIECE_VALUES[a[1]] ?? 0));

  // Material advantage: total value of pieces in this tray
  const myMat  = pieces.reduce((s, p) => s + (PIECE_VALUES[p[1]] ?? 0), 0);

  el.innerHTML = sorted.map(p => `<span class="cap-piece">${SVG[p]}</span>`).join('');
  // Advantage label is added by app.js which has both totals
}

// ── Internal: drag & drop ─────────────────────────────────────

function _onPointerDown(e) {
  if (!_boardEl) return;
  const sq = e.target.closest('[data-r]');
  if (!sq) return;

  const r = +sq.dataset.r;
  const c = +sq.dataset.c;
  const pieceEl = sq.querySelector('svg');
  if (!pieceEl) return;

  e.preventDefault();

  const rect = sq.getBoundingClientRect();
  const float = document.createElement('div');
  float.innerHTML = pieceEl.outerHTML;
  float.style.cssText = `
    position:fixed;
    left:${rect.left}px;top:${rect.top}px;
    width:${rect.width}px;height:${rect.height}px;
    pointer-events:none;z-index:999;opacity:0.85;
  `;
  document.body.appendChild(float);

  // Dim source square
  pieceEl.style.visibility = 'hidden';

  _drag = {
    fromR: r, fromC: c,
    floatEl: float,
    srcPieceEl: pieceEl,
  };

  window.addEventListener('pointermove', _onPointerMove);
  window.addEventListener('pointerup',   _onPointerUp, { once: true });
}

function _onPointerMove(e) {
  if (!_drag) return;
  const { floatEl } = _drag;
  const w = floatEl.offsetWidth;
  floatEl.style.left = (e.clientX - w / 2) + 'px';
  floatEl.style.top  = (e.clientY - w / 2) + 'px';

  // Highlight target square
  if (_boardEl) {
    _boardEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }
  const target = _squareAtPoint(e.clientX, e.clientY);
  if (target) target.classList.add('drag-over');
}

function _onPointerUp(e) {
  if (!_drag) return;
  window.removeEventListener('pointermove', _onPointerMove);

  const { fromR, fromC, floatEl, srcPieceEl } = _drag;
  _drag = null;

  floatEl.remove();
  if (srcPieceEl) srcPieceEl.style.visibility = '';
  if (_boardEl) {
    _boardEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }

  const target = _squareAtPoint(e.clientX, e.clientY);
  if (!target) return;

  const toR = +target.dataset.r;
  const toC = +target.dataset.c;
  if (toR === fromR && toC === fromC) return;

  if (target.classList.contains('move-hint') || target.classList.contains('capture-hint')) {
    _onMove?.([fromR, fromC], [toR, toC]);
  } else {
    _onPreMove?.([fromR, fromC], [toR, toC]);
  }
}

function _squareAtPoint(x, y) {
  if (!_boardEl) return null;
  const els = document.elementsFromPoint(x, y);
  return els.find(el => el.dataset?.r !== undefined && el.closest('#chessboard')) ?? null;
}
