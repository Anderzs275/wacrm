import { describe, expect, it } from 'vitest';

import { toIsoDay } from './month-grid';
import { easterSunday, peruDatesBetween, peruDatesForYear } from './peru-dates';

const find = (year: number, key: string) =>
  peruDatesForYear(year).find((d) => d.key === key)?.day;

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('%i → %s', (year, day) => {
    expect(toIsoDay(easterSunday(year))).toBe(day);
  });
});

describe('peruDatesForYear', () => {
  it('puts Semana Santa holidays before Easter', () => {
    expect(find(2026, 'holy_thursday')).toBe('2026-04-02');
    expect(find(2026, 'good_friday')).toBe('2026-04-03');
  });

  it('has the fixed national holidays', () => {
    const holidays = peruDatesForYear(2026).filter((d) => d.kind === 'holiday');
    expect(holidays).toHaveLength(16);
    expect(find(2026, 'independence')).toBe('2026-07-28');
    expect(find(2026, 'ayacucho')).toBe('2026-12-09');
  });

  it('computes the moving retail dates', () => {
    expect(find(2026, 'mothers_day')).toBe('2026-05-10'); // 2nd Sunday of May
    expect(find(2026, 'fathers_day')).toBe('2026-06-21'); // 3rd Sunday of June
    expect(find(2026, 'black_friday')).toBe('2026-11-27'); // after 26 Nov
    expect(find(2026, 'cyber_monday')).toBe('2026-11-30');
    expect(find(2026, 'school_start')).toBe('2026-03-16');
  });
});

describe('peruDatesBetween', () => {
  it('spans a year boundary', () => {
    const keys = peruDatesBetween('2026-12-28', '2027-01-03').map((d) => d.key);
    expect(keys).toEqual(['new_year']);
  });
});
