-- ============================================
-- Migration 008: Add missing columns to alerts table
-- Purpose: Add severity and type columns for alerts
-- ============================================

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS severity VARCHAR(20),
ADD COLUMN IF NOT EXISTS type VARCHAR(50);

COMMENT ON COLUMN alerts.severity IS 'Severity level of the alert (e.g., LOW, MEDIUM, HIGH, CRITICAL)';
COMMENT ON COLUMN alerts.type IS 'Type/category of alert (e.g., STOCK_ALERT, AUDIT_ALERT)';