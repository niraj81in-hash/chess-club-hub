import { describe, it, expect } from 'vitest';
import { exportPGN } from '../pgn.js';

describe('exportPGN', () => {
  it('generates valid PGN with tags and moves', () => {
    const record = {
      white: 'Alice',
      black: 'Bob',
      result: '1-0',
      date: '2026-01-15',
      event: 'Club Match',
      moves: [
        { san: 'e4' },
        { san: 'e5' },
        { san: 'Nf3' },
      ],
    };
    const pgn = exportPGN(record);
    expect(pgn).toContain('[White "Alice"]');
    expect(pgn).toContain('[Black "Bob"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('1. e4 e5');
    expect(pgn).toContain('2. Nf3');
    expect(pgn).toContain('1-0');
  });

  it('uses defaults for missing fields', () => {
    const record = { moves: [] };
    const pgn = exportPGN(record);
    expect(pgn).toContain('[White "Player 1"]');
    expect(pgn).toContain('[Result "*"]');
  });
});
