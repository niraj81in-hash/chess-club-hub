'use strict';

const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegisterPayload(data) {
  if (!data) return 'Payload required';
  if (!data.eventId || typeof data.eventId !== 'string') return 'eventId is required';
  if (typeof data.playerName !== 'string') return 'Player name must be a string';
  const name = data.playerName.trim();
  if (name.length < 2 || name.length > 50) return 'Player name must be 2–50 characters';
  if (!data.playerEmail || typeof data.playerEmail !== 'string') return 'Valid player email is required';
  if (!VALID_EMAIL_RE.test(data.playerEmail)) return 'Valid player email is required';
  return null;
}

function requireRegistrationId(data) {
  if (!data) return 'Payload required';
  if (!data.registrationId || typeof data.registrationId !== 'string') {
    return 'registrationId is required';
  }
  return null;
}

function validateCheckInPayload(data) {
  return requireRegistrationId(data);
}

function validateWithdrawPayload(data) {
  return requireRegistrationId(data);
}

module.exports = {
  validateRegisterPayload,
  validateCheckInPayload,
  validateWithdrawPayload,
};
