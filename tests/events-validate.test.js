import { describe, it, expect } from 'vitest';
import { validateCreatePayload, validateUpdatePayload, validatePublishPayload }
  from '../functions/events-validate.js';

const BASE_CREATE = {
  title: 'City Championship',
  startDate: '2026-06-01T09:00:00',
  endDate: '2026-06-01T18:00:00',
  location: { address: '123 Main St', city: 'Chicago', state: 'IL' },
  format: 'swiss',
  maxPlayers: 32,
  uscfRated: false,
};

describe('validateCreatePayload', () => {
  it('returns null for valid input', () => {
    expect(validateCreatePayload(BASE_CREATE)).toBeNull();
  });
  it('returns error for blank title', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, title: '' })).toMatch(/title/i);
  });
  it('returns error for title over 80 characters', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, title: 'x'.repeat(81) })).toMatch(/title/i);
  });
  it('returns error when endDate equals startDate', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, endDate: BASE_CREATE.startDate })).toMatch(/date/i);
  });
  it('returns error when endDate is before startDate', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, endDate: '2026-05-31T09:00:00' })).toMatch(/date/i);
  });
  it('returns error for invalid format', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, format: 'blitz' })).toMatch(/format/i);
  });
  it('returns error for maxPlayers below 4', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, maxPlayers: 3 })).toMatch(/players/i);
  });
  it('returns error for maxPlayers above 256', () => {
    expect(validateCreatePayload({ ...BASE_CREATE, maxPlayers: 257 })).toMatch(/players/i);
  });
  it('returns error for missing location city', () => {
    const loc = { address: '123 Main', city: '', state: 'IL' };
    expect(validateCreatePayload({ ...BASE_CREATE, location: loc })).toMatch(/city/i);
  });
  it('returns error for missing location state', () => {
    const loc = { address: '123 Main', city: 'Chicago', state: '' };
    expect(validateCreatePayload({ ...BASE_CREATE, location: loc })).toMatch(/state/i);
  });
  it('accepts all four valid formats', () => {
    ['swiss', 'round_robin', 'single_elim', 'arena'].forEach(fmt => {
      expect(validateCreatePayload({ ...BASE_CREATE, format: fmt })).toBeNull();
    });
  });
});

describe('validateUpdatePayload', () => {
  it('returns null when only eventId provided', () => {
    expect(validateUpdatePayload({ eventId: 'abc123' })).toBeNull();
  });
  it('returns error for missing eventId', () => {
    expect(validateUpdatePayload({ title: 'New Title' })).toMatch(/eventId/i);
  });
  it('returns error for blank title update', () => {
    expect(validateUpdatePayload({ eventId: 'abc123', title: '' })).toMatch(/title/i);
  });
  it('returns error for invalid format update', () => {
    expect(validateUpdatePayload({ eventId: 'abc123', format: 'blitz' })).toMatch(/format/i);
  });
  it('returns error for maxPlayers out of range', () => {
    expect(validateUpdatePayload({ eventId: 'abc123', maxPlayers: 1 })).toMatch(/players/i);
  });
  it('returns error when endDate is before startDate in same payload', () => {
    expect(validateUpdatePayload({
      eventId: 'abc123',
      startDate: '2026-06-01T09:00:00',
      endDate:   '2026-05-31T09:00:00',
    })).toMatch(/date/i);
  });
});

describe('validatePublishPayload', () => {
  it('returns null for valid eventId', () => {
    expect(validatePublishPayload({ eventId: 'abc123' })).toBeNull();
  });
  it('returns error for missing eventId', () => {
    expect(validatePublishPayload({})).toMatch(/eventId/i);
  });
  it('returns error for non-string eventId', () => {
    expect(validatePublishPayload({ eventId: 42 })).toMatch(/eventId/i);
  });
});
