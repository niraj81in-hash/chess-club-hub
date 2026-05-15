import { getEngine, DEFAULT_ENGINE } from './versions.js';

// Returns { url, threaded } for the chosen engine, picking the multi-threaded
// build when SharedArrayBuffer is available AND the page is crossOriginIsolated.
// `crossOriginIsolated` is only true when the page is served with
// Cross-Origin-Opener-Policy: same-origin AND Cross-Origin-Embedder-Policy: require-corp.
export function pickStockfishUrl(engineId = DEFAULT_ENGINE) {
  const engine = getEngine(engineId);
  const canSAB =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated === true;
  return { url: canSAB ? engine.mt : engine.st, threaded: canSAB, engineId };
}

// Boots our wrapper worker and tells it which Stockfish URL to load.
// The wrapper worker lives at /engine/stockfish-worker.js and proxies UCI ↔ postMessage.
export function createEngineWorker(engineId = DEFAULT_ENGINE) {
  const { url, threaded, engineId: id } = pickStockfishUrl(engineId);
  const worker = new Worker('/engine/stockfish-worker.js');
  worker.postMessage({ type: 'init', stockfishUrl: url });
  return { worker, threaded, engineId: id };
}
