/**
 * Chess Club Hub — Cloud Functions (club lifecycle + authoritative online ELO)
 * Deploy: firebase deploy --only functions,database
 */
const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

// Sentry error monitoring — Cloud Functions
// ⚠️ USER ACTION REQUIRED: replace the empty string with your Sentry Node.js DSN
const Sentry = require('@sentry/node');
(function () {
  const dsn = ''; // ⚠️ Replace with your Sentry Node.js DSN from sentry.io
  if (dsn && dsn.indexOf('sentry.io') !== -1) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
  }
})();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

admin.initializeApp();
const db = admin.database();

const DEFAULT_RATING = 800;
const PROVISIONAL_GAMES = 20;

function kFactor(rating, gamesPlayed) {
  if (gamesPlayed < PROVISIONAL_GAMES) return 40;
  if (rating >= 2400) return 10;
  if (rating >= 1800) return 20;
  return 32;
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calcNewRatings(playerA, playerB, result) {
  const ea = expectedScore(playerA.rating, playerB.rating);
  const eb = 1 - ea;
  const sa = result;
  const sb = 1 - result;
  const ka = kFactor(playerA.rating, playerA.gamesPlayed);
  const kb = kFactor(playerB.rating, playerB.gamesPlayed);
  const newA = Math.round(playerA.rating + ka * (sa - ea));
  const newB = Math.round(playerB.rating + kb * (sb - eb));
  return {
    newA,
    newB,
    changeA: newA - playerA.rating,
    changeB: newB - playerB.rating,
  };
}

function joinHash(clubId, joinPhrase) {
  return crypto.createHash('sha256').update(`${clubId}:${joinPhrase}`).digest('hex');
}

function genClubId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function newRatingProfile(uid, name) {
  return {
    uid,
    name: name || 'Player',
    rating: DEFAULT_RATING,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };
}

exports.createClub = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const { clubName, joinPhrase } = request.data || {};
    if (!clubName || typeof clubName !== 'string' || clubName.length < 2 || clubName.length > 60) {
      throw new HttpsError('invalid-argument', 'Invalid club name');
    }
    if (!joinPhrase || typeof joinPhrase !== 'string' || joinPhrase.length < 4 || joinPhrase.length > 64) {
      throw new HttpsError('invalid-argument', 'Join phrase must be 4–64 characters');
    }

    let clubId = genClubId();
    for (let i = 0; i < 5; i++) {
      const snap = await db.ref(`clubs/${clubId}/meta`).get();
      if (!snap.exists()) break;
      clubId = genClubId();
    }

    const uid = request.auth.uid;
    const hash = joinHash(clubId, joinPhrase);
    const updates = {};
    updates[`clubs/${clubId}/meta`] = {
      name: clubName.trim(),
      ownerUid: uid,
      joinHash: hash,
      createdAt: admin.database.ServerValue.TIMESTAMP,
    };
    updates[`clubs/${clubId}/members/${uid}`] = {
      role: 'owner',
      joinedAt: admin.database.ServerValue.TIMESTAMP,
    };
    const dn = (request.data?.displayName && String(request.data.displayName).slice(0, 24)) || 'Owner';
    updates[`clubs/${clubId}/ratings/${uid}`] = newRatingProfile(uid, dn);

    await db.ref().update(updates);
    return { clubId };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

exports.joinClub = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const { clubId, joinPhrase, displayName } = request.data || {};
    if (!clubId || typeof clubId !== 'string' || clubId.length < 4) {
      throw new HttpsError('invalid-argument', 'Invalid club id');
    }
    if (!joinPhrase || typeof joinPhrase !== 'string') {
      throw new HttpsError('invalid-argument', 'Join phrase required');
    }

    const metaSnap = await db.ref(`clubs/${clubId}/meta`).get();
    if (!metaSnap.exists()) throw new HttpsError('not-found', 'Club not found');
    const meta = metaSnap.val();
    if (meta.joinHash !== joinHash(clubId, joinPhrase)) {
      throw new HttpsError('permission-denied', 'Wrong join phrase');
    }

    const uid = request.auth.uid;
    const memberSnap = await db.ref(`clubs/${clubId}/members/${uid}`).get();
    if (memberSnap.exists()) return { clubId, alreadyMember: true };

    const updates = {};
    updates[`clubs/${clubId}/members/${uid}`] = {
      role: 'member',
      displayName: (displayName && String(displayName).slice(0, 24)) || 'Member',
      joinedAt: admin.database.ServerValue.TIMESTAMP,
    };
    updates[`clubs/${clubId}/ratings/${uid}`] = newRatingProfile(uid, displayName);
    await db.ref().update(updates);
    return { clubId };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

exports.recordOnlineGameResult = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const { clubId, result, whiteUid, blackUid, whiteName, blackName, roomCode } = request.data || {};
    if (!clubId || !['w', 'b', 'draw'].includes(result) || !whiteUid || !blackUid) {
      throw new HttpsError('invalid-argument', 'Bad payload');
    }
    const caller = request.auth.uid;
    if (caller !== whiteUid && caller !== blackUid) {
      throw new HttpsError('permission-denied', 'Not a player in this game');
    }

    const memberSnap = await db.ref(`clubs/${clubId}/members/${caller}`).get();
    if (!memberSnap.exists()) throw new HttpsError('permission-denied', 'Not a club member');

    const score = result === 'w' ? 1 : result === 'b' ? 0 : 0.5;

    const wRef = db.ref(`clubs/${clubId}/ratings/${whiteUid}`);
    const bRef = db.ref(`clubs/${clubId}/ratings/${blackUid}`);
    const [wSnap, bSnap] = await Promise.all([wRef.get(), bRef.get()]);

    const white = wSnap.exists()
      ? { ...wSnap.val(), uid: whiteUid, name: whiteName || wSnap.val().name }
      : { ...newRatingProfile(whiteUid, whiteName), uid: whiteUid };
    const black = bSnap.exists()
      ? { ...bSnap.val(), uid: blackUid, name: blackName || bSnap.val().name }
      : { ...newRatingProfile(blackUid, blackName), uid: blackUid };

    const { newA, newB, changeA, changeB } = calcNewRatings(
      {
        rating: white.rating,
        gamesPlayed: white.gamesPlayed || 0,
      },
      {
        rating: black.rating,
        gamesPlayed: black.gamesPlayed || 0,
      },
      score
    );

    const wWin = result === 'w' ? 1 : 0;
    const wLoss = result === 'b' ? 1 : 0;
    const wDraw = result === 'draw' ? 1 : 0;
    const bWin = result === 'b' ? 1 : 0;
    const bLoss = result === 'w' ? 1 : 0;
    const bDraw = result === 'draw' ? 1 : 0;

    const wNext = {
      uid: whiteUid,
      name: (whiteName && String(whiteName).slice(0, 24)) || white.name,
      rating: newA,
      gamesPlayed: (white.gamesPlayed || 0) + 1,
      wins: (white.wins || 0) + wWin,
      losses: (white.losses || 0) + wLoss,
      draws: (white.draws || 0) + wDraw,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
      lastRoom: roomCode || null,
    };
    const bNext = {
      uid: blackUid,
      name: (blackName && String(blackName).slice(0, 24)) || black.name,
      rating: newB,
      gamesPlayed: (black.gamesPlayed || 0) + 1,
      wins: (black.wins || 0) + bWin,
      losses: (black.losses || 0) + bLoss,
      draws: (black.draws || 0) + bDraw,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
      lastRoom: roomCode || null,
    };

    await Promise.all([wRef.set(wNext), bRef.set(bNext)]);

    return {
      newWhiteRating: newA,
      newBlackRating: newB,
      changeA,
      changeB,
    };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});
