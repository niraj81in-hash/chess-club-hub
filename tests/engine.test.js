import { describe, it, expect } from 'vitest';
import {
  initBoard, initGameState, color, type, opp,
  isInCheck, legalMoves, allLegalMoves, makeMove, toSAN, applyMove
} from '../engine.js';

describe('initBoard', () => {
  it('sets up standard starting position', () => {
    const b = initBoard();
    expect(b[0][0]).toBe('bR');
    expect(b[0][4]).toBe('bK');
    expect(b[1][3]).toBe('bP');
    expect(b[7][4]).toBe('wK');
    expect(b[7][0]).toBe('wR');
    expect(b[6][0]).toBe('wP');
    expect(b[4][4]).toBeNull();
  });
});

describe('helpers', () => {
  it('color returns correct piece color', () => {
    expect(color('wK')).toBe('w');
    expect(color('bP')).toBe('b');
    expect(color(null)).toBeNull();
  });

  it('type returns correct piece type', () => {
    expect(type('wK')).toBe('K');
    expect(type('bP')).toBe('P');
    expect(type(null)).toBeNull();
  });

  it('opp returns opposite color', () => {
    expect(opp('w')).toBe('b');
    expect(opp('b')).toBe('w');
  });
});

describe('initGameState', () => {
  it('creates a valid initial state', () => {
    const s = initGameState();
    expect(s.turn).toBe('w');
    expect(s.status).toBe('playing');
    expect(s.winner).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.castling).toEqual({ wK: true, wQ: true, bK: true, bQ: true });
  });
});

describe('legalMoves', () => {
  it('pawns have 2 moves from starting position', () => {
    const s = initGameState();
    const moves = legalMoves(s, 6, 4);
    expect(moves.length).toBe(2);
    expect(moves).toContainEqual([5, 4]);
    expect(moves).toContainEqual([4, 4]);
  });

  it('knights have 2 moves from starting position', () => {
    const s = initGameState();
    const moves = legalMoves(s, 7, 1);
    expect(moves.length).toBe(2);
  });

  it('king has no moves in starting position', () => {
    const s = initGameState();
    const moves = legalMoves(s, 7, 4);
    expect(moves.length).toBe(0);
  });
});

describe('allLegalMoves', () => {
  it('white has 20 moves at game start', () => {
    const s = initGameState();
    const moves = allLegalMoves(s);
    expect(moves.length).toBe(20);
  });
});

describe('makeMove', () => {
  it('e2-e4 changes turn to black', () => {
    const s = initGameState();
    const ns = makeMove(s, [6, 4], [4, 4]);
    expect(ns.turn).toBe('b');
    expect(ns.board[4][4]).toBe('wP');
    expect(ns.board[6][4]).toBeNull();
    expect(ns.status).toBe('playing');
  });

  it('records move in history', () => {
    const s = initGameState();
    const ns = makeMove(s, [6, 4], [4, 4]);
    expect(ns.history.length).toBe(1);
    expect(ns.history[0].piece).toBe('wP');
  });
});

describe('isInCheck', () => {
  it('initial position is not in check', () => {
    const s = initGameState();
    expect(isInCheck(s.board, 'w')).toBe(false);
    expect(isInCheck(s.board, 'b')).toBe(false);
  });
});

describe('toSAN', () => {
  it('generates correct pawn SAN', () => {
    const s = initGameState();
    expect(toSAN(s.board, [6, 4], [4, 4])).toBe('e4');
  });

  it('generates correct knight SAN', () => {
    const s = initGameState();
    expect(toSAN(s.board, [7, 1], [5, 2])).toBe('Nc3');
  });
});
