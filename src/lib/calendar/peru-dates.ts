// ============================================================
// Peruvian calendar dates for the content calendar — pure, no I/O.
//
// Two kinds:
//   - holiday:    national public holidays (feriados), per the list in
//                 force since 2022 (Ley 31788 and earlier). The
//                 government sometimes adds one-off "días no
//                 laborables"; those are not here — add them as a key
//                 date on the calendar instead.
//   - commercial: retail moments the marketing team plans around
//                 (campaña escolar, Día de la Madre, Black Friday, …).
//                 School start is approximate: MINEDU sets it each
//                 year, usually the third Monday of March.
//
// Labels are translated under Calendar.peru.<key>.
// ============================================================

import { toIsoDay, type IsoDay } from './month-grid';

export type PeruDateKind = 'holiday' | 'commercial';

export interface PeruDate {
  day: IsoDay;
  kind: PeruDateKind;
  key: string;
}

/** Easter Sunday (Gregorian), Anonymous / Meeus algorithm. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** The n-th (1-based) given weekday (0 = Sunday) of a month (1-based). */
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  n: number
): Date {
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
}

function shift(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

const FIXED_HOLIDAYS: [string, string][] = [
  ['01-01', 'new_year'],
  ['05-01', 'labor_day'],
  ['06-07', 'flag_day'],
  ['06-29', 'saints_peter_paul'],
  ['07-23', 'air_force'],
  ['07-28', 'independence'],
  ['07-29', 'independence_2'],
  ['08-06', 'junin'],
  ['08-30', 'santa_rosa'],
  ['10-08', 'angamos'],
  ['11-01', 'all_saints'],
  ['12-08', 'immaculate'],
  ['12-09', 'ayacucho'],
  ['12-25', 'christmas'],
];

const FIXED_COMMERCIAL: [string, string][] = [
  ['02-01', 'school_campaign'],
  ['02-14', 'valentines'],
  ['03-08', 'womens_day'],
  ['10-31', 'halloween'],
  ['11-11', 'singles_day'],
  ['11-19', 'mens_day'],
  ['12-01', 'christmas_campaign'],
];

export function peruDatesForYear(year: number): PeruDate[] {
  const at = (mmdd: string) => `${year}-${mmdd}`;
  const easter = easterSunday(year);
  const thanksgiving = nthWeekday(year, 11, 4, 4); // 4th Thursday of November

  const dates: PeruDate[] = [
    ...FIXED_HOLIDAYS.map(([d, key]) => ({
      day: at(d),
      kind: 'holiday' as const,
      key,
    })),
    { day: toIsoDay(shift(easter, -3)), kind: 'holiday', key: 'holy_thursday' },
    { day: toIsoDay(shift(easter, -2)), kind: 'holiday', key: 'good_friday' },
    ...FIXED_COMMERCIAL.map(([d, key]) => ({
      day: at(d),
      kind: 'commercial' as const,
      key,
    })),
    {
      day: toIsoDay(nthWeekday(year, 2, 6, 1)),
      kind: 'commercial',
      key: 'pisco_sour',
    },
    {
      day: toIsoDay(nthWeekday(year, 3, 1, 3)),
      kind: 'commercial',
      key: 'school_start',
    },
    {
      day: toIsoDay(nthWeekday(year, 5, 0, 2)),
      kind: 'commercial',
      key: 'mothers_day',
    },
    {
      day: toIsoDay(nthWeekday(year, 6, 0, 3)),
      kind: 'commercial',
      key: 'fathers_day',
    },
    {
      day: toIsoDay(shift(thanksgiving, 1)),
      kind: 'commercial',
      key: 'black_friday',
    },
    {
      day: toIsoDay(shift(thanksgiving, 4)),
      kind: 'commercial',
      key: 'cyber_monday',
    },
  ];
  return dates.sort((a, b) => a.day.localeCompare(b.day));
}

/** Peruvian dates between two days inclusive (may span two years). */
export function peruDatesBetween(from: IsoDay, to: IsoDay): PeruDate[] {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  return [...years]
    .flatMap(peruDatesForYear)
    .filter((d) => d.day >= from && d.day <= to);
}
