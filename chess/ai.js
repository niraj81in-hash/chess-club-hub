// ============================================================
// Chess Club Hub — Computer Opponent (Minimax + Alpha-Beta)
// Difficulty levels: Beginner (1), Intermediate (2), Hard (3), Expert (4)
// ============================================================

import { allLegalMoves, makeMove, color, type } from './engine.js';

// ── Piece values ──────────────────────────────────────────────

const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Piece-square tables (white's perspective, mirrored for black)
const PST = {
  P: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  N: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  B: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  R: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  Q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  K: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

// King endgame table (when few pieces remain)
const KING_END = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

// ── Evaluation ────────────────────────────────────────────────

function pstIndex(r, c, col) {
  return col === 'w' ? r * 8 + c : (7 - r) * 8 + c;
}

function isEndgame(board) {
  let queens = 0, minor = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (type(p) === 'Q') queens++;
      if (type(p) === 'N' || type(p) === 'B') minor++;
    }
  return queens === 0 || (queens === 2 && minor <= 1);
}

function evaluate(state) {
  const { board, status, winner } = state;
  if (status === 'checkmate') return winner === 'w' ? 100000 : -100000;
  if (status === 'stalemate') return 0;

  const endgame = isEndgame(board);
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const col = color(p);
      const t   = type(p);
      const idx = pstIndex(r, c, col);
      const sign = col === 'w' ? 1 : -1;
      const table = (t === 'K' && endgame) ? KING_END : (PST[t] || []);
      score += sign * (PIECE_VALUE[t] + (table[idx] || 0));
    }
  }
  return score;
}

// ── Move ordering (capture first, then by piece value) ────────

function orderMoves(state, moves) {
  return moves.slice().sort((a, b) => {
    const capA = state.board[a.to[0]][a.to[1]];
    const capB = state.board[b.to[0]][b.to[1]];
    const valA = capA ? PIECE_VALUE[type(capA)] : 0;
    const valB = capB ? PIECE_VALUE[type(capB)] : 0;
    return valB - valA;
  });
}

// ── Minimax with Alpha-Beta pruning ───────────────────────────

function minimax(state, depth, alpha, beta, maximizing) {
  if (depth === 0 || state.status === 'checkmate' || state.status === 'stalemate')
    return evaluate(state);

  const moves = orderMoves(state, allLegalMoves(state));
  if (!moves.length) return evaluate(state);

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = makeMove(state, m.from, m.to);
      best = Math.max(best, minimax(next, depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const next = makeMove(state, m.from, m.to);
      best = Math.min(best, minimax(next, depth - 1, alpha, beta, true));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ── Difficulty config ─────────────────────────────────────────

export const DIFFICULTY_LEVELS = [
  { label: '🟢 Beginner',      depth: 1, randomness: 0.6 },
  { label: '🟡 Intermediate',  depth: 2, randomness: 0.2 },
  { label: '🔴 Hard',          depth: 3, randomness: 0.05 },
  { label: '⚫ Expert',        depth: 4, randomness: 0    },
];

// ── Best move selector ────────────────────────────────────────

export function getBestMove(state, difficultyIdx = 1) {
  const { depth, randomness } = DIFFICULTY_LEVELS[difficultyIdx];
  const moves = allLegalMoves(state);
  if (!moves.length) return null;

  // Random move injection for lower difficulties
  if (randomness > 0 && Math.random() < randomness) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const maximizing = state.turn === 'w';
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestMoves = [];

  for (const m of orderMoves(state, moves)) {
    const next  = makeMove(state, m.from, m.to);
    const score = minimax(next, depth - 1, -Infinity, Infinity, !maximizing);

    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMoves = [m];
    } else if (score === bestScore) {
      bestMoves.push(m);
    }
  }

  // Pick randomly among equally good moves
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

// ── Web Worker wrapper (prevents UI freeze) ───────────────────
// Call this instead of getBestMove directly for depths 3-4

export function getBestMoveAsync(state, difficultyIdx) {
  return new Promise(resolve => {
    // For low depths, run synchronously
    if (difficultyIdx <= 1) {
      resolve(getBestMove(state, difficultyIdx));
      return;
    }
    // Use setTimeout to yield to UI before heavy computation
    setTimeout(() => {
      resolve(getBestMove(state, difficultyIdx));
    }, 50);
  });
}
