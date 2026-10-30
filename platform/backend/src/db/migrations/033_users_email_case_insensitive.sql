-- Buyer isolation compares LOWER(group_name) = LOWER(email), so two accounts whose emails differ only in case
-- would share FB profiles, campaigns and 2FA codes. Emails are stored lower-case and unique regardless of case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1) THEN
    RAISE WARNING 'users: emails differing only in case exist; merge them by hand, then create users_email_lower_unique on LOWER(email)';
  ELSE
    UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email);
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));
  END IF;
END $$;
