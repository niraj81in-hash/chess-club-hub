import { describe, it, expect } from 'vitest';
import { classify } from '../engine/move-quality.js';

// Evaluation objects use the same shape as the engine output:
// { cp: number|null, mate: number|null }  — both from white's POV.
//   cp > 0  → white is better
//   mate >0 → white mates in N
//   mate <0 → black mates in N

describe('classify — centipawn loss thresholds', () => {
  it('cp loss < 10 → best', () => {
    // White moves, eval was +50, now +45 → white lost 5cp → best
    expect(classify({ cp: 50, mate: null }, { cp: 45, mate: null }, 'w')).toBe('best');
  });
  it('cp loss 10..24 → excellent', () => {
    expect(classify({ cp: 50, mate: null }, { cp: 35, mate: null }, 'w')).toBe('excellent');
  });
  it('cp loss 25..49 → good', () => {
    expect(classify({ cp: 50, mate: null }, { cp: 20, mate: null }, 'w')).toBe('good');
  });
  it('cp loss 50..99 → inaccuracy', () => {
    expect(classify({ cp: 50, mate: null }, { cp: -10, mate: null }, 'w')).toBe('inaccuracy');
  });
  it('cp loss 100..199 → mistake', () => {
    expect(classify({ cp: 50, mate: null }, { cp: -100, mate: null }, 'w')).toBe('mistake');
  });
  it('cp loss >=200 → blunder', () => {
    expect(classify({ cp: 50, mate: null }, { cp: -200, mate: null }, 'w')).toBe('blunder');
  });

  it('inverts perspective for black moves', () => {
    // Black moves, eval was -50 (good for black), now -45 → black lost 5cp → best
    expect(classify({ cp: -50, mate: null }, { cp: -45, mate: null }, 'b')).toBe('best');
    // Black moves, eval was -50, now +100 → black lost 150cp → mistake
    expect(classify({ cp: -50, mate: null }, { cp: 100, mate: null }, 'b')).toBe('mistake');
  });
});

describe('classify — mate handling', () => {
  it('mover maintains a winning mate → best', () => {
    // White had M3, plays the mating move, now M2 → best
    expect(classify({ cp: null, mate: 3 }, { cp: null, mate: 2 }, 'w')).toBe('best');
  });
  it('mover throws away a winning mate → blunder', () => {
    // White had M3, blundered into no-mate position with +200 → blunder
    expect(classify({ cp: null, mate: 3 }, { cp: 200, mate: null }, 'w')).toBe('blunder');
  });
  it('mover slows down a winning mate → mistake', () => {
    // White had M3, plays a move that delays mate to M5 → mistake
    expect(classify({ cp: null, mate: 3 }, { cp: null, mate: 5 }, 'w')).toBe('mistake');
  });
  it('mover escapes a losing mate → best', () => {
    // White was getting mated in 4, defended to a -200 cp position → best (escape)
    expect(classify({ cp: null, mate: -4 }, { cp: -200, mate: null }, 'w')).toBe('best');
  });
  it('mover walks into a mate → blunder', () => {
    // White had +100, blundered into M-3 (getting mated) → blunder
    expect(classify({ cp: 100, mate: null }, { cp: null, mate: -3 }, 'w')).toBe('blunder');
  });
  it('mover finds a mate → best', () => {
    // White had +200, found M3 → best
    expect(classify({ cp: 200, mate: null }, { cp: null, mate: 3 }, 'w')).toBe('best');
  });
});

describe('classify — null inputs', () => {
  it('returns null for missing eval', () => {
    expect(classify(null, { cp: 0, mate: null }, 'w')).toBe(null);
    expect(classify({ cp: 0, mate: null }, null, 'w')).toBe(null);
  });
});
