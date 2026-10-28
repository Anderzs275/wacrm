import { describe, expect, it } from 'vitest';

import {
  occurrencesBetween,
  occursOn,
  type RepeatingEvent,
} from './recurrence';

// 3 Nov 2026 is a Tuesday.
const tuesdays: RepeatingEvent = {
  event_date: '2026-11-03',
  repeat: 'weekly',
  repeat_until: null,
};

describe('occurrencesBetween', () => {
  it('repeats every week on the same weekday', () => {
    expect(occurrencesBetween(tuesdays, '2026-10-26', '2026-11-30')).toEqual([
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
    ]);
  });

  it('skips every other week when biweekly', () => {
    expect(
      occurrencesBetween(
        { ...tuesdays, repeat: 'biweekly' },
        '2026-11-01',
        '2026-11-30'
      )
    ).toEqual(['2026-11-03', '2026-11-17']);
  });

  it('covers Monday to Friday for weekdays', () => {
    expect(
      occurrencesBetween(
        { ...tuesdays, repeat: 'weekdays' },
        '2026-11-02',
        '2026-11-08'
      )
    ).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  });

  it('stops at repeat_until, inclusive', () => {
    expect(
      occurrencesBetween(
        { ...tuesdays, repeat_until: '2026-11-10' },
        '2026-11-01',
        '2026-11-30'
      )
    ).toEqual(['2026-11-03', '2026-11-10']);
  });

  it('returns the single day for a one-off', () => {
    expect(
      occurrencesBetween(
        { ...tuesdays, repeat: 'none' },
        '2026-11-01',
        '2026-11-30'
      )
    ).toEqual(['2026-11-03']);
  });
});

describe('multi-day spans', () => {
  const cyberWow: RepeatingEvent = {
    event_date: '2026-11-02',
    end_date: '2026-11-05',
    repeat: 'none',
    repeat_until: null,
  };

  it('covers every day of the span, clipped to the range', () => {
    expect(occurrencesBetween(cyberWow, '2026-11-04', '2026-11-30')).toEqual([
      '2026-11-04',
      '2026-11-05',
    ]);
  });

  it('is not on the day after it ends', () => {
    expect(occursOn(cyberWow, '2026-11-05')).toBe(true);
    expect(occursOn(cyberWow, '2026-11-06')).toBe(false);
  });
});

describe('occursOn', () => {
  it('never falls before the first day', () => {
    expect(occursOn(tuesdays, '2026-10-27')).toBe(false);
    expect(occursOn(tuesdays, '2027-03-02')).toBe(true);
  });
});
