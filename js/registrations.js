// js/registrations.js
// Client module for registration management: Cloud Function wrappers, Firestore reads,
// and pure helper functions.
//
// relay.js is imported lazily (inside async functions) so that the pure
// functions at the bottom of this file can be unit-tested in Vitest without
// triggering Firebase CDN imports, which are not available in Node.js.

let firestore = null;
let firestoreInitPromise = null;

const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getRelay() {
  return import('../multiplayer/relay.js');
}

async function initFirestore() {
  if (firestore) return;
  if (!firestoreInitPromise) {
    firestoreInitPromise = (async () => {
      const { initFirebase } = await getRelay();
      await initFirebase();
      const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      firestore = getFirestore(getApp());
    })();
  }
  await firestoreInitPromise;
}

async function callFn(name, data) {
  const { initFirebase } = await getRelay();
  await initFirebase();
  return (window._fbHttpsCallable(window._fbFunctions, name))(data).then(r => r.data);
}

// Cloud Function wrappers

export async function registerForEvent(data) {
  return callFn('registerForEvent', data);
}

export async function checkInPlayer(registrationId) {
  return callFn('checkInPlayer', { registrationId });
}

export async function withdrawRegistration(registrationId) {
  return callFn('withdrawRegistration', { registrationId });
}

// Firestore read functions

export async function getRegistrations(eventId) {
  const { getAuthUser } = await getRelay();
  const user = getAuthUser();
  if (!user) return [];
  await initFirestore();
  const { collection, query, where, getDocs, orderBy } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const q = query(
    collection(firestore, 'registrations'),
    where('eventId', '==', eventId),
    where('organizerUid', '==', user.uid),
    orderBy('registeredAt', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => normalizeRegistration(d));
}

export async function getMyRegistration(eventId) {
  const { getAuthUser } = await getRelay();
  const user = getAuthUser();
  if (!user) return null;
  await initFirestore();
  const { doc, getDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const snap = await getDoc(doc(firestore, 'registrations', `${eventId}_${user.uid}`));
  if (!snap.exists()) return null;
  return normalizeRegistration(snap);
}

export async function getRegistrationCount(eventId) {
  const { getAuthUser } = await getRelay();
  const user = getAuthUser();
  if (!user) return 0;
  await initFirestore();
  const { collection, query, where, getCountFromServer } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const q = query(
    collection(firestore, 'registrations'),
    where('eventId', '==', eventId),
    where('organizerUid', '==', user.uid),
    where('status', 'in', ['confirmed', 'checked_in'])
  );
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

function normalizeRegistration(docSnapshot) {
  const d = docSnapshot.data();
  return {
    id: docSnapshot.id,
    ...d,
    registeredAt: d.registeredAt?.toDate?.()?.toISOString() ?? d.registeredAt,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? d.updatedAt,
    checkedInAt: d.checkedInAt?.toDate?.()?.toISOString() ?? d.checkedInAt,
  };
}

// Pure functions (unit-testable without Firebase)

export function validateRegistrationForm(data) {
  if (typeof data.playerName !== 'string') return 'Player name must be a string';
  const name = data.playerName.trim();
  if (name.length < 2 || name.length > 50) return 'Player name must be 2–50 characters';
  const email = String(data.playerEmail || '');
  if (!VALID_EMAIL_RE.test(email)) return 'Valid player email is required';
  return null;
}

function csvCell(value) {
  const str = value == null ? '' : String(value);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"` : str;
}

function fmtDatetime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function generateCSV(registrations) {
  const header = '#,Name,Email,Status,Registered,Checked In,Waitlist Position';
  const rows = registrations.map((r, i) => [
    i + 1,
    csvCell(r.playerName),
    csvCell(r.playerEmail),
    csvCell(r.status),
    fmtDatetime(r.registeredAt),
    fmtDatetime(r.checkedInAt),
    r.waitlistPosition == null ? '' : r.waitlistPosition,
  ].join(','));
  return [header, ...rows].join('\n');
}
