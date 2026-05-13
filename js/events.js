// js/events.js
// Client module for event management: Cloud Function wrappers, Firestore reads,
// and pure helper functions.
//
// relay.js is imported lazily (inside async functions) so that the pure
// functions at the bottom of this file can be unit-tested in Vitest without
// triggering Firebase CDN imports, which are not available in Node.js.

let firestore = null;

const VALID_FORMATS = ['swiss', 'round_robin', 'single_elim', 'arena'];

async function getRelay() {
  return import('../multiplayer/relay.js');
}

async function initFirestore() {
  if (firestore) return;
  const { initFirebase } = await getRelay();
  await initFirebase();
  const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getFirestore } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  firestore = getFirestore(getApp());
}

async function callFn(name, data) {
  const { initFirebase } = await getRelay();
  await initFirebase();
  return (window._fbHttpsCallable(window._fbFunctions, name))(data).then(r => r.data);
}

// ── Cloud Function wrappers ───────────────────────────────────

export async function createEvent(data) {
  return callFn('createEvent', data);
}

export async function updateEvent(data) {
  return callFn('updateEvent', data);
}

export async function publishEvent(eventId) {
  return callFn('publishEvent', { eventId });
}

// ── Firestore read functions ──────────────────────────────────

export async function getEvents(status = 'open') {
  await initFirestore();
  const { collection, query, where, getDocs, orderBy } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const q = query(
    collection(firestore, 'events'),
    where('status', '==', status),
    orderBy('startDate', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => normalizeEvent(d));
}

export async function getMyEvents() {
  await initFirestore();
  const { getAuthUser } = await getRelay();
  const user = getAuthUser();
  if (!user) return [];
  const { collection, query, where, getDocs, orderBy } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const q = query(
    collection(firestore, 'events'),
    where('organizerUid', '==', user.uid),
    orderBy('startDate', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => normalizeEvent(d));
}

export async function getEvent(eventId) {
  await initFirestore();
  const { doc, getDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const snap = await getDoc(doc(firestore, 'events', eventId));
  if (!snap.exists()) return null;
  return normalizeEvent(snap);
}

function normalizeEvent(docSnapshot) {
  const d = docSnapshot.data();
  return {
    id: docSnapshot.id,
    ...d,
    startDate: d.startDate?.toDate?.()?.toISOString() ?? d.startDate,
    endDate: d.endDate?.toDate?.()?.toISOString() ?? d.endDate,
  };
}

// ── Pure functions (unit-testable) ────────────────────────────

/**
 * Format an ISO date or datetime string as a human-readable date.
 * Parses only the YYYY-MM-DD portion to avoid timezone shifts.
 */
export function formatEventDate(isoString) {
  const datePart = String(isoString).slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/**
 * Validate event form data. Returns null on success, or an error string.
 */
export function validateEventForm(data) {
  const title = (data.title || '').trim();
  if (title.length < 2 || title.length > 80) return 'Title must be 2–80 characters';
  if (!data.startDate) return 'Start date is required';
  if (!data.endDate) return 'End date is required';
  if (data.endDate < data.startDate) return 'End date must be on or after start date';
  if (!(data.city || '').trim()) return 'City is required';
  if (!(data.state || '').trim()) return 'State is required';
  if (!VALID_FORMATS.includes(data.format)) return 'Invalid format';
  const mp = parseInt(data.maxPlayers, 10);
  if (isNaN(mp) || mp < 4 || mp > 256) return 'Max players must be between 4 and 256';
  return null;
}
