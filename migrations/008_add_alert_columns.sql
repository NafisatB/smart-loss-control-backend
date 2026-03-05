-- ============================================
-- Migration 008: Add missing columns to alerts table
-- Purpose: Add severity, type, metadata, and resolved_at columns
-- ============================================

-- Severity and type
ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS severity VARCHAR(20),
ADD COLUMN IF NOT EXISTS type VARCHAR(50);

COMMENT ON COLUMN alerts.severity IS 'Severity level of the alert (e.g., LOW, MEDIUM, HIGH, CRITICAL)';
COMMENT ON COLUMN alerts.type IS 'Type/category of alert (e.g., STOCK_ALERT, AUDIT_ALERT)';

-- Metadata column
ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN alerts.metadata IS 'Optional JSON object for additional alert details';

-- Resolved timestamp
ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;

DO $$
BEGIN
  RAISE NOTICE 'Migration 008: Alerts columns added successfully';
END $$;