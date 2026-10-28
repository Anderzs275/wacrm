// ============================================================
// Which meetings the Equipo strip shows — pure, unit-testable.
// ============================================================

import type { IsoDay } from './month-grid';

interface DayEvent {
  kind: string;
  day: IsoDay;
}

/**
 * Every meeting on the first day, from `today` on, that has one. A
 * meeting day stays "next" until the day is over, so the strip keeps
 * showing it (and its Join link) all that day. Empty when nothing is
 * coming up.
 */
export function nextMeetingDay<T extends DayEvent>(
  occurrences: readonly T[],
  today: IsoDay
): T[] {
  const meetings = occurrences.filter(
    (e) => e.kind === 'meeting' && e.day >= today
  );
  const first = meetings.reduce<IsoDay | null>(
    (min, e) => (min === null || e.day < min ? e.day : min),
    null
  );
  return first ? meetings.filter((e) => e.day === first) : [];
}
