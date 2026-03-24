-- ============================================
-- Migration 008: Add missing columns to alerts and users tables
-- Purpose: Add severity, type, metadata, resolved_at, last_login_device, last_logout_at, is_online
-- ============================================

-- ===============================
-- Alerts table updates
-- ===============================

-- Add severity, type, metadata, and resolved_at columns
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS severity VARCHAR(20),
  ADD COLUMN IF NOT EXISTS type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

COMMENT ON COLUMN alerts.severity IS 'Severity level of the alert (e.g., LOW, MEDIUM, HIGH, CRITICAL)';
COMMENT ON COLUMN alerts.type IS 'Type/category of alert (e.g., STOCK_ALERT, AUDIT_ALERT)';
COMMENT ON COLUMN alerts.metadata IS 'Optional JSON object for additional alert details';
COMMENT ON COLUMN alerts.resolved_at IS 'Timestamp when the alert was resolved';

-- ===============================
-- Users table updates
-- ===============================

-- Add device and session tracking columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_device TEXT,
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;

COMMENT ON COLUMN users.last_login_device IS 'Device info string captured at last login';
COMMENT ON COLUMN users.is_online IS 'Indicates whether user is currently online';
COMMENT ON COLUMN users.last_logout_at IS 'Timestamp when the user last logged out';

-- ===============================
-- Migration completion notice
-- ===============================
DO $$
BEGIN
  RAISE NOTICE 'Migration 008: Alerts and users columns added successfully';
END $$;
