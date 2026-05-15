// Registry of available Stockfish engines. Adding a future version is a single
// entry here — analysis.js and the UI consume this registry by id.

export const ENGINES = {
  'stockfish-17': {
    label: 'Stockfish 17',
    // Single-threaded build — works in every browser, no special headers required.
    st: 'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/src/stockfish-nnue-16-single.js',
    // Multi-threaded build — requires SharedArrayBuffer + COOP/COEP headers.
    // Currently unreachable in v1 (headers not enabled); included so the loader can
    // pick it up automatically once task #13b lands.
    mt: 'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/src/stockfish-nnue-16.js',
  },
};

export const DEFAULT_ENGINE = 'stockfish-17';

export function getEngine(id) {
  const e = ENGINES[id];
  if (!e) throw new Error(`Unknown engine: ${id}`);
  return e;
}
