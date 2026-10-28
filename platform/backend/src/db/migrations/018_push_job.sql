-- The agent job currently responsible for a push: only its result may close the push.
ALTER TABLE pushes ADD COLUMN IF NOT EXISTS agent_job_id BIGINT;
