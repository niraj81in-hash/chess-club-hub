
// ============================================================
// Chess Club Hub — Tournament Bracket Engine
// Supports 4 or 8 player single-elimination
// ============================================================

import { genId } from '../storage/db.js';

// ── Create tournament ─────────────────────────────────────────

export function createTournament(name, players) {
  if (![4, 8].includes(players.length))
    throw new Error('Tournament requires 4 or 8 players');

  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const rounds = buildRounds(shuffled);

  return {
    id: genId(),
    name,
    players: shuffled,
    rounds,
    currentRound: 0,
    status: 'active',   // 'active' | 'complete'
    winner: null,
    createdAt: new Date().toISOString(),
  };
}

// ── Build bracket rounds ──────────────────────────────────────

function buildRounds(players) {
  const numRounds = Math.log2(players.length);
  const rounds = [];

  // Round 1 — pair up players
  const r1Matches = [];
  for (let i = 0; i < players.length; i += 2) {
    r1Matches.push({
      id: genId(),
      white: players[i],
      black: players[i+1],
      result: null,   // null | 'white' | 'black' | 'draw'
      roomCode: null,
      gameId: null,
    });
  }
  rounds.push({ round: 1, matches: r1Matches });

  // Future rounds — TBD until players advance
  for (let r = 2; r <= numRounds; r++) {
    const matchCount = players.length / Math.pow(2, r);
    const matches = Array.from({ length: matchCount }, () => ({
      id: genId(),
      white: null,
      black: null,
      result: null,
      roomCode: null,
      gameId: null,
    }));
    rounds.push({ round: r, matches });
  }

  return rounds;
}

// ── Record a match result and advance winner ──────────────────

export function recordResult(tournament, roundIdx, matchIdx, result) {
  const t = JSON.parse(JSON.stringify(tournament)); // deep clone
  const match = t.rounds[roundIdx].matches[matchIdx];
  match.result = result;

  const winner = result === 'white' ? match.white
               : result === 'black' ? match.black
               : coinFlip(match.white, match.black); // draw → coin flip advance

  // Advance to next round
  const nextRound = t.rounds[roundIdx + 1];
  if (nextRound) {
    const nextMatchIdx = Math.floor(matchIdx / 2);
    const nextMatch = nextRound.matches[nextMatchIdx];
    if (matchIdx % 2 === 0) nextMatch.white = winner;
    else nextMatch.black = winner;
  }

  // Check if tournament is over
  const isLastRound = roundIdx === t.rounds.length - 1;
  if (isLastRound) {
    t.status = 'complete';
    t.winner = winner;
  }

  // Check if current round is done → advance round counter
  const roundDone = t.rounds[roundIdx].matches.every(m => m.result !== null);
  if (roundDone && !isLastRound) t.currentRound = roundIdx + 1;

  return t;
}

function coinFlip(a, b) { return Math.random() < 0.5 ? a : b; }

// ── Get current matches to play ───────────────────────────────

export function getCurrentMatches(tournament) {
  return tournament.rounds[tournament.currentRound]?.matches || [];
}

// ── Bracket summary for display ───────────────────────────────

export function getBracketSummary(tournament) {
  return tournament.rounds.map(r => ({
    round: r.round,
    label: getRoundLabel(r.round, tournament.rounds.length),
    matches: r.matches.map(m => ({
      ...m,
      status: !m.white || !m.black ? 'pending'
            : m.result ? 'done'
            : 'ready'
    }))
  }));
}

function getRoundLabel(round, total) {
  if (round === total) return 'Final';
  if (round === total - 1) return 'Semi-Finals';
  if (round === total - 2) return 'Quarter-Finals';
  return `Round ${round}`;
}
