-- ============================================================
-- 107_content_posts_brand_fix.sql — bring content_posts to the final
-- 104 shape where an early draft of 104 was applied
--
-- Fork migration (Unno). Requires 104.
--
-- The first draft of 104 stored the brand as free text
-- (`content_posts.brand`). 104 was then rewritten to a managed list
-- (`content_brands` + `content_posts.brand_id`), but a database that
-- had already run the draft kept the old table, because
-- `CREATE TABLE IF NOT EXISTS` skips an existing one.
--
-- This converts such a table: every brand typed in the draft becomes
-- a row in `content_brands` (per account, de-duplicated
-- case-insensitively), posts are linked to it through `brand_id`, and
-- the text column is dropped. On a database that ran the final 104 it
-- changes nothing.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES content_brands(id) ON DELETE SET NULL;

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 4000);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_posts' AND column_name = 'brand'
  ) THEN
    EXECUTE $sql$
      INSERT INTO content_brands (account_id, name)
      SELECT DISTINCT ON (account_id, lower(btrim(brand))) account_id, btrim(brand)
      FROM content_posts
      WHERE btrim(brand) <> ''
      ORDER BY account_id, lower(btrim(brand)), created_at
      ON CONFLICT DO NOTHING
    $sql$;

    EXECUTE $sql$
      UPDATE content_posts p
      SET brand_id = b.id
      FROM content_brands b
      WHERE p.brand_id IS NULL
        AND b.account_id = p.account_id
        AND lower(btrim(b.name)) = lower(btrim(p.brand))
    $sql$;

    ALTER TABLE content_posts DROP COLUMN brand;
  END IF;
END $$;

-- PostgREST caches the schema; make it see the new column now.
NOTIFY pgrst, 'reload schema';
