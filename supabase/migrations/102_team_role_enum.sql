-- ============================================================
-- 102_team_role_enum.sql — add the 'team' account role
--
-- Fork migration (Unno). A role for people who work with the team
-- (designers) but must not see customer data: they get the Equipo
-- page and their own settings, nothing else. The policies that use
-- it are in 103_team_role_access.sql.
--
-- On its own file because Postgres refuses to use an enum value in
-- the same transaction that added it ("unsafe use of new value").
-- Run this one first, then 103.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TYPE account_role_enum ADD VALUE IF NOT EXISTS 'team' BEFORE 'viewer';
