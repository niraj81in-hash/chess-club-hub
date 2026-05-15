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
