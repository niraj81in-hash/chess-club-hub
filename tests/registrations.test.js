import { describe, it, expect } from 'vitest';
import { validateRegistrationForm, generateCSV } from '../js/registrations.js';

describe('validateRegistrationForm', () => {
  const base = { playerName: 'Alice Smith', playerEmail: 'alice@example.com' };

  it('returns null for valid data', () => {
    expect(validateRegistrationForm(base)).toBeNull();
  });

  it('rejects name shorter than 2 chars', () => {
    expect(validateRegistrationForm({ ...base, playerName: 'A' })).toMatch(/name/i);
  });

  it('rejects name longer than 50 chars', () => {
    expect(validateRegistrationForm({ ...base, playerName: 'A'.repeat(51) })).toMatch(/name/i);
  });

  it('rejects non-string name', () => {
    expect(validateRegistrationForm({ ...base, playerName: 42 })).toMatch(/name/i);
  });

  it('rejects email without @', () => {
    expect(validateRegistrationForm({ ...base, playerEmail: 'aliceexample.com' })).toMatch(/email/i);
  });

  it('rejects email without .', () => {
    expect(validateRegistrationForm({ ...base, playerEmail: 'alice@examplecom' })).toMatch(/email/i);
  });

  it('rejects empty email', () => {
    expect(validateRegistrationForm({ ...base, playerEmail: '' })).toMatch(/email/i);
  });

  it('trims name before length check', () => {
    expect(validateRegistrationForm({ ...base, playerName: '  A  ' })).toMatch(/name/i);
  });
});

describe('generateCSV', () => {
  const reg = (overrides = {}) => ({
    playerName: 'Alice Smith',
    playerEmail: 'alice@example.com',
    status: 'confirmed',
    registeredAt: new Date('2026-06-15T10:30:00').toISOString(),
    checkedInAt: null,
    waitlistPosition: null,
    ...overrides,
  });

  it('generates a header row', () => {
    const csv = generateCSV([reg()]);
    expect(csv.split('\n')[0]).toBe('#,Name,Email,Status,Registered,Checked In,Waitlist Position');
  });

  it('generates one data row per registration', () => {
    const csv = generateCSV([reg(), reg({ playerName: 'Bob Jones' })]);
    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it('includes sequential row numbers', () => {
    const csv = generateCSV([reg(), reg({ playerName: 'Bob Jones' })]);
    const lines = csv.split('\n').filter(Boolean);
    expect(lines[1].startsWith('1,')).toBe(true);
    expect(lines[2].startsWith('2,')).toBe(true);
  });

  it('formats Registered as YYYY-MM-DD HH:MM', () => {
    const csv = generateCSV([reg()]);
    expect(csv).toContain('2026-06-15');
  });

  it('leaves Checked In empty when null', () => {
    const csv = generateCSV([reg()]);
    const parts = csv.split('\n')[1].split(',');
    expect(parts[5]).toBe('');
  });

  it('formats Checked In when present', () => {
    const csv = generateCSV([reg({ checkedInAt: new Date('2026-06-16T09:00:00').toISOString(), status: 'checked_in' })]);
    expect(csv).toContain('2026-06-16');
  });

  it('leaves Waitlist Position empty when null', () => {
    const csv = generateCSV([reg()]);
    const parts = csv.split('\n')[1].split(',');
    expect(parts[6]).toBe('');
  });

  it('includes Waitlist Position when set', () => {
    const csv = generateCSV([reg({ status: 'waitlisted', waitlistPosition: 3 })]);
    const parts = csv.split('\n')[1].split(',');
    expect(parts[6]).toBe('3');
  });

  it('returns header only for empty array', () => {
    const csv = generateCSV([]);
    expect(csv.trim()).toBe('#,Name,Email,Status,Registered,Checked In,Waitlist Position');
  });

  it('wraps names with commas in quotes', () => {
    const csv = generateCSV([reg({ playerName: 'Smith, Alice' })]);
    expect(csv).toContain('"Smith, Alice"');
  });
});
