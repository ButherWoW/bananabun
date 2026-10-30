-- Rage and dead clicks name the element (tag, id or first class, button caption) so the report can point at it.
-- Never a field value: the tracker reads no input contents.
ALTER TABLE lp_events ADD COLUMN IF NOT EXISTS el VARCHAR(80);
CREATE INDEX IF NOT EXISTS idx_lp_events_template ON lp_events(template_id, at);
