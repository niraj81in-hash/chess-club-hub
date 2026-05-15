import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the loader so analysis.js doesn't try to spawn a real Worker.
vi.mock('../engine/stockfish-loader.js', () => {
  return {
    createEngineWorker: () => {
      const listeners = new Set();
      const worker = {
        postMessage: vi.fn((msg) => {
          // Simulate Stockfish responses on the next microtask.
          queueMicrotask(() => {
            if (msg.type === 'analyze') {
              listeners.forEach((cb) => cb({ data: { type: 'info', depth: msg.depth, cp: 42, mate: null, multipv: 1, pv: 'e2e4' } }));
              listeners.forEach((cb) => cb({ data: { type: 'bestmove', move: 'e2e4' } }));
            }
          });
        }),
        addEventListener: (event, cb) => { if (event === 'message') listeners.add(cb); },
        removeEventListener: (event, cb) => { if (event === 'message') listeners.delete(cb); },
        terminate: vi.fn(),
        __listeners: listeners,
      };
      // Fire 'ready' on the next tick.
      queueMicrotask(() => listeners.forEach((cb) => cb({ data: { type: 'ready' } })));
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
