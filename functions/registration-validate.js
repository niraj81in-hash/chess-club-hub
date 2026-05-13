'use strict';

const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegisterPayload(data) {
  if (!data) return 'Payload required';
  if (!data.eventId || typeof data.eventId !== 'string') return 'eventId is required';
  if (typeof data.playerName !== 'string') return 'Player name must be a string';
  const name = data.playerName.trim();
  if (name.length < 2 || name.length > 50) return 'Player name must be 2–50 characters';
  const email = String(data.playerEmail || '');
  if (!VALID_EMAIL_RE.test(email)) return 'Valid player email is required';
  return null;
}

function validateCheckInPayload(data) {
  if (!data) return 'Payload required';
  if (!data.registrationId || typeof data.registrationId !== 'string') {
    return 'registrationId is required';
  }
  return null;
}

function validateWithdrawPayload(data) {
  if (!data) return 'Payload required';
  if (!data.registrationId || typeof data.registrationId !== 'string') {
    return 'registrationId is required';
  }
  return null;
}

module.exports = {
  validateRegisterPayload,
  validateCheckInPayload,
  validateWithdrawPayload,
};
