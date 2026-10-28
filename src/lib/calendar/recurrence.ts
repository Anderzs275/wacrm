// ============================================================
// Repeating calendar events — pure, unit-testable.
//
// A series is one `calendar_events` row (see
// 105_calendar_event_repeat.sql, spans from 106); this expands it
// into the days it falls on within the range on screen. Nothing is
// stored per occurrence, so editing the row edits all of them.
// ============================================================

import { addDays } from 'date-fns';

import { fromIsoDay, toIsoDay, type IsoDay } from './month-grid';

export const REPEAT_RULES = ['none', 'weekly', 'biweekly', 'weekdays'] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];

export function toRepeatRule(value: unknown): RepeatRule {
  return (REPEAT_RULES as readonly unknown[]).includes(value)
    ? (value as RepeatRule)
    : 'none';
}

export interface RepeatingEvent {
  event_date: IsoDay;
  /** Last day of a multi-day span (106); never combined with a repeat. */
  end_date?: IsoDay | null;
  repeat: RepeatRule;
  repeat_until: IsoDay | null;
}

const DAY_MS = 86_400_000;

function daysBetween(a: IsoDay, b: IsoDay): number {
  // Both at local midnight; round absorbs a DST hour where one exists.
  return Math.round(
    (fromIsoDay(b).getTime() - fromIsoDay(a).getTime()) / DAY_MS
  );
}

/** Does the series fall on `day`? */
export function occursOn(event: RepeatingEvent, day: IsoDay): boolean {
  if (day < event.event_date) return false;
  if (event.repeat_until && day > event.repeat_until) return false;
  switch (event.repeat) {
    case 'none':
      return day <= (event.end_date ?? event.event_date);
    case 'weekly':
      return daysBetween(event.event_date, day) % 7 === 0;
    case 'biweekly':
      return daysBetween(event.event_date, day) % 14 === 0;
    case 'weekdays': {
      const weekday = fromIsoDay(day).getDay();
      return weekday >= 1 && weekday <= 5;
    }
  }
}

/** Every day in [from, to] the series falls on, in order. */
export function occurrencesBetween(
  event: RepeatingEvent,
  from: IsoDay,
  to: IsoDay
): IsoDay[] {
  const days: IsoDay[] = [];
  const start = from > event.event_date ? from : event.event_date;
  const last =
    event.repeat === 'none'
      ? (event.end_date ?? event.event_date)
      : event.repeat_until;
  const end = last && last < to ? last : to;
  for (
    let cursor = fromIsoDay(start);
    toIsoDay(cursor) <= end;
    cursor = addDays(cursor, 1)
  ) {
    const day = toIsoDay(cursor);
    if (occursOn(event, day)) days.push(day);
  }
  return days;
}
