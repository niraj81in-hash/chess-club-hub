import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProfile, saveProfile,
  getGames, saveGame, getGame, deleteGame,
  getPlayers, upsertPlayer, getLeaderboard,
  getTournaments, saveTournament, getTournament,
  genId
} from '../db.js';

beforeEach(() => {
  localStorage.clear();
});

describe('profile', () => {
  it('returns default profile when empty', () => {
    const p = getProfile();
    expect(p.name).toBe('');
    expect(p.wins).toBe(0);
  });

  it('saves and retrieves profile', () => {
    saveProfile({ name: 'Alice', wins: 3, losses: 1, draws: 0 });
    const p = getProfile();
    expect(p.name).toBe('Alice');
    expect(p.wins).toBe(3);
  });
});

describe('games', () => {
  it('starts with empty list', () => {
    expect(getGames()).toEqual([]);
  });

  it('saves and retrieves a game', () => {
    const game = { id: 'g1', white: 'A', black: 'B' };
    saveGame(game);
    expect(getGame('g1')).toEqual(game);
    expect(getGames().length).toBe(1);
  });

  it('deletes a game', () => {
    saveGame({ id: 'g1' });
    deleteGame('g1');
    expect(getGames().length).toBe(0);
  });
});

describe('players & leaderboard', () => {
  it('upserts players and ranks by score', () => {
    upsertPlayer('Alice', 'win');
    upsertPlayer('Alice', 'win');
    upsertPlayer('Bob', 'win');
    upsertPlayer('Bob', 'draw');
    const lb = getLeaderboard();
    expect(lb[0].name).toBe('Alice');
    expect(lb[0].score).toBe(2);
    expect(lb[1].name).toBe('Bob');
    expect(lb[1].score).toBe(1.5);
  });
});

describe('tournaments', () => {
  it('saves and retrieves a tournament', () => {
    const t = { id: 't1', name: 'Spring Cup' };
    saveTournament(t);
    expect(getTournament('t1')).toEqual(t);
    expect(getTournaments().length).toBe(1);
  });
});

describe('genId', () => {
  it('generates unique IDs', () => {
    const a = genId();
    const b = genId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
  });
});
