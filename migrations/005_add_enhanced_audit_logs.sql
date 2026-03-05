-- Migration: Add Enhanced Audit Logs Table
-- Purpose: Comprehensive audit logging with structured data
-- Date: February 2026

-- Create enhanced audit logs table
CREATE TABLE IF NOT EXISTS audit_logs_enhanced (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL, -- AUTHENTICATION, AUTHORIZATION, DATA_ACCESS, etc.
  action VARCHAR(100) NOT NULL, -- LOGIN, LOGOUT, CREATE, UPDATE, DELETE, etc.
  level VARCHAR(20) NOT NULL, -- DEBUG, INFO, WARNING, ERROR, CRITICAL
  resource_type VARCHAR(50), -- SKU, SALE, USER, SHOP, etc.
  resource_id UUID, -- ID of the resource being acted upon
  details JSONB NOT NULL DEFAULT '{}', -- Structured event details
  ip_address INET, -- Client IP address
  user_agent TEXT, -- Client user agent
  success BOOLEAN DEFAULT TRUE, -- Whether the action succeeded
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_shop_id ON audit_logs_enhanced(shop_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_user_id ON audit_logs_enhanced(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_category ON audit_logs_enhanced(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_level ON audit_logs_enhanced(level);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_created_at ON audit_logs_enhanced(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_resource ON audit_logs_enhanced(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_success ON audit_logs_enhanced(success) WHERE success = FALSE;

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_enhanced_shop_category_date 
  ON audit_logs_enhanced(shop_id, category, created_at DESC);

-- Add Row-Level Security (RLS)
ALTER TABLE audit_logs_enhanced ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see audit logs for their shop
DROP POLICY IF EXISTS audit_logs_enhanced_tenant_isolation ON audit_logs_enhanced;
CREATE POLICY audit_logs_enhanced_tenant_isolation ON audit_logs_enhanced
  FOR ALL
  USING (shop_id = current_setting('app.current_shop_id', TRUE)::UUID);

-- Grant permissions
-- GRANT SELECT, INSERT ON audit_logs_enhanced TO authenticated_user;

-- Add comments
COMMENT ON TABLE audit_logs_enhanced IS 'Comprehensive audit logging for all system events';
COMMENT ON COLUMN audit_logs_enhanced.category IS 'Event category: AUTHENTICATION, SECURITY, DATA_MODIFICATION, etc.';
COMMENT ON COLUMN audit_logs_enhanced.action IS 'Specific action performed';
COMMENT ON COLUMN audit_logs_enhanced.level IS 'Log level: DEBUG, INFO, WARNING, ERROR, CRITICAL';
COMMENT ON COLUMN audit_logs_enhanced.details IS 'JSON object with event-specific details';
COMMENT ON COLUMN audit_logs_enhanced.success IS 'Whether the action completed successfully';

-- Create views for common audit queries

-- View: Failed authentication attempts
CREATE OR REPLACE VIEW failed_auth_attempts AS
SELECT 
  al.*,
  u.full_name,
  u.phone
FROM audit_logs_enhanced al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.category = 'AUTHENTICATION'
  AND al.success = FALSE
ORDER BY al.created_at DESC;

-- GRANT SELECT ON failed_auth_attempts TO authenticated_user;

-- View: Security events
CREATE OR REPLACE VIEW security_events AS
SELECT 
  al.*,
  u.full_name,
  u.phone,
  s.shop_name
FROM audit_logs_enhanced al
LEFT JOIN users u ON al.user_id = u.id
LEFT JOIN shops s ON al.shop_id = s.id
WHERE al.category = 'SECURITY'
ORDER BY al.created_at DESC;

-- GRANT SELECT ON security_events TO authenticated_user;

-- View: Critical events (last 24 hours)
CREATE OR REPLACE VIEW recent_critical_events AS
SELECT 
  al.*,
  u.full_name,
  u.phone,
  s.shop_name
FROM audit_logs_enhanced al
LEFT JOIN users u ON al.user_id = u.id
LEFT JOIN shops s ON al.shop_id = s.id
WHERE al.level = 'CRITICAL'
  AND al.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY al.created_at DESC;

-- GRANT SELECT ON recent_critical_events TO authenticated_user;

-- View: Data modification audit trail
CREATE OR REPLACE VIEW data_modification_trail AS
SELECT 
  al.*,
  u.full_name as modified_by,
  u.phone as modifier_phone
FROM audit_logs_enhanced al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.category = 'DATA_MODIFICATION'
ORDER BY al.created_at DESC;

-- GRANT SELECT ON data_modification_trail TO authenticated_user;

-- Create function to get audit summary
CREATE OR REPLACE FUNCTION get_audit_summary(
  p_shop_id UUID,
  p_start_date TIMESTAMP DEFAULT NOW() - INTERVAL '7 days',
  p_end_date TIMESTAMP DEFAULT NOW()
)
RETURNS TABLE (
  category VARCHAR(50),
  total_events BIGINT,
  failed_events BIGINT,
  critical_events BIGINT,
  unique_users BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    al.category,
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE al.success = FALSE) as failed_events,
    COUNT(*) FILTER (WHERE al.level = 'CRITICAL') as critical_events,
    COUNT(DISTINCT al.user_id) as unique_users
  FROM audit_logs_enhanced al
  WHERE al.shop_id = p_shop_id
    AND al.created_at >= p_start_date
    AND al.created_at <= p_end_date
  GROUP BY al.category
  ORDER BY total_events DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- GRANT EXECUTE ON FUNCTION get_audit_summary TO authenticated_user;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 005: Enhanced audit logs table created successfully';
END $$;
