-- Migration: Add metadata column to alerts table
ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN alerts.metadata IS 'Optional JSON object for additional alert details';