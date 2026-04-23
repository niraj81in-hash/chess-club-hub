// ============================================================
// Chess Club Hub — Local Storage DB
// ============================================================

const KEYS = {
  GAMES:      'cch_games',
  PLAYERS:    'cch_players',
  TOURNAMENTS:'cch_tournaments',
  PROFILE:    'cch_profile',
};

// ── Generic helpers ───────────────────────────────────────────

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || null; }
  catch { return null; }
}

function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ── Profile ───────────────────────────────────────────────────

export function getProfile() {
  return load(KEYS.PROFILE) || { name: '', wins: 0, losses: 0, draws: 0 };
}

export function saveProfile(profile) {
  save(KEYS.PROFILE, profile);
}

// ── Games ─────────────────────────────────────────────────────

export function getGames() {
  return load(KEYS.GAMES) || [];
}

export function saveGame(game) {
  const games = getGames();
  const idx = games.findIndex(g => g.id === game.id);
  if (idx >= 0) games[idx] = game;
  else games.unshift(game);           // newest first
  save(KEYS.GAMES, games);
}

export function getGame(id) {
  return getGames().find(g => g.id === id) || null;
}

export function deleteGame(id) {
  const games = getGames().filter(g => g.id !== id);
  save(KEYS.GAMES, games);
}

// ── Players (Club Leaderboard) ────────────────────────────────

export function getPlayers() {
  return load(KEYS.PLAYERS) || [];
}

export function upsertPlayer(name, result) {
  const players = getPlayers();
  let p = players.find(pl => pl.name.toLowerCase() === name.toLowerCase());
  if (!p) { p = { name, wins: 0, losses: 0, draws: 0 }; players.push(p); }
  if (result === 'win')  p.wins++;
  if (result === 'loss') p.losses++;
  if (result === 'draw') p.draws++;
  save(KEYS.PLAYERS, players);
}

export function getLeaderboard() {
  return getPlayers()
    .map(p => ({ ...p, score: p.wins * 1 + p.draws * 0.5 }))
    .sort((a, b) => b.score - a.score);
}

// ── Tournaments ───────────────────────────────────────────────

export function getTournaments() {
  return load(KEYS.TOURNAMENTS) || [];
}

export function saveTournament(t) {
  const list = getTournaments();
  const idx = list.findIndex(x => x.id === t.id);
  if (idx >= 0) list[idx] = t;
  else list.unshift(t);
  save(KEYS.TOURNAMENTS, list);
}

export function getTournament(id) {
  return getTournaments().find(t => t.id === id) || null;
}

// ── ID generator ──────────────────────────────────────────────

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
