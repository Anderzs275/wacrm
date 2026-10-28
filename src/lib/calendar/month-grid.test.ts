import { describe, expect, it } from 'vitest';

import {
  fromIsoDay,
  gridRange,
  monthGrid,
  monthOf,
  shiftMonth,
  toIsoDay,
} from './month-grid';

describe('monthGrid', () => {
  it('starts on Monday and pads with the previous month', () => {
    // 1 Oct 2026 is a Thursday.
    const weeks = monthGrid('2026-10-01');
    expect(weeks[0].map((d) => d.day)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks[0][2].inMonth).toBe(false);
    expect(weeks[0][3].inMonth).toBe(true);
  });

  it('draws only the weeks the month needs', () => {
    expect(monthGrid('2026-10-01')).toHaveLength(5); // ends Sat 31 Oct
    expect(monthGrid('2027-02-01')).toHaveLength(4); // Feb 2027: Mon 1 – Sun 28
    expect(monthGrid('2026-08-01')).toHaveLength(6); // Sat 1 – Mon 31
  });

  it('ends on the Sunday after the last day', () => {
    expect(gridRange('2026-10-01')).toEqual({
      from: '2026-09-28',
      to: '2026-11-01',
    });
  });
});

describe('day helpers', () => {
  it('round-trips a day without shifting it', () => {
    expect(toIsoDay(fromIsoDay('2026-10-27'))).toBe('2026-10-27');
  });

  it('finds the month and moves across years', () => {
    expect(monthOf('2026-10-27')).toBe('2026-10-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
  });
});
