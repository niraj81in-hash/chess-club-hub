import { describe, it, expect } from 'vitest';
import { formatEventDate, validateEventForm } from '../js/events.js';

describe('formatEventDate', () => {
  it('formats a datetime ISO string', () => {
    expect(formatEventDate('2026-06-01T09:00:00')).toBe('Jun 1, 2026');
  });
  it('formats a date-only string', () => {
    expect(formatEventDate('2026-12-25')).toBe('Dec 25, 2026');
  });
  it('formats a UTC ISO string without shifting the day', () => {
    expect(formatEventDate('2026-03-15T00:00:00.000Z')).toBe('Mar 15, 2026');
  });
});

describe('validateEventForm', () => {
  const VALID = {
    title: 'City Championship',
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    address: '123 Main St',
    city: 'Chicago',
    state: 'IL',
    format: 'swiss',
    maxPlayers: '32',
    uscfRated: false,
  };

  it('returns null for valid input', () => {
    expect(validateEventForm(VALID)).toBeNull();
  });
  it('returns error for blank title', () => {
    expect(validateEventForm({ ...VALID, title: '  ' })).toMatch(/title/i);
  });
  it('returns error for title over 80 characters', () => {
    expect(validateEventForm({ ...VALID, title: 'x'.repeat(81) })).toMatch(/title/i);
  });
  it('returns error for missing start date', () => {
    expect(validateEventForm({ ...VALID, startDate: '' })).toMatch(/start date/i);
  });
  it('returns error when end date is before start date', () => {
    expect(validateEventForm({ ...VALID, endDate: '2026-05-31' })).toMatch(/end date/i);
  });
  it('returns error for blank city', () => {
    expect(validateEventForm({ ...VALID, city: '' })).toMatch(/city/i);
  });
  it('returns error for blank state', () => {
    expect(validateEventForm({ ...VALID, state: '' })).toMatch(/state/i);
  });
  it('returns error for invalid format', () => {
    expect(validateEventForm({ ...VALID, format: 'blitz' })).toMatch(/format/i);
  });
  it('returns error for maxPlayers below 4', () => {
    expect(validateEventForm({ ...VALID, maxPlayers: '2' })).toMatch(/players/i);
  });
  it('returns error for maxPlayers above 256', () => {
    expect(validateEventForm({ ...VALID, maxPlayers: '300' })).toMatch(/players/i);
  });
  it('returns error for non-numeric maxPlayers', () => {
    expect(validateEventForm({ ...VALID, maxPlayers: 'abc' })).toMatch(/players/i);
  });
  it('accepts all four valid formats', () => {
    ['swiss', 'round_robin', 'single_elim', 'arena'].forEach(fmt => {
      expect(validateEventForm({ ...VALID, format: fmt })).toBeNull();
    });
  });
});
