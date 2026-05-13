import { describe, it, expect } from 'vitest';
import {
  validateRegisterPayload,
  validateCheckInPayload,
  validateWithdrawPayload,
} from '../functions/registration-validate.js';

describe('validateRegisterPayload', () => {
  const base = {
    eventId: 'evt123',
    playerName: 'Alice Smith',
    playerEmail: 'alice@example.com',
  };

  it('returns null for valid payload', () => {
    expect(validateRegisterPayload(base)).toBeNull();
  });

  it('requires eventId', () => {
    expect(validateRegisterPayload({ ...base, eventId: '' })).toMatch(/eventId/i);
  });

  it('requires playerName at least 2 chars', () => {
    expect(validateRegisterPayload({ ...base, playerName: 'A' })).toMatch(/name/i);
  });

  it('rejects playerName longer than 50 chars', () => {
    expect(validateRegisterPayload({ ...base, playerName: 'A'.repeat(51) })).toMatch(/name/i);
  });

  it('rejects playerName that is not a string', () => {
    expect(validateRegisterPayload({ ...base, playerName: 123 })).toMatch(/name/i);
  });

  it('requires playerEmail with @', () => {
    expect(validateRegisterPayload({ ...base, playerEmail: 'aliceexample.com' })).toMatch(/email/i);
  });

  it('requires playerEmail with .', () => {
    expect(validateRegisterPayload({ ...base, playerEmail: 'alice@examplecom' })).toMatch(/email/i);
  });

  it('requires playerEmail', () => {
    expect(validateRegisterPayload({ ...base, playerEmail: '' })).toMatch(/email/i);
  });

  it('accepts playerEmail with uppercase (normalisation done by caller)', () => {
    expect(validateRegisterPayload({ ...base, playerEmail: 'Alice@Example.COM' })).toBeNull();
  });
});

describe('validateCheckInPayload', () => {
  it('returns null for valid payload', () => {
    expect(validateCheckInPayload({ registrationId: 'evt123_uid1' })).toBeNull();
  });

  it('requires registrationId', () => {
    expect(validateCheckInPayload({ registrationId: '' })).toMatch(/registrationId/i);
  });

  it('requires registrationId to be a non-empty string', () => {
    expect(validateCheckInPayload({ registrationId: 42 })).toMatch(/registrationId/i);
  });
});

describe('validateWithdrawPayload', () => {
  it('returns null for valid payload', () => {
    expect(validateWithdrawPayload({ registrationId: 'evt123_uid1' })).toBeNull();
  });

  it('requires registrationId', () => {
    expect(validateWithdrawPayload({})).toMatch(/registrationId/i);
  });
});
