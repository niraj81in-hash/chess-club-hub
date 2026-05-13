import { describe, it, expect } from 'vitest';
import { isLinkedAccount } from '../js/utils.js';

describe('isLinkedAccount', () => {
  it('returns false for null user', () => {
    expect(isLinkedAccount(null)).toBe(false);
  });
  it('returns false for undefined user', () => {
    expect(isLinkedAccount(undefined)).toBe(false);
  });
  it('returns false for anonymous user', () => {
    expect(isLinkedAccount({ isAnonymous: true, email: null })).toBe(false);
  });
  it('returns false for anonymous user even with email', () => {
    expect(isLinkedAccount({ isAnonymous: true, email: 'a@b.com' })).toBe(false);
  });
  it('returns true for email-linked non-anonymous user', () => {
    expect(isLinkedAccount({ isAnonymous: false, email: 'coach@school.edu' })).toBe(true);
  });
  it('returns false for non-anonymous user with no email', () => {
    expect(isLinkedAccount({ isAnonymous: false, email: null })).toBe(false);
  });
  it('returns false for non-anonymous user with empty string email', () => {
    expect(isLinkedAccount({ isAnonymous: false, email: '' })).toBe(false);
  });
});
