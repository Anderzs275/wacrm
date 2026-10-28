-- ============================================================
-- 108_collections_collaborations.sql — Colecciones and Colaboraciones
--
-- Fork migration (Unno). Requires 104 (content_brands,
-- stamp_row_author). Two more tabs on the Equipo page, so the team
-- (and Braulio, who reviews it) stops tracking launches and influencer
-- deals in separate spreadsheets.
--
-- Design notes
--   - `collections`: one row per collection launch, moved across a
--     closed list of stages (CHECK here, mirrored in
--     src/lib/team/work-meta.ts) on a board. `launch_date` also shows
--     on the content calendar. `owner_id` is the one person
--     responsible; the work itself is split into `collection_tasks`.
--
--   - `collection_tasks`: a checklist per collection (title, done,
--     due date, assignee). No `account_id`: the collection pins it,
--     like content_post_assignees. `position` keeps the order the
--     team wrote them in.
--
--   - `collaborations`: influencer / brand collabs on a board by
--     status. `amount` is in the account's currency (PEN), NULL for
--     a pure product exchange. `url` is rendered as a link, so http(s)
--     only, like calendar_events.url.
--
-- RLS
--   Same as the content calendar: 'team' and up read, create and edit
--   (the designers run these too); deleting a collection or a collab
--   is admin+. Tasks follow their collection, any 'team'+ may add,
--   tick or remove them.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- collections -------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  brand_id     uuid REFERENCES content_brands(id) ON DELETE SET NULL,
  launch_date  date,
  stage        text NOT NULL DEFAULT 'idea',
  owner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes        text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_stage_check') THEN
    ALTER TABLE collections ADD CONSTRAINT collections_stage_check
      CHECK (stage IN ('idea', 'design', 'samples', 'production', 'photoshoot', 'launch_prep', 'launched'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS collections_account_idx
  ON collections (account_id, launch_date);

DROP TRIGGER IF EXISTS stamp_author ON collections;
CREATE TRIGGER stamp_author BEFORE INSERT OR UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION stamp_row_author();

DROP TRIGGER IF EXISTS set_updated_at ON collections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collections_select ON collections;
CREATE POLICY collections_select ON collections FOR SELECT
  USING (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS collections_insert ON collections;
CREATE POLICY collections_insert ON collections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS collections_update ON collections;
CREATE POLICY collections_update ON collections FOR UPDATE
  USING (is_account_member(account_id, 'team'))
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS collections_delete ON collections;
CREATE POLICY collections_delete ON collections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- collection_tasks --------------------------------------
CREATE TABLE IF NOT EXISTS collection_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  done           boolean NOT NULL DEFAULT false,
  due_date       date,
  assignee_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_tasks_collection_idx
  ON collection_tasks (collection_id, position);

ALTER TABLE collection_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_tasks_select ON collection_tasks;
CREATE POLICY collection_tasks_select ON collection_tasks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = collection_id AND is_account_member(c.account_id, 'team')
  ));

DROP POLICY IF EXISTS collection_tasks_insert ON collection_tasks;
CREATE POLICY collection_tasks_insert ON collection_tasks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = collection_id AND is_account_member(c.account_id, 'team')
  ));

DROP POLICY IF EXISTS collection_tasks_update ON collection_tasks;
CREATE POLICY collection_tasks_update ON collection_tasks FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = collection_id AND is_account_member(c.account_id, 'team')
  ));

DROP POLICY IF EXISTS collection_tasks_delete ON collection_tasks;
CREATE POLICY collection_tasks_delete ON collection_tasks FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM collections c
    WHERE c.id = collection_id AND is_account_member(c.account_id, 'team')
  ));

-- ---- collaborations ----------------------------------------
CREATE TABLE IF NOT EXISTS collaborations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  handle        text NOT NULL DEFAULT '' CHECK (length(handle) <= 120),
  platform      text NOT NULL DEFAULT 'instagram',
  kind          text NOT NULL DEFAULT 'exchange',
  status        text NOT NULL DEFAULT 'prospect',
  amount        numeric(12, 2) CHECK (amount IS NULL OR amount >= 0),
  products      text NOT NULL DEFAULT '' CHECK (length(products) <= 500),
  publish_date  date,
  url           text CHECK (url IS NULL OR (url ~* '^https?://[^[:space:]]+$' AND length(url) <= 2000)),
  owner_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes         text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaborations_platform_check') THEN
    ALTER TABLE collaborations ADD CONSTRAINT collaborations_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaborations_kind_check') THEN
    ALTER TABLE collaborations ADD CONSTRAINT collaborations_kind_check
      CHECK (kind IN ('exchange', 'paid', 'affiliate', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaborations_status_check') THEN
    ALTER TABLE collaborations ADD CONSTRAINT collaborations_status_check
      CHECK (status IN ('prospect', 'contacted', 'negotiating', 'agreed', 'in_progress', 'published', 'declined'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS collaborations_account_idx
  ON collaborations (account_id, status);

DROP TRIGGER IF EXISTS stamp_author ON collaborations;
CREATE TRIGGER stamp_author BEFORE INSERT OR UPDATE ON collaborations
  FOR EACH ROW EXECUTE FUNCTION stamp_row_author();

DROP TRIGGER IF EXISTS set_updated_at ON collaborations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON collaborations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE collaborations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collaborations_select ON collaborations;
CREATE POLICY collaborations_select ON collaborations FOR SELECT
  USING (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS collaborations_insert ON collaborations;
CREATE POLICY collaborations_insert ON collaborations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS collaborations_update ON collaborations;
CREATE POLICY collaborations_update ON collaborations FOR UPDATE
  USING (is_account_member(account_id, 'team'))
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS collaborations_delete ON collaborations;
CREATE POLICY collaborations_delete ON collaborations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- realtime ----------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collections', 'collection_tasks', 'collaborations'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- redeem_invitation: also treat collections and collaborations as
-- account data (see 100_tracking_shipments.sql for why). This is the
-- 104 definition with those two tables added; keep it in sync if a
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
    UNION ALL SELECT 1 FROM content_brands WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM content_posts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM calendar_events WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM collections WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM collaborations WHERE account_id = v_old_account_id
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
