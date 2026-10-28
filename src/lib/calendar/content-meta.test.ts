import { describe, expect, it } from 'vitest';

import { isOverdue, toCategory, toStatus } from './content-meta';

describe('isOverdue', () => {
  it('flags unpublished posts whose day has passed', () => {
    expect(
      isOverdue({ status: 'pending', publish_date: '2026-10-26' }, '2026-10-27')
    ).toBe(true);
    expect(
      isOverdue(
        { status: 'published', publish_date: '2026-10-26' },
        '2026-10-27'
      )
    ).toBe(false);
    expect(
      isOverdue({ status: 'review', publish_date: '2026-10-27' }, '2026-10-27')
    ).toBe(false);
  });
});

describe('closed lists', () => {
  it('falls back for unknown values', () => {
    expect(toCategory('humor')).toBe('humor');
    expect(toCategory('memes')).toBe('product');
    expect(toStatus(null)).toBe('pending');
  });
});
