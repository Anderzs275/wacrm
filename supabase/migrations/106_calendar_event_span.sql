-- ============================================================
-- 106_calendar_event_span.sql — multi-day events and priority
--
-- Fork migration (Unno). Requires 105. Lets a key date cover several
-- days (Cyber Wow, Fiestas Patrias campaign) and be marked high
-- priority so it stands out on the calendar.
--
-- Design notes
--   - `end_date` (inclusive) makes an event span event_date..end_date;
--     NULL is a single day. The calendar draws it as one bar across
--     those days (src/components/calendar/calendar-card.tsx).
--   - A span cannot also repeat: "every week, for four days" is not a
--     thing the team asked for, and refusing it keeps the expansion in
--     src/lib/calendar/recurrence.ts simple.
--   - `priority` is a closed list: 'normal' | 'high'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_end_date_check') THEN
    ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_end_date_check
      CHECK (end_date IS NULL OR (end_date >= event_date AND repeat = 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_priority_check') THEN
    ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_priority_check
      CHECK (priority IN ('normal', 'high'));
  END IF;
END $$;
