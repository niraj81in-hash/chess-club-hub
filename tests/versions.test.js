import { describe, it, expect } from 'vitest';
import { ENGINES, DEFAULT_ENGINE, getEngine } from '../engine/versions.js';

describe('engine registry', () => {
  it('has stockfish-16 as the default', () => {
    expect(DEFAULT_ENGINE).toBe('stockfish-16');
    expect(ENGINES[DEFAULT_ENGINE]).toBeDefined();
  });

  it('stockfish-16 has label, st URL, mt URL', () => {
    const e = ENGINES['stockfish-16'];
    expect(e.label).toBe('Stockfish 16');
    expect(typeof e.st).toBe('string');
    expect(typeof e.mt).toBe('string');
    expect(e.st).toMatch(/^https:/);
    expect(e.mt).toMatch(/^https:/);
  });

  it('getEngine returns the engine record for a known id', () => {
    const e = getEngine('stockfish-16');
    expect(e.label).toBe('Stockfish 16');
  });

  it('getEngine throws for an unknown id', () => {
    expect(() => getEngine('stockfish-99')).toThrow(/Unknown engine/);
  });
});
