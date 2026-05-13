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
const firestoreDb = admin.firestore();
const { validateCreatePayload, validateUpdatePayload, validatePublishPayload } =
  require('./events-validate.js');
const { validateRegisterPayload, validateCheckInPayload, validateWithdrawPayload } =
  require('./registration-validate.js');

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

exports.createEvent = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const data = request.data || {};
    const validationError = validateCreatePayload(data);
    if (validationError) throw new HttpsError('invalid-argument', validationError);

    const uid = request.auth.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = firestoreDb.collection('events').doc();
    await docRef.set({
      title: data.title.trim(),
      organizerUid: uid,
      startDate: admin.firestore.Timestamp.fromDate(new Date(data.startDate)),
      endDate: admin.firestore.Timestamp.fromDate(new Date(data.endDate)),
      location: {
        address: (data.location?.address || '').trim(),
        city: data.location.city.trim(),
        state: data.location.state.trim().toUpperCase(),
      },
      format: data.format,
      sections: [],
      entryFee: 0,
      currency: 'USD',
      maxPlayers: Number(data.maxPlayers),
      status: 'draft',
      uscfRated: Boolean(data.uscfRated),
      country: 'US',
      createdAt: now,
      updatedAt: now,
    });
    return { eventId: docRef.id };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

exports.updateEvent = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const data = request.data || {};
    const validationError = validateUpdatePayload(data);
    if (validationError) throw new HttpsError('invalid-argument', validationError);

    const eventRef = firestoreDb.collection('events').doc(data.eventId);
    const snap = await eventRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Event not found');
    const existing = snap.data();
    if (existing.organizerUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the organizer can edit this event');
    }
    if (existing.status !== 'draft') {
      throw new HttpsError('failed-precondition', 'Only draft events can be edited');
    }

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (data.title != null) updates.title = data.title.trim();
    if (data.startDate != null) {
      updates.startDate = admin.firestore.Timestamp.fromDate(new Date(data.startDate));
    }
    if (data.endDate != null) {
      updates.endDate = admin.firestore.Timestamp.fromDate(new Date(data.endDate));
    }
    if (data.location != null) {
      updates.location = {
        address: (data.location.address || '').trim(),
        city: data.location.city.trim(),
        state: data.location.state.trim().toUpperCase(),
      };
    }
    if (data.format != null) updates.format = data.format;
    if (data.maxPlayers != null) updates.maxPlayers = Number(data.maxPlayers);
    if (data.uscfRated != null) updates.uscfRated = Boolean(data.uscfRated);

    await eventRef.update(updates);
    return { eventId: data.eventId };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

exports.publishEvent = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const validationError = validatePublishPayload(request.data);
    if (validationError) throw new HttpsError('invalid-argument', validationError);

    const { eventId } = request.data;
    const eventRef = firestoreDb.collection('events').doc(eventId);
    const snap = await eventRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Event not found');
    const existing = snap.data();
    if (existing.organizerUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the organizer can publish this event');
    }
    if (existing.status !== 'draft') {
      throw new HttpsError('failed-precondition', 'Only draft events can be published');
    }

    await eventRef.update({
      status: 'open',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { eventId };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error('Resend API error', res.status, await res.text());
    }
  } catch (err) {
    console.error('sendEmail failed', err);
  }
}

exports.registerForEvent = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const data = request.data || {};
    const validationError = validateRegisterPayload(data);
    if (validationError) throw new HttpsError('invalid-argument', validationError);

    const uid = request.auth.uid;
    const { eventId, playerName, playerEmail } = data;
    const regId = `${eventId}_${uid}`;

    const eventRef = firestoreDb.collection('events').doc(eventId);
    const regRef = firestoreDb.collection('registrations').doc(regId);

    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found');
    const event = eventSnap.data();
    if (event.status !== 'open') throw new HttpsError('failed-precondition', 'Event is not open for registration');

    // Count is read outside the transaction (Firestore count queries aren't available
    // inside transactions). maxPlayers is therefore a soft cap under concurrent load —
    // two simultaneous registrations near the limit may both land as 'confirmed'.
    const confirmedSnap = await firestoreDb.collection('registrations')
      .where('eventId', '==', eventId)
      .where('status', '==', 'confirmed')
      .count()
      .get();
    const confirmedCount = confirmedSnap.data().count;

    let waitlistPosition = null;
    let status = 'confirmed';
    if (confirmedCount >= event.maxPlayers) {
      status = 'waitlisted';
      const waitlistSnap = await firestoreDb.collection('registrations')
        .where('eventId', '==', eventId)
        .where('status', '==', 'waitlisted')
        .count()
        .get();
      waitlistPosition = waitlistSnap.data().count + 1;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await firestoreDb.runTransaction(async (tx) => {
      const existingSnap = await tx.get(regRef);
      if (existingSnap.exists) {
        const existing = existingSnap.data();
        if (existing.status !== 'withdrawn') {
          throw new HttpsError('already-exists', 'You are already registered for this event');
        }
      }
      tx.set(regRef, {
        eventId,
        playerUid: uid,
        organizerUid: event.organizerUid,
        playerName: playerName.trim().slice(0, 50),
        playerEmail: playerEmail.toLowerCase(),
        status,
        waitlistPosition,
        registeredAt: now,
        updatedAt: now,
        checkedInAt: null,
      });
    });

    await sendEmail({
      to: playerEmail.toLowerCase(),
      subject: status === 'confirmed'
        ? `Registration confirmed: ${event.title}`
        : `You're on the waitlist: ${event.title}`,
      html: status === 'confirmed'
        ? `<p>Hi ${escHtml(playerName)},</p><p>Your registration for <strong>${escHtml(event.title)}</strong> is confirmed.</p>`
        : `<p>Hi ${escHtml(playerName)},</p><p>You are on the waitlist for <strong>${escHtml(event.title)}</strong> at position ${waitlistPosition}.</p>`,
    });

    return { status, waitlistPosition };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

exports.checkInPlayer = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const validationError = validateCheckInPayload(request.data);
    if (validationError) throw new HttpsError('invalid-argument', validationError);

    const { registrationId } = request.data;
    const regRef = firestoreDb.collection('registrations').doc(registrationId);
    const snap = await regRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Registration not found');
    const reg = snap.data();
    if (reg.organizerUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the organizer can check in players');
    }
    if (reg.status === 'waitlisted' || reg.status === 'withdrawn') {
      throw new HttpsError('failed-precondition', 'Player must be confirmed to check in');
    }

    await regRef.update({
      status: 'checked_in',
      checkedInAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { registrationId };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});

exports.withdrawRegistration = onCall({ cors: true }, async (request) => {
  try {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const validationError = validateWithdrawPayload(request.data);
    if (validationError) throw new HttpsError('invalid-argument', validationError);

    const { registrationId } = request.data;
    const regRef = firestoreDb.collection('registrations').doc(registrationId);
    const snap = await regRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Registration not found');
    const reg = snap.data();
    if (reg.playerUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'You can only withdraw your own registration');
    }
    if (reg.status === 'withdrawn') {
      throw new HttpsError('failed-precondition', 'Registration is already withdrawn');
    }

    const wasConfirmed = reg.status === 'confirmed' || reg.status === 'checked_in';
    await regRef.update({
      status: 'withdrawn',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (wasConfirmed) {
      const waitlistSnap = await firestoreDb.collection('registrations')
        .where('eventId', '==', reg.eventId)
        .where('status', '==', 'waitlisted')
        .orderBy('waitlistPosition', 'asc')
        .limit(1)
        .get();
      if (!waitlistSnap.empty) {
        const nextRef = waitlistSnap.docs[0].ref;
        const nextData = waitlistSnap.docs[0].data();
        await nextRef.update({
          status: 'confirmed',
          waitlistPosition: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await sendEmail({
          to: nextData.playerEmail,
          subject: `You're in! Registration confirmed`,
          html: `<p>Hi ${escHtml(nextData.playerName)},</p><p>A spot has opened up and your registration is now confirmed. See you there!</p>`,
        });
      }
    }
    return { registrationId };
  } catch (e) {
    if (!(e instanceof HttpsError)) Sentry.captureException(e);
    throw e;
  }
});
