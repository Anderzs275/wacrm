import { describe, expect, it } from 'vitest';

import { normalizeMeetingUrl } from './meeting-url';

describe('normalizeMeetingUrl', () => {
  it('keeps a full https link', () => {
    expect(normalizeMeetingUrl('https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij'
    );
  });

  it('adds https to a link pasted without a scheme', () => {
    expect(normalizeMeetingUrl('  meet.google.com/abc-defg-hij ')).toBe(
      'https://meet.google.com/abc-defg-hij'
    );
  });

  it('rejects non-web schemes instead of fixing them', () => {
    expect(normalizeMeetingUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeMeetingUrl('data:text/html,hi')).toBeNull();
    expect(normalizeMeetingUrl('mailto:a@b.com')).toBeNull();
  });

  it('rejects empty, spaced and host-less input', () => {
    expect(normalizeMeetingUrl('')).toBeNull();
    expect(normalizeMeetingUrl('reunion de las 9')).toBeNull();
    expect(normalizeMeetingUrl('localhost')).toBeNull();
  });
});
