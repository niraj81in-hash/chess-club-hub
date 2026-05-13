'use strict';

const VALID_FORMATS = ['swiss', 'round_robin', 'single_elim', 'arena'];

function validateCreatePayload(data) {
  if (!data) return 'No data provided';
  const title = (data.title || '').trim();
  if (title.length < 2 || title.length > 80) return 'Title must be 2–80 characters';
  if (!data.startDate) return 'startDate is required';
  if (!data.endDate) return 'endDate is required';
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  if (isNaN(start.getTime())) return 'Invalid startDate';
  if (isNaN(end.getTime())) return 'Invalid endDate';
  if (end <= start) return 'End date must be after start date';
  if (!data.location?.city?.trim()) return 'Location city is required';
  if (!data.location?.state?.trim()) return 'Location state is required';
  if (!VALID_FORMATS.includes(data.format)) {
    return 'Invalid format — must be swiss, round_robin, single_elim, or arena';
  }
  const mp = Number(data.maxPlayers);
  if (!Number.isInteger(mp) || mp < 4 || mp > 256) {
    return 'maxPlayers must be an integer between 4 and 256';
  }
  return null;
}

function validateUpdatePayload(data) {
  if (!data?.eventId || typeof data.eventId !== 'string') return 'eventId is required';
  if (data.title != null) {
    if (typeof data.title !== 'string') return 'Title must be a string';
    const title = data.title.trim();
    if (title.length < 2 || title.length > 80) return 'Title must be 2–80 characters';
  }
  if (data.startDate != null && isNaN(new Date(data.startDate).getTime())) {
    return 'Invalid startDate';
  }
  if (data.endDate != null && isNaN(new Date(data.endDate).getTime())) {
    return 'Invalid endDate';
  }
  if (data.startDate != null && data.endDate != null) {
    if (new Date(data.endDate) <= new Date(data.startDate)) {
      return 'End date must be after start date';
    }
  }
  if (data.format != null && !VALID_FORMATS.includes(data.format)) {
    return 'Invalid format';
  }
  if (data.maxPlayers != null) {
    const mp = Number(data.maxPlayers);
    if (!Number.isInteger(mp) || mp < 4 || mp > 256) {
      return 'maxPlayers must be an integer between 4 and 256';
    }
  }
  return null;
}

function validatePublishPayload(data) {
  if (!data?.eventId || typeof data.eventId !== 'string') return 'eventId is required';
  return null;
}

module.exports = { validateCreatePayload, validateUpdatePayload, validatePublishPayload };
