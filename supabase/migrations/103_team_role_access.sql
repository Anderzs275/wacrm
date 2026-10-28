-- ============================================================
-- 103_team_role_access.sql — what the 'team' role may read
--
-- Fork migration (Unno). Requires 102_team_role_enum.sql.
--
-- How the role is contained
--   `is_account_member(account, min_role)` gains rank 0 for 'team',
--   below viewer (1). Its default `min_role` stays 'viewer', so every
--   existing policy — contacts, conversations, messages, broadcasts,
--   settings, … — keeps refusing a team member without being touched.
--   Access is then opened one table at a time by asking for
--   `is_account_member(account_id, 'team')` explicitly:
--
--     accounts            the account row (name), needed to load the app
--     profiles            teammates' names and avatars
--     member_presence     who is connected
--     team_groups,
--     team_group_members,
--     team_meetings       the Equipo page (read only for this role;
--                         meeting writes stay agent+)
--
--   Note that 'team' passing a min_role='team' check also means every
--   higher role passes it, so these policies are not narrower for
--   anyone else than they were.
--
--   The server-side half is `getCurrentAccount`, which refuses the
--   role unless a route opts in (src/lib/auth/account.ts), because
--   some routes act through the service-role client after checking
--   membership only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
            WHEN 'team'   THEN 0
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
            WHEN 'team'   THEN 0
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ---- core tables the app shell needs -----------------------
DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id, 'team'));

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (auth.uid() = user_id OR is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS member_presence_select ON member_presence;
CREATE POLICY member_presence_select ON member_presence FOR SELECT
  USING (is_account_member(account_id, 'team'));

-- ---- Equipo page (101) -------------------------------------
DROP POLICY IF EXISTS team_groups_select ON team_groups;
CREATE POLICY team_groups_select ON team_groups FOR SELECT
  USING (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS team_group_members_select ON team_group_members;
CREATE POLICY team_group_members_select ON team_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_groups g
    WHERE g.id = group_id AND is_account_member(g.account_id, 'team')
  ));

DROP POLICY IF EXISTS team_meetings_select ON team_meetings;
CREATE POLICY team_meetings_select ON team_meetings FOR SELECT
  USING (is_account_member(account_id, 'team'));
