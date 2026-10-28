-- ============================================================
-- 105_calendar_event_repeat.sql — repeating calendar events
--
-- Fork migration (Unno). Requires 104. Lets a meeting or key date
-- repeat ("todos los martes") instead of being entered once per week.
--
-- Design notes
--   - One row per series. Occurrences are expanded in the app
--     (src/lib/calendar/recurrence.ts) for the month on screen; none
--     are stored, so editing the row edits every occurrence.
--   - `repeat` is a closed list mirrored in that file:
--       none      a single day (event_date)
--       weekly    every week on event_date's weekday
--       biweekly  every other week on that weekday
--       weekdays  Monday to Friday
--     `repeat_until` (inclusive) ends the series; NULL repeats forever.
--   - The saved meeting links of 101 (`team_meetings`) are no longer
--     shown on the page — a repeating meeting with its link replaces
--     them. The table is left in place, untouched.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS repeat text NOT NULL DEFAULT 'none';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS repeat_until date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_repeat_check') THEN
    ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_repeat_check
      CHECK (repeat IN ('none', 'weekly', 'biweekly', 'weekdays'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_repeat_until_check') THEN
    ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_repeat_until_check
      CHECK (repeat_until IS NULL OR repeat_until >= event_date);
  END IF;
END $$;
