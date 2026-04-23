// ============================================================
// Chess Club Hub — Multiplayer Relay
// Uses Firebase Realtime Database for real-time sync.
// Replace FIREBASE_CONFIG with your own project config.
// ============================================================

// ── Firebase config (replace with your own) ──────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCt1AiLUDzFANqjII_PmLjOEYm_Hdb9JMI",
  authDomain: "chessclubhub-80aa1.firebaseapp.com",
  databaseURL: "https://chessclubhub-80aa1-default-rtdb.firebaseio.com",
  projectId: "chessclubhub-80aa1",
  storageBucket: "chessclubhub-80aa1.firebasestorage.app",
  messagingSenderId: "854037947016",
  appId: "1:854037947016:web:95f7079d414a2f1ec1f53d",
  measurementId: "G-KQEX3FZSW8"
};

let db = null;
let roomRef = null;
let onMoveCallback = null;
let onOpponentJoinCallback = null;
let onSpectatorUpdateCallback = null;

// ── Init Firebase ─────────────────────────────────────────────

export async function initFirebase() {
  if (db) return;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getDatabase, ref, set, onValue, push, get } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');

  const app = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(app);
  window._fbRef = ref;
  window._fbSet = set;
  window._fbOnValue = onValue;
  window._fbPush = push;
  window._fbGet = get;
}

// ── Room management ───────────────────────────────────────────

export async function createRoom(roomCode, hostName) {
  await initFirebase();
  const { ref, set } = { ref: window._fbRef, set: window._fbSet };
  roomRef = ref(db, `rooms/${roomCode}`);
  await set(roomRef, {
    host: hostName,
    guest: null,
    moves: [],
    status: 'waiting',
    createdAt: Date.now(),
  });
  listenRoom(roomCode);
  return roomCode;
}

export async function joinRoom(roomCode, guestName) {
  await initFirebase();
  const { ref, set, get } = { ref: window._fbRef, set: window._fbSet, get: window._fbGet };
  roomRef = ref(db, `rooms/${roomCode}`);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error('Room not found');
  const data = snap.val();
  if (data.guest && data.guest !== guestName) throw new Error('Room is full');
  await set(ref(db, `rooms/${roomCode}/guest`), guestName);
  await set(ref(db, `rooms/${roomCode}/status`), 'active');
  listenRoom(roomCode);
  return data;
}

export async function spectateRoom(roomCode) {
  await initFirebase();
  listenRoom(roomCode);
}

// ── Send a move ───────────────────────────────────────────────

export async function sendMove(roomCode, moveData) {
  const { ref, push } = { ref: window._fbRef, push: window._fbPush };
  const movesRef = ref(db, `rooms/${roomCode}/moves`);
  await push(movesRef, { ...moveData, ts: Date.now() });
}

// ── Send chat message ─────────────────────────────────────────

export async function sendChat(roomCode, sender, text) {
  const { ref, push } = { ref: window._fbRef, push: window._fbPush };
  const chatRef = ref(db, `rooms/${roomCode}/chat`);
  await push(chatRef, { sender, text, ts: Date.now() });
}

// ── Listen to room updates ────────────────────────────────────

let lastMoveCount = 0;

function listenRoom(roomCode) {
  const { ref, onValue } = { ref: window._fbRef, onValue: window._fbOnValue };

  // Listen for moves
  const movesRef = ref(db, `rooms/${roomCode}/moves`);
  onValue(movesRef, snap => {
    const data = snap.val();
    if (!data) return;
    const moves = Object.values(data).sort((a,b) => a.ts - b.ts);
    if (moves.length > lastMoveCount) {
      const latest = moves[moves.length - 1];
      lastMoveCount = moves.length;
      if (onMoveCallback) onMoveCallback(latest, moves);
    }
  });

  // Listen for guest joining
  const guestRef = ref(db, `rooms/${roomCode}/guest`);
  onValue(guestRef, snap => {
    if (snap.val() && onOpponentJoinCallback) onOpponentJoinCallback(snap.val());
  });

  // Listen for spectator count
  const spectRef = ref(db, `rooms/${roomCode}/spectators`);
  onValue(spectRef, snap => {
    if (onSpectatorUpdateCallback) onSpectatorUpdateCallback(snap.val() || 0);
  });
}

// ── Register event handlers ───────────────────────────────────

export function onMove(cb)           { onMoveCallback = cb; }
export function onOpponentJoin(cb)   { onOpponentJoinCallback = cb; }
export function onSpectatorUpdate(cb){ onSpectatorUpdateCallback = cb; }

// ── Generate room code ────────────────────────────────────────

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── End room ──────────────────────────────────────────────────

export async function endRoom(roomCode, result) {
  const { ref, set } = { ref: window._fbRef, set: window._fbSet };
  await set(ref(db, `rooms/${roomCode}/status`), 'finished');
  await set(ref(db, `rooms/${roomCode}/result`), result);
}
