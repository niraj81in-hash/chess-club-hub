import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../js/utils.js';

describe('escapeHtml', () => {
  it('escapes script tags', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('escapes img onerror XSS vector', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
  it('escapes double quotes', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });
  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });
  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
  it('coerces non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});
