-- ============================================================
-- 109_content_posts_approved.sql — "approved" content status
--
-- Fork migration (Unno). Requires 104.
--
-- Adds `approved` between `review` and `published`, so the board reads
-- Pendiente → En proceso → En revisión → Aprobado → Publicado. The list
-- mirrors CONTENT_STATUSES in src/lib/calendar/content-meta.ts.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE content_posts DROP CONSTRAINT IF EXISTS content_posts_status_check;

ALTER TABLE content_posts ADD CONSTRAINT content_posts_status_check
  CHECK (status IN ('pending', 'in_progress', 'review', 'approved', 'published'));
