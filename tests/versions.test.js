import { describe, it, expect } from 'vitest';
import { ENGINES, DEFAULT_ENGINE, getEngine } from '../engine/versions.js';

describe('engine registry', () => {
  it('has stockfish-16 as the default', () => {
    expect(DEFAULT_ENGINE).toBe('stockfish-16');
    expect(ENGINES[DEFAULT_ENGINE]).toBeDefined();
  });

  it('stockfish-16 has label and same-origin .js paths for both builds', () => {
    const e = ENGINES['stockfish-16'];
    expect(e.label).toBe('Stockfish 16');
    expect(typeof e.st).toBe('string');
    expect(typeof e.mt).toBe('string');
    // Stockfish is bundled locally — cross-origin Workers are browser-blocked,
    // and the runtime needs to load its .wasm via a relative URL.
    expect(e.st).toMatch(/^\/engine\/stockfish\/.*\.js$/);
    expect(e.mt).toMatch(/^\/engine\/stockfish\/.*\.js$/);
    expect(e.st).toContain('single');   // single-threaded build distinguishable
    expect(e.mt).not.toContain('single');
  });

  it('getEngine returns the engine record for a known id', () => {
    const e = getEngine('stockfish-16');
    expect(e.label).toBe('Stockfish 16');
  });

  it('getEngine throws for an unknown id', () => {
    expect(() => getEngine('stockfish-99')).toThrow(/Unknown engine/);
  });
});
