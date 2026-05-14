import { describe, it, expect } from 'vitest';
import { initGameState, makeMove, undoMove, color } from '../chess/engine.js';

describe('undoMove', () => {
  it('returns the same state when history is empty', () => {
    const s = initGameState();
    expect(undoMove(s)).toBe(s);
  });

  it('restores board position and turn after one move', () => {
    let s = initGameState();
    s = makeMove(s, [6, 4], [4, 4]); // e4
    expect(s.turn).toBe('b');
    expect(s.history.length).toBe(1);

    s = undoMove(s);
    expect(s.turn).toBe('w');
    expect(s.history.length).toBe(0);
    expect(s.board[6][4]).toBe('wP');
    expect(s.board[4][4]).toBeNull();
  });

  it('restores en passant square', () => {
    let s = initGameState();
    s = makeMove(s, [6, 4], [4, 4]); // e4 — sets enPassant [5,4]
    s = makeMove(s, [1, 3], [3, 3]); // d5
    const enPassantBefore = s.enPassant; // [2,3]
    s = makeMove(s, [4, 4], [3, 3]); // exd5 capture
    s = undoMove(s);
    expect(s.enPassant).toEqual(enPassantBefore);
  });

  it('restores castling rights after king move undo', () => {
    let s = initGameState();
    // Clear pieces between king and rook
    s = { ...s, board: s.board.map(r => [...r]) };
    s.board[7][5] = null; s.board[7][6] = null;
    const castlingBefore = { ...s.castling };
    s = makeMove(s, [7, 4], [7, 6]); // O-O
    expect(s.castling.wK).toBe(false);
    s = undoMove(s);
    expect(s.castling.wK).toBe(castlingBefore.wK);
  });

  it('undoes two moves in sequence', () => {
    let s = initGameState();
    s = makeMove(s, [6, 4], [4, 4]); // e4
    s = makeMove(s, [1, 4], [3, 4]); // e5
    s = undoMove(s);
    s = undoMove(s);
    expect(s.history.length).toBe(0);
    expect(s.turn).toBe('w');
  });
});
