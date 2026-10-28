-- ============================================================
-- 104_content_calendar.sql — content calendar on the Equipo page
--
-- Fork migration (Unno). Requires 101, 102 and 103. Replaces the
-- marketing team's monthly Excel ("REGISTRO EQUIPO MARKETING"): one
-- row per planned post with the sheet's columns, plus dated events
-- (meetings with a day and time, and the team's own key dates).
-- Peruvian public holidays and retail dates are computed in the app
-- (src/lib/calendar/peru-dates.ts), not stored.
--
-- Design notes
--   - `category`, `format` and `status` are closed lists, enforced by
--     CHECK here and mirrored in src/lib/calendar/content-meta.ts.
--     Adding a value is a migration plus a code change.
--
--   - Brands are a managed list (`content_brands`), picked from a
--     select so nobody types "Ganymedez". Admins add them. Unno,
--     Ganymedes and Unno Comics are seeded only into accounts that
--     already have more than one member: a seeded row in someone's
--     solo account would count as data and make redeem_invitation
--     refuse to merge it. Deleting a brand leaves its posts unbranded
--     (ON DELETE SET NULL) rather than deleting them.
--
--   - Assignees are CRM users (`content_post_assignees`), never names
--     typed in, so "what do I have today" can be answered per person.
--     No `account_id` there: the post pins it, like team_group_members.
--
--   - Days are plain DATEs and times plain TIMEs, in Lima: a post or a
--     10:00 meeting is planned on the team's wall clock, so no time
--     zone conversion can move it.
--
--   - `created_by` / `updated_by` are stamped by trigger from
--     auth.uid(), ready for the activity log in a later part.
--
-- RLS
--   The team role (designers) moves posts along and books meetings,
--   so reading, creating and editing posts, assignees and events is
--   open from 'team' up. Deleting a post is admin+; an event can be
--   deleted by whoever created it or an admin. Brands: admin+ writes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- author stamping (posts and events) --------------------
CREATE OR REPLACE FUNCTION public.stamp_row_author()
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

-- ---- brands ------------------------------------------------
CREATE TABLE IF NOT EXISTS content_brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS content_brands_account_name_key
  ON content_brands (account_id, lower(btrim(name)));

ALTER TABLE content_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_brands_select ON content_brands;
CREATE POLICY content_brands_select ON content_brands FOR SELECT
  USING (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS content_brands_insert ON content_brands;
CREATE POLICY content_brands_insert ON content_brands FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS content_brands_update ON content_brands;
CREATE POLICY content_brands_update ON content_brands FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS content_brands_delete ON content_brands;
CREATE POLICY content_brands_delete ON content_brands FOR DELETE
  USING (is_account_member(account_id, 'admin'));

INSERT INTO content_brands (account_id, name)
SELECT a.id, b.name
FROM accounts a
CROSS JOIN (VALUES ('Unno'), ('Ganymedes'), ('Unno Comics')) AS b(name)
WHERE (SELECT count(*) FROM profiles p WHERE p.account_id = a.id) > 1
ON CONFLICT DO NOTHING;

-- ---- posts -------------------------------------------------
CREATE TABLE IF NOT EXISTS content_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  publish_date  date NOT NULL,
  category      text NOT NULL DEFAULT 'product',
  brand_id      uuid REFERENCES content_brands(id) ON DELETE SET NULL,
  format        text NOT NULL DEFAULT 'carousel',
  product       text NOT NULL DEFAULT '' CHECK (length(product) <= 120),
  idea          text NOT NULL DEFAULT '' CHECK (length(idea) <= 500),
  caption       text NOT NULL DEFAULT '' CHECK (length(caption) <= 4000),
  status        text NOT NULL DEFAULT 'pending',
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_category_check') THEN
    ALTER TABLE content_posts ADD CONSTRAINT content_posts_category_check
      CHECK (category IN ('community', 'informative', 'promotions', 'branding', 'reviews', 'humor', 'product'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_format_check') THEN
    ALTER TABLE content_posts ADD CONSTRAINT content_posts_format_check
      CHECK (format IN ('carousel', 'reel', 'post', 'story', 'video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_status_check') THEN
    ALTER TABLE content_posts ADD CONSTRAINT content_posts_status_check
      CHECK (status IN ('pending', 'in_progress', 'review', 'published'));
  END IF;
END $$;

-- The calendar reads one month (plus the edge weeks) at a time.
CREATE INDEX IF NOT EXISTS content_posts_account_date_idx
  ON content_posts (account_id, publish_date);

DROP TRIGGER IF EXISTS stamp_author ON content_posts;
CREATE TRIGGER stamp_author BEFORE INSERT OR UPDATE ON content_posts
  FOR EACH ROW EXECUTE FUNCTION stamp_row_author();

DROP TRIGGER IF EXISTS set_updated_at ON content_posts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE content_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_posts_select ON content_posts;
CREATE POLICY content_posts_select ON content_posts FOR SELECT
  USING (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS content_posts_insert ON content_posts;
CREATE POLICY content_posts_insert ON content_posts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS content_posts_update ON content_posts;
CREATE POLICY content_posts_update ON content_posts FOR UPDATE
  USING (is_account_member(account_id, 'team'))
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS content_posts_delete ON content_posts;
CREATE POLICY content_posts_delete ON content_posts FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- assignees ---------------------------------------------
CREATE TABLE IF NOT EXISTS content_post_assignees (
  post_id     uuid NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS content_post_assignees_user_idx
  ON content_post_assignees (user_id);

ALTER TABLE content_post_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_post_assignees_select ON content_post_assignees;
CREATE POLICY content_post_assignees_select ON content_post_assignees FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM content_posts c
    WHERE c.id = post_id AND is_account_member(c.account_id, 'team')
  ));

-- The assignee must be a member of the post's account.
DROP POLICY IF EXISTS content_post_assignees_insert ON content_post_assignees;
CREATE POLICY content_post_assignees_insert ON content_post_assignees FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM content_posts c
    JOIN profiles p ON p.account_id = c.account_id
    WHERE c.id = post_id
      AND p.user_id = content_post_assignees.user_id
      AND is_account_member(c.account_id, 'team')
  ));

DROP POLICY IF EXISTS content_post_assignees_delete ON content_post_assignees;
CREATE POLICY content_post_assignees_delete ON content_post_assignees FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM content_posts c
    WHERE c.id = post_id AND is_account_member(c.account_id, 'team')
  ));

-- ---- dated events (meetings, the team's own key dates) -----
CREATE TABLE IF NOT EXISTS calendar_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'meeting',
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  event_date  date NOT NULL,
  start_time  time,
  end_time    time,
  -- Same rule as team_meetings.url: rendered as a link, http(s) only.
  url         text CHECK (url IS NULL OR (url ~* '^https?://[^[:space:]]+$' AND length(url) <= 2000)),
  notes       text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_kind_check') THEN
    ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_kind_check
      CHECK (kind IN ('meeting', 'key_date'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS calendar_events_account_date_idx
  ON calendar_events (account_id, event_date);

DROP TRIGGER IF EXISTS stamp_author ON calendar_events;
CREATE TRIGGER stamp_author BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION stamp_row_author();

DROP TRIGGER IF EXISTS set_updated_at ON calendar_events;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select ON calendar_events;
CREATE POLICY calendar_events_select ON calendar_events FOR SELECT
  USING (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS calendar_events_insert ON calendar_events;
CREATE POLICY calendar_events_insert ON calendar_events FOR INSERT
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS calendar_events_update ON calendar_events;
CREATE POLICY calendar_events_update ON calendar_events FOR UPDATE
  USING (is_account_member(account_id, 'team'))
  WITH CHECK (is_account_member(account_id, 'team'));

DROP POLICY IF EXISTS calendar_events_delete ON calendar_events;
CREATE POLICY calendar_events_delete ON calendar_events FOR DELETE
  USING (
    is_account_member(account_id, 'admin')
    OR (created_by = auth.uid() AND is_account_member(account_id, 'team'))
  );

-- ---- realtime ----------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_brands', 'content_posts', 'content_post_assignees', 'calendar_events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- redeem_invitation: also treat content_brands, content_posts and
-- calendar_events as account data (see 100_tracking_shipments.sql for
-- why). This is the 101 definition with those tables added; keep it
-- in sync if a later upstream migration redefines redeem_invitation.
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
