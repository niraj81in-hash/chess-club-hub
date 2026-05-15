import { createEngineWorker } from './stockfish-loader.js';
import { initGameState, makeMove } from '../chess/engine.js';
import { classify } from './move-quality.js';

// ── Cheap FEN sanity check — pre-empts both engines for terminal/garbage input.
function isPlausibleFen(fen) {
  if (typeof fen !== 'string') return false;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return false;
  // First field: 8 ranks separated by '/', each rank made of pieces or digits 1-8.
  const ranks = parts[0].split('/');
  if (ranks.length !== 8) return false;
  return parts[1] === 'w' || parts[1] === 'b';
}

// ── Worker lifecycle (lazy, persistent across analyses).
let workerCtx = null;        // { worker, ready }
let workerReadyPromise = null;

function ensureWorker() {
  if (workerCtx) return workerReadyPromise;
  const { worker } = createEngineWorker();
  workerCtx = { worker, ready: false };
  // Worker crashes: reset state so the next analyzePosition recreates the worker.
  worker.addEventListener('error', () => {
    workerCtx = null;
    workerReadyPromise = null;
    if (activeRequest) {
      const req = activeRequest;
      activeRequest = null;
      const err = new Error('Engine crashed');
      err.name = 'EngineError';
      req.reject(err);
    }
  });
  workerReadyPromise = new Promise((resolve, reject) => {
    const onMessage = (e) => {
      if (!workerCtx) return;
      const m = e.data;
      if (m.type === 'ready') { workerCtx.ready = true; worker.removeEventListener('message', onMessage); resolve(); }
      else if (m.type === 'error' && !workerCtx.ready) {
        worker.removeEventListener('message', onMessage);
        workerCtx = null;
        workerReadyPromise = null;
        reject(new Error(m.message || 'Engine failed to load'));
      }
    };
    worker.addEventListener('message', onMessage);
  });
  return workerReadyPromise;
}

// ── Active request state (one at a time — calling analyzePosition cancels prior).
let activeRequest = null;    // { abort, reject, listener }

export function cancel() {
  if (!activeRequest) return;
  const req = activeRequest;
  activeRequest = null;
  req.abort();
  if (workerCtx?.worker) {
    workerCtx.worker.postMessage({ type: 'stop' });
    if (req.listener) workerCtx.worker.removeEventListener('message', req.listener);
  }
  const err = new Error('Analysis cancelled');
  err.name = 'AbortError';
  req.reject(err);
}

export async function analyzePosition(fen, options = {}) {
  cancel();

  const depth = options.depth ?? 18;
  const multiPV = options.multiPV ?? 3;

  if (!isPlausibleFen(fen)) {
    return { source: 'local', depth, reachedDepth: 0, cp: null, mate: null, pvs: [], reason: 'terminal' };
  }

  // ── Step 1: try Lichess cloud-eval.
  const ctl = new AbortController();
  const pending = new Promise((resolve, reject) => {
    activeRequest = {
      abort: () => ctl.abort(),
      reject,
      listener: null,
      resolve,
    };
  });
  // Capture this invocation's request token so we can detect — after
  // any await — whether we are still the active request or have been
  // superseded by a newer call to analyzePosition (which would have
  // already rejected `pending` via cancel()).
  const myRequest = activeRequest;
  // Attach a swallow-handler so this promise being rejected before
  // anyone awaits it does not surface as an unhandled rejection. The
  // real consumer (the async-return below) still sees the rejection
  // because `return pending` re-attaches.
  pending.catch(() => {});

  try {
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPV}`;
    const res = await fetch(url, { signal: ctl.signal });
    // If a newer call superseded us during the fetch await, `pending`
    // has already been rejected with AbortError by cancel().
    if (activeRequest !== myRequest) return pending;
    if (res.ok) {
      const data = await res.json();
      if (activeRequest !== myRequest) return pending;
      // Empty pvs from a 200 response → treat as cloud-miss and fall through to local.
      if (data && data.pvs && data.pvs.length) {
        const top = data.pvs[0];
        const result = {
          source: 'cloud',
          depth,
          reachedDepth: data.depth ?? depth,
          cp: top.mate != null ? null : top.cp,
          mate: top.mate ?? null,
          pvs: data.pvs.map((p) => ({ cp: p.mate != null ? null : p.cp, mate: p.mate ?? null, moves: p.moves })),
        };
        if (activeRequest === myRequest) { activeRequest.resolve(result); activeRequest = null; }
        return result;
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      // cancel() already rejected `pending`.
      return pending;
    }
    // any other fetch error → fall through to local
  }

  // ── Step 2: local Stockfish.
  if (activeRequest !== myRequest) return pending;
  try {
    await ensureWorker();
    if (activeRequest !== myRequest) return pending;
    const worker = workerCtx.worker;
    const result = await new Promise((resolve, reject) => {
      if (activeRequest !== myRequest) {
        const err = new Error('Analysis cancelled');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      let lastInfo = null;
      const listener = (e) => {
        const m = e.data;
        if (m.type === 'info' && m.multipv === 1) {
          lastInfo = m;
        } else if (m.type === 'bestmove') {
          worker.removeEventListener('message', listener);
          const out = lastInfo
            ? {
                source: 'local',
                depth,
                reachedDepth: lastInfo.depth ?? depth,
                cp: lastInfo.mate != null ? null : lastInfo.cp,
                mate: lastInfo.mate ?? null,
                pvs: [{ cp: lastInfo.mate != null ? null : lastInfo.cp, mate: lastInfo.mate ?? null, moves: lastInfo.pv }],
              }
            : { source: 'local', depth, reachedDepth: 0, cp: null, mate: null, pvs: [] };
          resolve(out);
        } else if (m.type === 'error') {
          worker.removeEventListener('message', listener);
          reject(Object.assign(new Error(m.message || 'Engine error'), { name: 'EngineError' }));
        }
      };
      worker.addEventListener('message', listener);
      activeRequest.listener = listener;
      worker.postMessage({ type: 'analyze', fen, depth, multiPV });
    });

    if (activeRequest === myRequest) activeRequest = null;
    return result;
  } catch (e) {
    if (activeRequest === myRequest) activeRequest = null;
    throw e;
  }
}

// Build a FEN-ish string from a state object (chess/engine.js produces piece codes like 'wK').
// Minimal correct FEN for analysis — only board, side, castling, en passant, half/full moves.
function stateToFen(state) {
  const PIECE_FEN = { wK:'K', wQ:'Q', wR:'R', wB:'B', wN:'N', wP:'P', bK:'k', bQ:'q', bR:'r', bB:'b', bN:'n', bP:'p' };
  const rankStrs = state.board.map((row) => {
    let s = '';
    let empty = 0;
    for (const sq of row) {
      if (!sq) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += PIECE_FEN[sq];
    }
    if (empty) s += empty;
    return s;
  });
  let castling = '';
  if (state.castling?.wK) castling += 'K';
  if (state.castling?.wQ) castling += 'Q';
  if (state.castling?.bK) castling += 'k';
  if (state.castling?.bQ) castling += 'q';
  if (!castling) castling = '-';
  let ep = '-';
  if (state.enPassant) {
    const [r, c] = state.enPassant;
    ep = String.fromCharCode(97 + c) + (8 - r);
  }
  return `${rankStrs.join('/')} ${state.turn} ${castling} ${ep} ${state.halfMove ?? 0} ${state.fullMove ?? 1}`;
}

// Iterates positions (initial + after each move), analyzes each, classifies each move.
// onProgress: called after each position with { index, total, eval, classification }.
export async function analyzeGame(moves, options = {}, onProgress = () => {}) {
  const depth = options.depth ?? 14;
  const total = moves.length + 1;
  const evals = [];
  const qualities = [];

  // Build the sequence of positions by replaying moves through the engine.
  let state = initGameState();
  const positions = [state];
  for (const m of moves) {
    state = makeMove(state, m.from, m.to, m.promotion || 'Q');
    positions.push(state);
  }

  for (let i = 0; i < positions.length; i++) {
    const fen = stateToFen(positions[i]);
    const ev = await analyzePosition(fen, { depth, multiPV: 1 });
    evals.push({ cp: ev.cp, mate: ev.mate, depth: ev.reachedDepth });

    let classification = null;
    if (i > 0) {
      // The side that just moved is the OPPOSITE of positions[i].turn.
      const sideJustMoved = positions[i].turn === 'w' ? 'b' : 'w';
      classification = classify(evals[i - 1], evals[i], sideJustMoved);
      qualities.push(classification);
    }
    onProgress({ index: i, total, eval: evals[i], classification });
  }

  return { evals, qualities, depth, version: 'stockfish-16', ranAt: Date.now() };
}
