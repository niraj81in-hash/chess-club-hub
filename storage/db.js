// ============================================================
// Chess Club Hub — IndexedDB storage (+ localStorage migration)
// ============================================================

const DB_NAME = 'chess_club_hub';
const DB_VERSION = 1;
const STORE = 'kv';

const KEYS = {
  GAMES: 'cch_games',
  PLAYERS: 'cch_players',
  TOURNAMENTS: 'cch_tournaments',
  PROFILE: 'cch_profile',
  RATINGS: 'cch_ratings',
};

let dbPromise = null;
let initDone = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function migrateFromLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  const migrated = localStorage.getItem('cch_migrated_to_idb');
  if (migrated === '1') return;

  for (const k of Object.values(KEYS)) {
    const raw = localStorage.getItem(k);
    if (raw == null) continue;
    try {
      const val = JSON.parse(raw);
      const existing = await idbGet(k);
      if (existing == null) await idbSet(k, val);
    } catch { /* skip corrupt */ }
  }
  localStorage.setItem('cch_migrated_to_idb', '1');
}

/** Call once at app boot before other db methods */
export async function initStorage() {
  if (initDone) return;
  await openDb();
  await migrateFromLocalStorage();
  initDone = true;
}

// ── Profile ───────────────────────────────────────────────────

export async function getProfile() {
  return (await idbGet(KEYS.PROFILE)) || { name: '', wins: 0, losses: 0, draws: 0, clubId: '' };
}

export async function saveProfile(profile) {
  await idbSet(KEYS.PROFILE, profile);
}

// ── Games ─────────────────────────────────────────────────────

export async function getGames() {
  return (await idbGet(KEYS.GAMES)) || [];
}

export async function saveGame(game) {
  const games = [...(await getGames())];
  const idx = games.findIndex(g => g.id === game.id);
  if (idx >= 0) games[idx] = game;
  else games.unshift(game);
  await idbSet(KEYS.GAMES, games);
}

export async function getGame(id) {
  const games = await getGames();
  return games.find(g => g.id === id) || null;
}

export async function deleteGame(id) {
  const games = (await getGames()).filter(g => g.id !== id);
  await idbSet(KEYS.GAMES, games);
}

// ── Players (Club Leaderboard) ────────────────────────────────

export async function getPlayers() {
  return (await idbGet(KEYS.PLAYERS)) || [];
}

export async function upsertPlayer(name, result) {
  const players = [...(await getPlayers())];
  let p = players.find(pl => pl.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    p = { name, wins: 0, losses: 0, draws: 0 };
    players.push(p);
  }
  if (result === 'win') p.wins++;
  if (result === 'loss') p.losses++;
  if (result === 'draw') p.draws++;
  await idbSet(KEYS.PLAYERS, players);
}

export async function getLeaderboard() {
  return (await getPlayers())
    .map(p => ({ ...p, score: p.wins * 1 + p.draws * 0.5 }))
    .sort((a, b) => b.score - a.score);
}

// ── Tournaments ───────────────────────────────────────────────

export async function getTournaments() {
  return (await idbGet(KEYS.TOURNAMENTS)) || [];
}

export async function saveTournament(t) {
  const list = [...(await getTournaments())];
  const idx = list.findIndex(x => x.id === t.id);
  if (idx >= 0) list[idx] = t;
  else list.unshift(t);
  await idbSet(KEYS.TOURNAMENTS, list);
}

export async function getTournament(id) {
  const list = await getTournaments();
  return list.find(t => t.id === id) || null;
}

// ── ELO blob (name-keyed, local / same-device games) ──────────

export async function getAllRatings() {
  return (await idbGet(KEYS.RATINGS)) || {};
}

export async function setAllRatings(all) {
  await idbSet(KEYS.RATINGS, all);
}

// ── ID generator (sync; no storage) ───────────────────────────

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export { KEYS };
