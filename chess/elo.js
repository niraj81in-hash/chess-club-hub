
// ============================================================
// Chess Club Hub — ELO Rating System
// Standard FIDE-style ELO with K-factor scaling
// ============================================================

import { getAllRatings, setAllRatings } from '../storage/db.js';

export const DEFAULT_RATING  = 800;   // Starting ELO for new players
export const PROVISIONAL_GAMES = 20;  // Games until rating stabilizes

// ── K-Factor (how much a single game can shift your rating) ──

export function kFactor(rating, gamesPlayed) {
  if (gamesPlayed < PROVISIONAL_GAMES) return 40;  // New player
  if (rating >= 2400)                  return 10;  // Elite
  if (rating >= 1800)                  return 20;  // Advanced
  return 32;                                        // Standard
}

// ── Expected score (probability of winning) ───────────────────

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// ── Calculate new ratings after a game ───────────────────────
// result: 1 = A wins, 0 = B wins, 0.5 = draw

export function calcNewRatings(playerA, playerB, result) {
  const ea = expectedScore(playerA.rating, playerB.rating);
  const eb = 1 - ea;

  const sa = result;          // A's score
  const sb = 1 - result;     // B's score

  const ka = kFactor(playerA.rating, playerA.gamesPlayed);
  const kb = kFactor(playerB.rating, playerB.gamesPlayed);

  const newA = Math.round(playerA.rating + ka * (sa - ea));
  const newB = Math.round(playerB.rating + kb * (sb - eb));

  const changeA = newA - playerA.rating;
  const changeB = newB - playerB.rating;

  return {
    a: { ...playerA, rating: newA, gamesPlayed: playerA.gamesPlayed + 1,
         wins:   playerA.wins   + (result === 1   ? 1 : 0),
         losses: playerA.losses + (result === 0   ? 1 : 0),
         draws:  playerA.draws  + (result === 0.5 ? 1 : 0) },
    b: { ...playerB, rating: newB, gamesPlayed: playerB.gamesPlayed + 1,
         wins:   playerB.wins   + (result === 0   ? 1 : 0),
         losses: playerB.losses + (result === 1   ? 1 : 0),
         draws:  playerB.draws  + (result === 0.5 ? 1 : 0) },
    changeA,
    changeB,
  };
}

// ── Rating title thresholds ───────────────────────────────────

export function getRatingTitle(rating) {
  if (rating >= 2500) return { title: 'Grandmaster',        color: '#f0b429', icon: '👑' };
  if (rating >= 2200) return { title: 'National Master',    color: '#c0c0c0', icon: '⭐' };
  if (rating >= 2000) return { title: 'Expert',             color: '#7c3aed', icon: '💜' };
  if (rating >= 1800) return { title: 'Class A',            color: '#2563eb', icon: '💙' };
  if (rating >= 1600) return { title: 'Class B',            color: '#059669', icon: '💚' };
  if (rating >= 1400) return { title: 'Class C',            color: '#d97706', icon: '🟡' };
  if (rating >= 1200) return { title: 'Class D',            color: '#dc2626', icon: '🔴' };
  if (rating >= 1000) return { title: 'Class E',            color: '#6b7280', icon: '⚪' };
  return                       { title: 'Beginner',          color: '#92400e', icon: '🟤' };
}

// ── Create a new player profile ───────────────────────────────

export function newPlayerProfile(name) {
  return {
    name,
    rating:      DEFAULT_RATING,
    gamesPlayed: 0,
    wins:        0,
    losses:      0,
    draws:       0,
    history:     [],  // [{ date, opponent, opponentRating, result, change, newRating }]
    createdAt:   new Date().toISOString(),
  };
}

// ── Record a game in player history ──────────────────────────

export function recordGameHistory(player, opponent, result, change) {
  const entry = {
    date:            new Date().toISOString(),
    opponent:        opponent.name,
    opponentRating:  opponent.rating,
    result,          // 'win' | 'loss' | 'draw'
    change,          // +N or -N
    newRating:       player.rating,
  };
  return { ...player, history: [entry, ...(player.history || [])].slice(0, 50) };
}

// ── Storage (IndexedDB via db.js) ─────────────────────────────

export async function getPlayerRating(name) {
  const all = await getAllRatings();
  return all[name.toLowerCase()] || newPlayerProfile(name);
}

export async function savePlayerRating(player) {
  const all = { ...(await getAllRatings()) };
  all[player.name.toLowerCase()] = player;
  await setAllRatings(all);
}

export async function updateRatingsAfterGame(whiteName, blackName, result) {
  // result: 'w' | 'b' | 'draw'
  const white  = await getPlayerRating(whiteName);
  const black  = await getPlayerRating(blackName);
  const score  = result === 'w' ? 1 : result === 'b' ? 0 : 0.5;

  const { a: newWhite, b: newBlack, changeA, changeB } = calcNewRatings(white, black, score);

  const wResult = result === 'w' ? 'win' : result === 'b' ? 'loss' : 'draw';
  const bResult = result === 'b' ? 'win' : result === 'w' ? 'loss' : 'draw';

  await savePlayerRating(recordGameHistory(newWhite, black,  wResult, changeA));
  await savePlayerRating(recordGameHistory(newBlack, white, bResult, changeB));

  return { changeA, changeB, newWhiteRating: newWhite.rating, newBlackRating: newBlack.rating };
}

export async function getEloLeaderboard() {
  const all = await getAllRatings();
  return Object.values(all)
    .sort((a, b) => b.rating - a.rating);
}
