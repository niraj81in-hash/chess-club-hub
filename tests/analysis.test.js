import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the loader so analysis.js doesn't spawn a real Stockfish worker.
// Stockfish IS the worker — talks UCI text directly via postMessage. The mock
// emulates the bits of the UCI protocol that analysis.js relies on.
vi.mock('../engine/stockfish-loader.js', () => {
  return {
    createEngineWorker: () => {
      const listeners = new Set();
      let currentDepth = null;
      const emit = (line) => listeners.forEach((cb) => cb({ data: line }));
      const worker = {
        postMessage: vi.fn((cmd) => {
          // analysis.js only sends UCI strings to the worker.
          const s = String(cmd);
          queueMicrotask(() => {
            if (s === 'uci') {
              emit('uciok');
            } else if (s === 'isready') {
              emit('readyok');
            } else if (s.startsWith('go depth ')) {
              currentDepth = parseInt(s.split(' ')[2], 10);
              emit(`info depth ${currentDepth} multipv 1 score cp 42 pv e2e4`);
              emit('bestmove e2e4');
            } else if (s === 'stop') {
              if (currentDepth != null) emit('bestmove e2e4');
            }
            // 'setoption ...' and 'position fen ...' produce no UCI reply.
          });
        }),
        addEventListener: (event, cb) => { if (event === 'message') listeners.add(cb); },
        removeEventListener: (event, cb) => { if (event === 'message') listeners.delete(cb); },
        terminate: vi.fn(),
        __listeners: listeners,
      };
      return { worker, threaded: false, engineId: 'stockfish-16' };
    },
  };
});

import { analyzePosition, cancel } from '../engine/analysis.js';

const FEN_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_INVALID = 'not a fen';

beforeEach(() => {
  cancel();
  vi.unstubAllGlobals();
});

describe('analyzePosition — cloud first', () => {
  it('returns cloud result when Lichess responds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ depth: 18, pvs: [{ cp: 15, moves: 'e2e4 e7e5' }] }),
    })));
    const r = await analyzePosition(FEN_START, { depth: 14 });
    expect(r.source).toBe('cloud');
    expect(r.cp).toBe(15);
    expect(r.reachedDepth).toBe(18);
  });

  it('falls back to local when Lichess returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const r = await analyzePosition(FEN_START, { depth: 14 });
    expect(r.source).toBe('local');
    expect(r.cp).toBe(42); // from the mocked worker
  });

  it('falls back to local when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await analyzePosition(FEN_START, { depth: 14 });
    expect(r.source).toBe('local');
  });

  it('returns terminal result for an invalid FEN without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await analyzePosition(FEN_INVALID, { depth: 14 });
    expect(r.cp).toBe(null);
    expect(r.mate).toBe(null);
    expect(r.reason).toBe('terminal');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('analyzePosition — cancellation', () => {
  it('a second call cancels the first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const first = analyzePosition(FEN_START, { depth: 14 });
    const second = analyzePosition(FEN_START, { depth: 14 });
    const r2 = await second;
    expect(r2.source).toBe('local');
    // The first call should have been cancelled; awaiting it should throw or resolve to a cancellation marker.
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });
});

import { analyzeGame } from '../engine/analysis.js';
import { initGameState, makeMove } from '../chess/engine.js';

describe('analyzeGame — full-game pass', () => {
  it('returns one eval per position (initial + after each move)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const moves = [
      { from: [6, 4], to: [4, 4] },  // e2e4
      { from: [1, 4], to: [3, 4] },  // e7e5
    ];
    const result = await analyzeGame(moves, { depth: 10 });
    expect(result.evals.length).toBe(3);   // initial + after move 1 + after move 2
    expect(result.qualities.length).toBe(2); // one per actual move
  });

  it('streams progress for each position', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const moves = [{ from: [6, 4], to: [4, 4] }, { from: [1, 4], to: [3, 4] }];
    const updates = [];
    await analyzeGame(moves, { depth: 10 }, (p) => updates.push(p));
    expect(updates.length).toBe(3);
    expect(updates[0]).toMatchObject({ index: 0, total: 3 });
    expect(updates[2]).toMatchObject({ index: 2, total: 3 });
  });

  it('sends correct FENs to fetch (start position + after e4)', async () => {
    const fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      fetchCalls.push(url);
      return { ok: false, status: 404 };
    }));
    await analyzeGame([{ from: [6, 4], to: [4, 4] }], { depth: 10 });
    // 2 positions = 2 fetch calls.
    expect(fetchCalls.length).toBe(2);
    // Initial position: start FEN, white to move, all castling rights, no en passant.
    expect(decodeURIComponent(fetchCalls[0])).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq');
    // After e4: black to move, all castling rights, en passant on e3.
    expect(decodeURIComponent(fetchCalls[1])).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3');
  });
});
