-- Deleting a user used to unset created_by in three tables and then fail on the others (bundle_presets,
-- creative_presets, tiktok_accounts…), leaving the user in place but no longer the author of their products.
-- Every nullable single-column reference to users now unsets itself, so the DELETE is one atomic step.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, a.attname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND array_length(c.conkey, 1) = 1
       AND c.confdeltype IN ('a', 'r') AND NOT a.attnotnull
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL',
      r.tbl, r.conname, r.conname, r.attname);
  END LOOP;
END $$;
