import { createEngineWorker } from './stockfish-loader.js';
import { DEFAULT_ENGINE } from './versions.js';
import { initGameState, makeMove, toFen } from '../chess/engine.js';
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

// ── UCI info-line parser.
// Example line: "info depth 14 seldepth 18 multipv 1 score cp 23 nodes ... pv e2e4 e7e5 g1f3"
function parseInfoLine(line) {
  const parts = line.split(' ');
  const out = { multipv: 1, depth: null, cp: null, mate: null, pv: '' };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === 'depth')        out.depth   = parseInt(parts[++i], 10);
    else if (p === 'multipv') out.multipv = parseInt(parts[++i], 10);
    else if (p === 'cp')      out.cp      = parseInt(parts[++i], 10);
    else if (p === 'mate')    out.mate    = parseInt(parts[++i], 10);
    else if (p === 'pv')    { out.pv = parts.slice(i + 1).join(' '); break; }
  }
  if (out.depth == null || out.pv === '') return null;
  return out;
}

// ── Worker lifecycle (lazy, persistent across analyses).
// The worker IS Stockfish — we talk UCI text directly via postMessage.
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
    let gotUciOk = false;
    const onMessage = (e) => {
      if (!workerCtx) return;
      const line = typeof e.data === 'string' ? e.data : '';
      if (!gotUciOk && line === 'uciok') {
        gotUciOk = true;
        worker.postMessage('isready');
        return;
      }
      if (gotUciOk && line === 'readyok') {
        workerCtx.ready = true;
        worker.removeEventListener('message', onMessage);
        resolve();
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage('uci');
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
    workerCtx.worker.postMessage('stop');
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
  // Capture this invocation's request token so we can detect — after any
  // await — whether we've been superseded by a newer call to analyzePosition.
  const myRequest = activeRequest;
  // Swallow-handler prevents unhandled-rejection noise during the window
  // between cancel() rejecting `pending` and the real consumer awaiting it.
  pending.catch(() => {});

  try {
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPV}`;
    const res = await fetch(url, { signal: ctl.signal });
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

  // ── Step 2: local Stockfish (talk UCI text directly).
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
        const line = typeof e.data === 'string' ? e.data : '';
        if (!line) return;
        if (line.startsWith('info ') && line.includes(' pv ')) {
          const info = parseInfoLine(line);
          if (info && info.multipv === 1) lastInfo = info;
        } else if (line.startsWith('bestmove ')) {
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
        }
      };
      worker.addEventListener('message', listener);
      activeRequest.listener = listener;
      worker.postMessage(`setoption name MultiPV value ${multiPV}`);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });

    if (activeRequest === myRequest) activeRequest = null;
    return result;
  } catch (e) {
    if (activeRequest === myRequest) activeRequest = null;
    throw e;
  }
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
    const fen = toFen(positions[i]);
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

  return { evals, qualities, depth, version: DEFAULT_ENGINE, ranAt: Date.now() };
}
