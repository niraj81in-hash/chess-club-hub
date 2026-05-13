// ============================================================
// Chess Club Hub — Multiplayer Relay
// Firebase Auth (anonymous) + RTDB under clubs/{clubId}/rooms/
// ============================================================

import { firebaseConfig, functionsRegion } from '../config.js';

let app = null;
let db = null;
let auth = null;
let functions = null;
let activeClubId = null;

let onMoveCallback = null;
let onOpponentJoinCallback = null;
let onSpectatorUpdateCallback = null;

const unsubscribers = [];

function roomBase(clubId, roomCode) {
  if (!clubId || !roomCode) throw new Error('Club and room code required');
  return `clubs/${clubId}/rooms/${roomCode}`;
}

function clearRoomListeners() {
  while (unsubscribers.length) {
    const u = unsubscribers.pop();
    try { u(); } catch { /* noop */ }
  }
}

// ── Init Firebase ─────────────────────────────────────────────

export async function initFirebase() {
  if (db) return;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getDatabase, ref, set, onValue, push, get, update, onChildAdded } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js');

  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
  functions = getFunctions(app, functionsRegion);

  window._fbRef = ref;
  window._fbSet = set;
  window._fbOnValue = onValue;
  window._fbPush = push;
  window._fbGet = get;
  window._fbUpdate = update;
  window._fbOnChildAdded = onChildAdded;
  window._fbHttpsCallable = httpsCallable;
  window._fbFunctions = functions;
}

export async function ensureAnonymousAuth() {
  await initFirebase();
  const { signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

export function getCurrentUid() {
  return auth?.currentUser?.uid || null;
}

export function setActiveClub(clubId) {
  activeClubId = clubId || null;
}

export function getActiveClub() {
  return activeClubId;
}

// ── Cloud callables ───────────────────────────────────────────

export async function cloudCreateClub({ clubName, joinPhrase, displayName }) {
  await ensureAnonymousAuth();
  const fn = window._fbHttpsCallable(window._fbFunctions, 'createClub');
  const { data } = await fn({ clubName, joinPhrase, displayName });
  return data;
}

export async function cloudJoinClub({ clubId, joinPhrase, displayName }) {
  await ensureAnonymousAuth();
  const fn = window._fbHttpsCallable(window._fbFunctions, 'joinClub');
  const { data } = await fn({ clubId: clubId.trim().toUpperCase(), joinPhrase, displayName });
  return data;
}

export async function cloudRecordOnlineGameResult(payload) {
  await ensureAnonymousAuth();
  const fn = window._fbHttpsCallable(window._fbFunctions, 'recordOnlineGameResult');
  const { data } = await fn(payload);
  return data;
}

// ── Room management ───────────────────────────────────────────

export async function createRoom(roomCode, hostName) {
  await ensureAnonymousAuth();
  const clubId = activeClubId;
  if (!clubId) throw new Error('Join or create a club before hosting online games');

  const { ref, set } = { ref: window._fbRef, set: window._fbSet };
  const base = roomBase(clubId, roomCode);
  const uid = auth.currentUser.uid;
  await set(ref(db, base), {
    host: hostName,
    hostUid: uid,
    guest: null,
    guestUid: null,
    moves: {},
    status: 'waiting',
    createdAt: Date.now(),
  });
  listenRoom(clubId, roomCode);
  return roomCode;
}

export async function joinRoom(roomCode, guestName) {
  await ensureAnonymousAuth();
  const clubId = activeClubId;
  if (!clubId) throw new Error('Join or create a club before joining a room');

  const { ref, get, update } = { ref: window._fbRef, get: window._fbGet, update: window._fbUpdate };
  const base = roomBase(clubId, roomCode);
  const roomRef = ref(db, base);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error('Room not found');
  const data = snap.val();
  const uid = auth.currentUser.uid;
  if (data.guestUid && data.guestUid !== uid) throw new Error('Room is full');

  await update(roomRef, {
    guest: guestName,
    guestUid: uid,
    status: 'active',
  });
  listenRoom(clubId, roomCode);
  return data;
}

export async function spectateRoom(roomCode) {
  await ensureAnonymousAuth();
  const clubId = activeClubId;
  if (!clubId) throw new Error('Club required');
  listenRoom(clubId, roomCode);
}

// ── Send move / chat ──────────────────────────────────────────

export async function sendMove(roomCode, moveData) {
  const clubId = activeClubId;
  if (!clubId) return;
  const { ref, push } = { ref: window._fbRef, push: window._fbPush };
  const movesRef = ref(db, `${roomBase(clubId, roomCode)}/moves`);
  await push(movesRef, { ...moveData, ts: Date.now() });
}

export async function sendChat(roomCode, sender, text) {
  const clubId = activeClubId;
  if (!clubId) return;
  const { ref, push } = { ref: window._fbRef, push: window._fbPush };
  const chatRef = ref(db, `${roomBase(clubId, roomCode)}/chat`);
  await push(chatRef, { sender, text, ts: Date.now() });
}

// ── Listen (incremental moves + targeted guest join) ────────

function listenRoom(clubId, roomCode) {
  clearRoomListeners();
  const { ref, onValue, get, onChildAdded } = {
    ref: window._fbRef,
    onValue: window._fbOnValue,
    get: window._fbGet,
    onChildAdded: window._fbOnChildAdded,
  };
  const base = roomBase(clubId, roomCode);
  const movesRef = ref(db, `${base}/moves`);

  const seenMoveKeys = new Set();
  get(movesRef)
    .then(snap => {
      const v = snap.val();
      if (v && typeof v === 'object') Object.keys(v).forEach(k => seenMoveKeys.add(k));
    })
    .then(() => {
      const unsubMoves = onChildAdded(movesRef, childSnap => {
        const key = childSnap.key;
        if (seenMoveKeys.has(key)) return;
        seenMoveKeys.add(key);
        const latest = childSnap.val();
        if (onMoveCallback) onMoveCallback(latest, []);
      });
      unsubscribers.push(unsubMoves);
    })
    .catch(() => {});

  const guestRef = ref(db, `${base}/guest`);
  const guestUidRef = ref(db, `${base}/guestUid`);
  const unsubG = onValue(guestRef, async snap => {
    const guestName = snap.val();
    if (!guestName || !onOpponentJoinCallback) return;
    const uidSnap = await get(guestUidRef);
    onOpponentJoinCallback(guestName, uidSnap.val() || null);
  });
  unsubscribers.push(unsubG);

  const spectRef = ref(db, `${base}/spectators`);
  const unsubS = onValue(spectRef, s => {
    if (onSpectatorUpdateCallback) onSpectatorUpdateCallback(s.val() || 0);
  });
  unsubscribers.push(unsubS);
}

export function leaveRoomChannel() {
  clearRoomListeners();
}

// ── Register event handlers ───────────────────────────────────

export function onMove(cb) { onMoveCallback = cb; }
export function onOpponentJoin(cb) { onOpponentJoinCallback = cb; }
export function onSpectatorUpdate(cb) { onSpectatorUpdateCallback = cb; }

// ── Generate room code ────────────────────────────────────────

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── End room ──────────────────────────────────────────────────

export async function endRoom(roomCode, result) {
  const clubId = activeClubId;
  if (!clubId) return;
  const { ref, set } = { ref: window._fbRef, set: window._fbSet };
  const base = roomBase(clubId, roomCode);
  await set(ref(db, `${base}/status`), 'finished');
  await set(ref(db, `${base}/result`), result);
}

/** Load club ELO table for leaderboard UI (one-shot) */
export async function fetchClubRatings(clubId) {
  await ensureAnonymousAuth();
  const { ref, get } = { ref: window._fbRef, get: window._fbGet };
  const snap = await get(ref(db, `clubs/${clubId}/ratings`));
  if (!snap.exists()) return [];
  const o = snap.val();
  return Object.entries(o).map(([uid, v]) => ({ uid, ...v }))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

/** Current user's club rating row (if any) */
export async function fetchMyClubRating(clubId) {
  const uid = getCurrentUid();
  if (!uid || !clubId) return null;
  await ensureAnonymousAuth();
  const { ref, get } = { ref: window._fbRef, get: window._fbGet };
  const snap = await get(ref(db, `clubs/${clubId}/ratings/${uid}`));
  return snap.exists() ? snap.val() : null;
}
