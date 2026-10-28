import { describe, expect, it } from 'vitest';

import { nextMeetingDay } from './next-meeting';

const meeting = (day: string, id = day) => ({ id, kind: 'meeting', day });

describe('nextMeetingDay', () => {
  it('shows a later meeting when there is none today', () => {
    expect(
      nextMeetingDay(
        [meeting('2026-11-06'), meeting('2026-11-13')],
        '2026-10-27'
      )
    ).toEqual([meeting('2026-11-06')]);
  });

  it('keeps today’s meetings all day, all of them', () => {
    const today = [meeting('2026-10-27', 'a'), meeting('2026-10-27', 'b')];
    expect(
      nextMeetingDay([...today, meeting('2026-10-28')], '2026-10-27')
    ).toEqual(today);
  });

  it('ignores past days and key dates', () => {
    expect(
      nextMeetingDay(
        [
          meeting('2026-10-20'),
          { id: 'x', kind: 'key_date', day: '2026-10-28' },
        ],
        '2026-10-27'
      )
    ).toEqual([]);
  });
});
