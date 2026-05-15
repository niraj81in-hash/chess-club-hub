import { createEngineWorker } from './stockfish-loader.js';

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
