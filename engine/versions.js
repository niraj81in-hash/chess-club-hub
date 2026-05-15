// Registry of available Stockfish engines. The id and label must match the
// actual binary version on the CDN (e.g. 'stockfish-16' for Stockfish 16
// NNUE). When a newer Stockfish becomes available on the same CDN, add a new
// entry (e.g. 'stockfish-17' → SF17 URLs) rather than mutating this one, and
// update DEFAULT_ENGINE to point at it.

export const ENGINES = {
  'stockfish-16': {
    label: 'Stockfish 16',
    // Bundled locally because cross-origin Workers are blocked by the browser
    // regardless of CORS headers — and the Stockfish runtime tries to load its
    // .wasm via a relative URL, which only resolves correctly when the .js and
    // .wasm are co-located at the same origin. See engine/stockfish/ for the
    // binaries (sourced from npm `stockfish@16.0.0`).

    // Single-threaded build — works in every browser, no special headers required.
    st: '/engine/stockfish/stockfish-nnue-16-single.js',
    // Multi-threaded build — requires SharedArrayBuffer + COOP/COEP headers.
    // Currently unreachable in v1 (headers not enabled); included so the loader can
    // pick it up automatically once task #13b lands.
    mt: '/engine/stockfish/stockfish-nnue-16.js',
  },
};

export const DEFAULT_ENGINE = 'stockfish-16';

export function getEngine(id) {
  const e = ENGINES[id];
  if (!e) throw new Error(`Unknown engine: ${id}`);
  return e;
}
