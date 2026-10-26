-- ============================================================
-- 100_tracking_shipments.sql — Courier tracking notifications
--
-- Fork migration (Unno). Originally written as 043 before upstream
-- shipped its own 043; renumbered into the fork's 100+ range.
--
-- Backs the "Tracking" section: an operator uploads a courier label
-- PDF (Olva Courier, two labels per page), reviews the parsed rows,
-- and decides per row whether the customer is notified.
--
-- Design notes
--   - Account-scoped, like `webhook_endpoints` and `api_keys`.
--     `created_by` records who imported the batch; ON DELETE SET NULL
--     so removing a teammate never drops shipment history.
--
--   - UNIQUE (account_id, tracking_code) is the load-bearing
--     constraint, not a tidiness one. Importing is an UPSERT that
--     leaves `status` alone, so re-uploading the same PDF — which
--     operators do, because a batch is printed once but reviewed over
--     several sittings — cannot resurrect a row that was already sent
--     or deliberately discarded. Without it, a second upload is a
--     duplicate-message generator.
--
--   - Discarding is `status = 'discarded'`, NEVER a DELETE. The
--     operator's requirement is "discard it and it is never sent",
--     which only holds if the tombstone outlives the upload that
--     created it; deleting the row would let the very next import
--     re-create it as pending. The DELETE policy below exists for
--     admin housekeeping and is not used by the UI.
--
--   - `phone` holds the digits-only E.164 form (`51XXXXXXXXX`) that
--     the Meta send path wants, and is NULL when the label's number
--     could not be validated as a Peruvian mobile. `raw_phone` keeps
--     what the label actually said so the UI can show the operator
--     why a row is unsendable. `phone_problem` is free text validated
--     in the app layer (src/lib/tracking/phone-pe.ts) — a new reason
--     is a code change, not a migration, mirroring how scopes and
--     webhook events are handled.
--
--   - One row is one parcel, never one customer. A customer who
--     ordered twice has two tracking codes and gets two messages;
--     collapsing them would silently drop a tracking number. The
--     `phone` index below is what lets the UI flag those rows as
--     related without merging them.
--
-- RLS
--   Sending-class, not settings-class: viewer+ may read the list,
--   agent+ may import, send and discard. This mirrors the app's
--   `canSendMessages` boundary — a viewer must never be able to
--   trigger a customer-facing message. DELETE is admin+.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS tracking_shipments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Parsed from the label.
  tracking_code       text NOT NULL,             -- "2618673-26"
  recipient_name      text NOT NULL,             -- "JORGE SANTILLAN ROJAS"
  greeting_name       text NOT NULL DEFAULT '',  -- "Jorge" (template var 1)
  raw_phone           text NOT NULL DEFAULT '',  -- as printed, e.g. "927 265 0"
  phone               text,                      -- "51930515808", NULL when invalid
  phone_problem       text,                      -- why `phone` is NULL
  sequence            integer,                   -- 1 from "(1/71)"
  registro            text,                      -- Olva batch id

  -- Review + delivery state.
  status              text NOT NULL DEFAULT 'pending',
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  whatsapp_message_id text,                      -- Meta wamid, for status webhooks
  error_message       text,
  sent_at             timestamptz,
  discarded_at        timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; guard by name so a
-- replay is a no-op rather than a duplicate-object error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracking_shipments_status_check'
  ) THEN
    ALTER TABLE tracking_shipments
      ADD CONSTRAINT tracking_shipments_status_check
      CHECK (status IN ('pending', 'sent', 'failed', 'discarded'));
  END IF;
END $$;

-- The import UPSERT targets this, and it is what stops a re-uploaded
-- PDF from re-sending or un-discarding anything.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_shipments_account_code_key
  ON tracking_shipments (account_id, tracking_code);

-- The list view: newest batch first, filtered by account and status.
CREATE INDEX IF NOT EXISTS tracking_shipments_account_status_idx
  ON tracking_shipments (account_id, status, created_at DESC);

-- Lets the UI flag "this customer has another parcel in this batch"
-- without a second round trip.
CREATE INDEX IF NOT EXISTS tracking_shipments_account_phone_idx
  ON tracking_shipments (account_id, phone)
  WHERE phone IS NOT NULL;

-- Delivery/read webhooks arrive keyed by Meta's message id.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_shipments_wamid_key
  ON tracking_shipments (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON tracking_shipments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tracking_shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE tracking_shipments ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can review the list.
DROP POLICY IF EXISTS tracking_shipments_select ON tracking_shipments;
CREATE POLICY tracking_shipments_select ON tracking_shipments FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE: agent+ — importing a batch, sending, discarding.
-- A viewer is deliberately excluded: every UPDATE here can end in a
-- message leaving for a real customer.
DROP POLICY IF EXISTS tracking_shipments_insert ON tracking_shipments;
CREATE POLICY tracking_shipments_insert ON tracking_shipments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tracking_shipments_update ON tracking_shipments;
CREATE POLICY tracking_shipments_update ON tracking_shipments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

-- DELETE: admin+ housekeeping only. The UI discards (a status
-- change); it never deletes, because a deleted row is re-created as
-- pending by the next import of the same PDF.
DROP POLICY IF EXISTS tracking_shipments_delete ON tracking_shipments;
CREATE POLICY tracking_shipments_delete ON tracking_shipments FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ------------------------------------------------------------
-- redeem_invitation: also treat tracking_shipments as account data.
--
-- Accepting an invitation deletes the invitee's old (solo) account,
-- which cascades to every account-scoped table. The function refuses
-- when that account holds data, so a new account-scoped table must be
-- added to its check or its rows are silently destroyed. This is the
-- 047 definition with tracking_shipments added; keep it in sync if a
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
