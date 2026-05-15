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

// Boots Stockfish directly as the worker. Modern Stockfish builds (v15+) are
// designed to BE the worker — the script registers its own onmessage handler
// and posts UCI output back via postMessage. We talk UCI text directly; no
// wrapper layer is needed. (See engine/analysis.js for the UCI parser.)
//
// Requires same-origin hosting because browsers block cross-origin Worker
// scripts, and the Stockfish runtime loads its .wasm via a relative URL.
export function createEngineWorker(engineId = DEFAULT_ENGINE) {
  const { url, threaded } = pickStockfishUrl(engineId);
  const worker = new Worker(url);
  return { worker, threaded, engineId };
}
