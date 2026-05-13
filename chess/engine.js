// ============================================================
// Chess Club Hub — Chess Engine
// Move validation, check/checkmate/stalemate detection
// ============================================================

export const PIECES = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

export function initBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  const backRank = ['R','N','B','Q','K','B','N','R'];
  for (let c = 0; c < 8; c++) {
    b[0][c] = 'b' + backRank[c];
    b[1][c] = 'bP';
    b[6][c] = 'wP';
    b[7][c] = 'w' + backRank[c];
  }
  return b;
}

export function initGameState() {
  return {
    board: initBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfMove: 0,
    fullMove: 1,
    history: [],       // array of { from, to, piece, captured, promotion, san, boardSnapshot }
    status: 'playing', // 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw'
    winner: null
  };
}

// ── Helpers ──────────────────────────────────────────────────

export function color(piece) { return piece ? piece[0] : null; }
export function type(piece)  { return piece ? piece[1] : null; }
export function opp(c)       { return c === 'w' ? 'b' : 'w'; }

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function cloneBoard(board) { return board.map(r => [...r]); }

// ── Raw move generators (ignore check) ───────────────────────

function pawnMoves(board, r, c, enPassant) {
  const moves = [];
  const p = board[r][c];
  const col = color(p);
  const dir = col === 'w' ? -1 : 1;
  const startRow = col === 'w' ? 6 : 1;

  // Forward
  if (inBounds(r+dir, c) && !board[r+dir][c]) {
    moves.push([r+dir, c]);
    if (r === startRow && !board[r+2*dir][c])
      moves.push([r+2*dir, c]);
  }
  // Captures
  for (const dc of [-1, 1]) {
    const nr = r+dir, nc = c+dc;
    if (!inBounds(nr, nc)) continue;
    if (board[nr][nc] && color(board[nr][nc]) !== col)
      moves.push([nr, nc]);
    // En passant
    if (enPassant && enPassant[0] === nr && enPassant[1] === nc)
      moves.push([nr, nc]);
  }
  return moves;
}

function knightMoves(board, r, c) {
  const moves = [];
  const col = color(board[r][c]);
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = r+dr, nc = c+dc;
    if (inBounds(nr, nc) && color(board[nr][nc]) !== col)
      moves.push([nr, nc]);
  }
  return moves;
}

function slidingMoves(board, r, c, dirs) {
  const moves = [];
  const col = color(board[r][c]);
  for (const [dr, dc] of dirs) {
    let nr = r+dr, nc = c+dc;
    while (inBounds(nr, nc)) {
      if (board[nr][nc]) {
        if (color(board[nr][nc]) !== col) moves.push([nr, nc]);
        break;
      }
      moves.push([nr, nc]);
      nr += dr; nc += dc;
    }
  }
  return moves;
}

function kingMoves(board, r, c) {
  const moves = [];
  const col = color(board[r][c]);
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = r+dr, nc = c+dc;
    if (inBounds(nr, nc) && color(board[nr][nc]) !== col)
      moves.push([nr, nc]);
  }
  return moves;
}

function rawMoves(board, r, c, enPassant) {
  const p = board[r][c];
  if (!p) return [];
  const t = type(p);
  if (t === 'P') return pawnMoves(board, r, c, enPassant);
  if (t === 'N') return knightMoves(board, r, c);
  if (t === 'B') return slidingMoves(board, r, c, [[-1,-1],[-1,1],[1,-1],[1,1]]);
  if (t === 'R') return slidingMoves(board, r, c, [[-1,0],[1,0],[0,-1],[0,1]]);
  if (t === 'Q') return slidingMoves(board, r, c, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
  if (t === 'K') return kingMoves(board, r, c);
  return [];
}

// ── Check detection ───────────────────────────────────────────

export function isInCheck(board, col, enPassant) {
  // Find king
  let kr = -1, kc = -1;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === col + 'K') { kr = r; kc = c; }

  const enemy = opp(col);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (color(board[r][c]) === enemy)
        for (const [mr, mc] of rawMoves(board, r, c, enPassant))
          if (mr === kr && mc === kc) return true;
  return false;
}

// ── Apply a move on a board clone ─────────────────────────────

export function applyMove(board, from, to, promotion = 'Q', enPassant = null) {
  const b = cloneBoard(board);
  const [fr, fc] = from;
  const [tr, tc] = to;
  const piece = b[fr][fc];
  const col = color(piece);
  const t = type(piece);

  let captured = b[tr][tc];
  let newEnPassant = null;
  let castlingUpdates = {};

  // En passant capture
  if (t === 'P' && enPassant && tr === enPassant[0] && tc === enPassant[1]) {
    const capRow = col === 'w' ? tr+1 : tr-1;
    captured = b[capRow][tc];
    b[capRow][tc] = null;
  }

  // Set en passant square
  if (t === 'P' && Math.abs(tr - fr) === 2)
    newEnPassant = [(fr+tr)/2, tc];

  // Castling move
  if (t === 'K') {
    castlingUpdates[col + 'K'] = false;
    castlingUpdates[col + 'Q'] = false;
    if (tc - fc === 2) { b[tr][tc-1] = col+'R'; b[tr][7] = null; } // kingside
    if (fc - tc === 2) { b[tr][tc+1] = col+'R'; b[tr][0] = null; } // queenside
  }

  // Rook moves affect castling
  if (t === 'R') {
    if (fr === 7 && fc === 0) castlingUpdates['wQ'] = false;
    if (fr === 7 && fc === 7) castlingUpdates['wK'] = false;
    if (fr === 0 && fc === 0) castlingUpdates['bQ'] = false;
    if (fr === 0 && fc === 7) castlingUpdates['bK'] = false;
  }

  // Move piece
  b[tr][tc] = piece;
  b[fr][fc] = null;

  // Promotion
  if (t === 'P' && (tr === 0 || tr === 7))
    b[tr][tc] = col + promotion;

  return { board: b, captured, newEnPassant, castlingUpdates };
}

// ── Legal moves (filter moves leaving king in check) ──────────

export function legalMoves(state, r, c) {
  const { board, castling, enPassant } = state;
  const piece = board[r][c];
  if (!piece) return [];
  const col = color(piece);
  const t = type(piece);
  const moves = [];

  for (const [tr, tc] of rawMoves(board, r, c, enPassant)) {
    const { board: nb, newEnPassant } = applyMove(board, [r,c], [tr,tc], 'Q', enPassant);
    if (!isInCheck(nb, col, newEnPassant)) moves.push([tr, tc]);
  }

  // Castling
  if (t === 'K' && !isInCheck(board, col, enPassant)) {
    const row = col === 'w' ? 7 : 0;
    // Kingside
    if (castling[col+'K'] && !board[row][5] && !board[row][6]) {
      const b1 = cloneBoard(board); b1[row][5] = col+'K'; b1[row][4] = null;
      const b2 = cloneBoard(board); b2[row][6] = col+'K'; b2[row][4] = null;
      if (!isInCheck(b1, col) && !isInCheck(b2, col))
        moves.push([row, 6]);
    }
    // Queenside
    if (castling[col+'Q'] && !board[row][3] && !board[row][2] && !board[row][1]) {
      const b1 = cloneBoard(board); b1[row][3] = col+'K'; b1[row][4] = null;
      const b2 = cloneBoard(board); b2[row][2] = col+'K'; b2[row][4] = null;
      if (!isInCheck(b1, col) && !isInCheck(b2, col))
        moves.push([row, 2]);
    }
  }

  return moves;
}

// ── All legal moves for a color ───────────────────────────────

export function allLegalMoves(state) {
  const { board, turn } = state;
  const moves = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (color(board[r][c]) === turn)
        for (const to of legalMoves(state, r, c))
          moves.push({ from: [r,c], to });
  return moves;
}

// ── Make a move and update state ──────────────────────────────

export function makeMove(state, from, to, promotion = 'Q') {
  const { board, turn, castling, enPassant, halfMove, fullMove, history } = state;
  const piece = board[from[0]][from[1]];
  const t = type(piece);

  const { board: nb, captured, newEnPassant, castlingUpdates } = applyMove(board, from, to, promotion, enPassant);

  const newCastling = { ...castling, ...castlingUpdates };
  const newHalf = (t === 'P' || captured) ? 0 : halfMove + 1;
  const newFull = turn === 'b' ? fullMove + 1 : fullMove;
  const newTurn = opp(turn);

  const newState = {
    board: nb,
    turn: newTurn,
    castling: newCastling,
    enPassant: newEnPassant,
    halfMove: newHalf,
    fullMove: newFull,
    history: [...history, {
      from, to, piece, captured, promotion,
      boardSnapshot: cloneBoard(nb),
      enPassantSnapshot: newEnPassant
    }],
    status: 'playing',
    winner: null
  };

  // Update status
  const moves = allLegalMoves(newState);
  const inCheck = isInCheck(nb, newTurn, newEnPassant);

  if (moves.length === 0) {
    if (inCheck) {
      newState.status = 'checkmate';
      newState.winner = turn;
    } else {
      newState.status = 'stalemate';
    }
  } else if (inCheck) {
    newState.status = 'check';
  } else if (newHalf >= 50) {
    newState.status = 'draw';
  }

  return newState;
}

// ── FEN serialiser ───────────────────────────────────────────

export function toFen(state) {
  const pieceMap = {
    wK:'K', wQ:'Q', wR:'R', wB:'B', wN:'N', wP:'P',
    bK:'k', bQ:'q', bR:'r', bB:'b', bN:'n', bP:'p'
  };
  let placement = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p) { if (empty) { placement += empty; empty = 0; } placement += pieceMap[p]; }
      else empty++;
    }
    if (empty) placement += empty;
    if (r < 7) placement += '/';
  }
  let castling = '';
  if (state.castling.wK) castling += 'K';
  if (state.castling.wQ) castling += 'Q';
  if (state.castling.bK) castling += 'k';
  if (state.castling.bQ) castling += 'q';
  if (!castling) castling = '-';
  const files = 'abcdefgh';
  const ep = state.enPassant ? files[state.enPassant[1]] + (8 - state.enPassant[0]) : '-';
  return `${placement} ${state.turn} ${castling} ${ep} ${state.halfMove} ${state.fullMove}`;
}

// ── Simple SAN notation helper ────────────────────────────────

export function toSAN(board, from, to, promotion) {
  const p = board[from[0]][from[1]];
  const t = type(p);
  const files = 'abcdefgh';
  const ranks = '87654321';
  const dest = files[to[1]] + ranks[to[0]];
  if (t === 'P') {
    if (board[to[0]][to[1]] || (Math.abs(to[1]-from[1]) === 1))
      return files[from[1]] + 'x' + dest + (promotion ? promotion : '');
    return dest + (promotion ? '='+promotion : '');
  }
  const cap = board[to[0]][to[1]] ? 'x' : '';
  return t + cap + dest;
}
