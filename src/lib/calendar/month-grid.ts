// ============================================================
// Month grid for the content calendar — pure, unit-testable.
//
// Days are handled as 'YYYY-MM-DD' strings (the same shape as the
// `publish_date` DATE column) and built from local calendar parts, so
// no UTC conversion can shift a post onto the previous day.
// Weeks start on Monday, as in the marketing Excel.
// ============================================================

import {
  addDays,
  addMonths,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

export type IsoDay = string;

export function toIsoDay(date: Date): IsoDay {
  return format(date, 'yyyy-MM-dd');
}

/** Parse 'YYYY-MM-DD' as a local date (never via `new Date(str)`, which is UTC). */
export function fromIsoDay(day: IsoDay): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** First day of the month containing `day`, as 'YYYY-MM-01'. */
export function monthOf(day: IsoDay): IsoDay {
  return toIsoDay(startOfMonth(fromIsoDay(day)));
}

export function shiftMonth(month: IsoDay, delta: number): IsoDay {
  return toIsoDay(addMonths(fromIsoDay(month), delta));
}

export interface GridDay {
  day: IsoDay;
  inMonth: boolean;
}

/**
 * The weeks to draw for `month` ('YYYY-MM-01'): Monday-first, padded
 * with the neighbouring months' days, and only as many weeks as the
 * month needs (4–6), so short months don't get an empty last row.
 */
export function monthGrid(month: IsoDay): GridDay[][] {
  const first = startOfMonth(fromIsoDay(month));
  const monthIndex = first.getMonth();
  let cursor = startOfWeek(first, { weekStartsOn: 1 });
  const weeks: GridDay[][] = [];
  do {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        day: toIsoDay(cursor),
        inMonth: cursor.getMonth() === monthIndex,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === monthIndex);
  return weeks;
}

/** First and last day drawn in the grid, for the range query. */
export function gridRange(month: IsoDay): { from: IsoDay; to: IsoDay } {
  const weeks = monthGrid(month);
  return { from: weeks[0][0].day, to: weeks[weeks.length - 1][6].day };
}
