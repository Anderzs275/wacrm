-- ============================================================
-- 101_team_space.sql — "Equipo" page: teams and shared meeting links
--
-- Fork migration (Unno). Backs the internal team page, which shows
-- who is connected (reusing `member_presence` from 024), the meeting
-- links everyone joins, and team labels (Marketing, Ventas, ...) that
-- later parts of the roadmap (content calendar, activity log) filter
-- by.
--
-- Design notes
--   - `team_groups` are labels, not permissions. Being in "Marketing"
--     grants nothing; access is still the account role. Colours are
--     a free-text palette key validated in the app layer
--     (src/lib/team/colors.ts), like tracking's `phone_problem`.
--
--   - `team_group_members` carries no `account_id`: the group already
--     pins the account, and RLS resolves it through the parent row.
--     Both FKs cascade, so deleting a group or a user removes the
--     memberships with it.
--
--   - `team_meetings.created_by` / `updated_by` are stamped by a
--     trigger from `auth.uid()`, never trusted from the client, so
--     "changed by" on the page (and the activity log later) cannot be
--     spoofed.
--
-- RLS
--   Everyone in the account (viewer+) reads all three tables.
--   Meetings: agent+ create, edit and delete, so any working teammate
--   can update the link for everyone. Groups and memberships: admin+
--   only, since they describe how the team is organised.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- team_groups -------------------------------------------
CREATE TABLE IF NOT EXISTS team_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  color       text NOT NULL DEFAULT 'ocean',
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS team_groups_account_name_key
  ON team_groups (account_id, lower(btrim(name)));

DROP TRIGGER IF EXISTS set_updated_at ON team_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON team_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE team_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_groups_select ON team_groups;
CREATE POLICY team_groups_select ON team_groups FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS team_groups_insert ON team_groups;
CREATE POLICY team_groups_insert ON team_groups FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS team_groups_update ON team_groups;
CREATE POLICY team_groups_update ON team_groups FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS team_groups_delete ON team_groups;
CREATE POLICY team_groups_delete ON team_groups FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- team_group_members ------------------------------------
CREATE TABLE IF NOT EXISTS team_group_members (
  group_id    uuid NOT NULL REFERENCES team_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_group_members_user_idx
  ON team_group_members (user_id);

ALTER TABLE team_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_group_members_select ON team_group_members;
CREATE POLICY team_group_members_select ON team_group_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_groups g
    WHERE g.id = group_id AND is_account_member(g.account_id)
  ));

-- The member being added must belong to the same account as the
-- group; otherwise an admin could label an outsider's user id.
DROP POLICY IF EXISTS team_group_members_insert ON team_group_members;
CREATE POLICY team_group_members_insert ON team_group_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM team_groups g
    JOIN profiles p ON p.account_id = g.account_id
    WHERE g.id = group_id
      AND p.user_id = team_group_members.user_id
      AND is_account_member(g.account_id, 'admin')
  ));

DROP POLICY IF EXISTS team_group_members_delete ON team_group_members;
CREATE POLICY team_group_members_delete ON team_group_members FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM team_groups g
    WHERE g.id = group_id AND is_account_member(g.account_id, 'admin')
  ));

-- ---- team_meetings -----------------------------------------
CREATE TABLE IF NOT EXISTS team_meetings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  -- http(s) only: the page renders this as a link, so a
  -- `javascript:` URL must never get in, whatever the client sends.
  url         text NOT NULL CHECK (url ~* '^https?://[^[:space:]]+$' AND length(url) <= 2000),
  schedule    text NOT NULL DEFAULT '' CHECK (length(schedule) <= 120),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_meetings_account_idx
  ON team_meetings (account_id, created_at);

CREATE OR REPLACE FUNCTION public.stamp_team_meeting_author()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_author ON team_meetings;
CREATE TRIGGER stamp_author BEFORE INSERT OR UPDATE ON team_meetings
  FOR EACH ROW EXECUTE FUNCTION stamp_team_meeting_author();

DROP TRIGGER IF EXISTS set_updated_at ON team_meetings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON team_meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE team_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_meetings_select ON team_meetings;
CREATE POLICY team_meetings_select ON team_meetings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS team_meetings_insert ON team_meetings;
CREATE POLICY team_meetings_insert ON team_meetings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS team_meetings_update ON team_meetings;
CREATE POLICY team_meetings_update ON team_meetings FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS team_meetings_delete ON team_meetings;
CREATE POLICY team_meetings_delete ON team_meetings FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ---- realtime ----------------------------------------------
-- A link changed by one teammate shows up for everyone without a
-- reload.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_groups', 'team_group_members', 'team_meetings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- redeem_invitation: also treat team_groups and team_meetings as
-- account data (see 100_tracking_shipments.sql for why). This is the
-- 100 definition with those two tables added; keep it in sync if a
-- later upstream migration redefines redeem_invitation.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tracking_shipments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM team_groups WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM team_meetings WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
