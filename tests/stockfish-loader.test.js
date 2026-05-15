import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pickStockfishUrl } from '../engine/stockfish-loader.js';

const originalSAB = globalThis.SharedArrayBuffer;
const originalCOI = globalThis.crossOriginIsolated;

afterEach(() => {
  if (originalSAB === undefined) delete globalThis.SharedArrayBuffer;
  else globalThis.SharedArrayBuffer = originalSAB;
  if (originalCOI === undefined) delete globalThis.crossOriginIsolated;
  else globalThis.crossOriginIsolated = originalCOI;
});

describe('pickStockfishUrl', () => {
  it('picks single-threaded URL when SAB unavailable', () => {
    delete globalThis.SharedArrayBuffer;
    globalThis.crossOriginIsolated = false;
    const { url, threaded } = pickStockfishUrl('stockfish-16');
    expect(threaded).toBe(false);
    expect(url).toMatch(/single/);
  });

  it('picks single-threaded URL when crossOriginIsolated is false', () => {
    globalThis.SharedArrayBuffer = ArrayBuffer; // stub
    globalThis.crossOriginIsolated = false;
    const { url, threaded } = pickStockfishUrl('stockfish-16');
    expect(threaded).toBe(false);
    expect(url).toMatch(/single/);
  });

  it('picks multi-threaded URL when both SAB and crossOriginIsolated are true', () => {
    globalThis.SharedArrayBuffer = ArrayBuffer; // stub
    globalThis.crossOriginIsolated = true;
    const { url, threaded } = pickStockfishUrl('stockfish-16');
    expect(threaded).toBe(true);
    expect(url).not.toMatch(/single/);
  });

  it('throws for unknown engine id', () => {
    expect(() => pickStockfishUrl('stockfish-99')).toThrow(/Unknown engine/);
  });
});
