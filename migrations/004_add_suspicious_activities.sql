-- Migration: Add Suspicious Activities Table
-- Purpose: Track detected anomaly patterns for audit and analysis
-- Date: February 2026

-- Create suspicious_activities table
CREATE TABLE IF NOT EXISTS suspicious_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  pattern VARCHAR(100) NOT NULL, -- END_OF_SHIFT_SPIKE, UNUSUAL_TIME_SALES, etc.
  severity VARCHAR(20) NOT NULL, -- HIGH, CRITICAL, MEDIUM
  details JSONB NOT NULL, -- Full detection details
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_shop_id ON suspicious_activities(shop_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_sku_id ON suspicious_activities(sku_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_pattern ON suspicious_activities(pattern);
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_severity ON suspicious_activities(severity);
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_detected_at ON suspicious_activities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_suspicious_activities_reviewed ON suspicious_activities(reviewed) WHERE reviewed = FALSE;

-- Add Row-Level Security (RLS)
ALTER TABLE suspicious_activities ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see suspicious activities for their shop
DROP POLICY IF EXISTS suspicious_activities_tenant_isolation ON suspicious_activities;
CREATE POLICY suspicious_activities_tenant_isolation ON suspicious_activities
  FOR ALL
  USING (shop_id = current_setting('app.current_shop_id', TRUE)::UUID);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON suspicious_activities TO authenticated_user;

-- Add comments
COMMENT ON TABLE suspicious_activities IS 'Tracks detected anomaly patterns for theft detection';
COMMENT ON COLUMN suspicious_activities.pattern IS 'Type of suspicious pattern detected';
COMMENT ON COLUMN suspicious_activities.severity IS 'Severity level: HIGH, CRITICAL, MEDIUM';
COMMENT ON COLUMN suspicious_activities.details IS 'JSON object with detection details and metrics';
COMMENT ON COLUMN suspicious_activities.reviewed IS 'Whether owner has reviewed this activity';

-- Create view for unreviewed suspicious activities
CREATE OR REPLACE VIEW unreviewed_suspicious_activities AS
SELECT 
  sa.*,
  s.brand,
  s.size,
  sh.shop_name
FROM suspicious_activities sa
LEFT JOIN skus s ON sa.sku_id = s.id
LEFT JOIN shops sh ON sa.shop_id = sh.id
WHERE sa.reviewed = FALSE
ORDER BY sa.detected_at DESC;

GRANT SELECT ON unreviewed_suspicious_activities TO authenticated_user;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 004: Suspicious activities table created successfully';
END $$;
