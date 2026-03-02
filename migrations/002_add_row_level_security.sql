-- ============================================
-- Smart Loss Control - Row-Level Security
-- Migration: 002_add_row_level_security.sql
-- Purpose: Enforce tenant isolation at database level
-- ============================================

-- ============================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE restocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE decants ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_velocity_metrics ENABLE ROW LEVEL SECURITY;

-- ============================================
-- CREATE TENANT ISOLATION POLICIES
-- ============================================

-- Inventory: Users can only see their shop's inventory
DROP POLICY IF EXISTS tenant_isolation_inventory ON inventory;
CREATE POLICY tenant_isolation_inventory ON inventory
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- Transactions: Users can only see their shop's transactions
DROP POLICY IF EXISTS tenant_isolation_transactions ON transactions;
CREATE POLICY tenant_isolation_transactions ON transactions
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- Audit Logs: Users can only see their shop's audit logs
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- Alerts: Users can only see their shop's alerts
DROP POLICY IF EXISTS tenant_isolation_alerts ON alerts;
CREATE POLICY tenant_isolation_alerts ON alerts
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- Restocks: Users can only see their shop's restocks
DROP POLICY IF EXISTS tenant_isolation_restocks ON restocks;
CREATE POLICY tenant_isolation_restocks ON restocks
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- Decants: Users can only see their shop's decants
DROP POLICY IF EXISTS tenant_isolation_decants ON decants;
CREATE POLICY tenant_isolation_decants ON decants
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- Sales Velocity Metrics: Users can only see their shop's metrics
DROP POLICY IF EXISTS tenant_isolation_velocity ON sales_velocity_metrics;
CREATE POLICY tenant_isolation_velocity ON sales_velocity_metrics
    FOR ALL
    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);

-- ============================================
-- HELPER FUNCTION
-- ============================================

-- Function to set current shop context
CREATE OR REPLACE FUNCTION set_current_shop(shop_uuid UUID) RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_shop_id', shop_uuid::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION set_current_shop IS 'Sets the current shop context for Row-Level Security policies';

-- ============================================
-- BYPASS POLICY FOR SUPERUSER (ADMIN ONLY)
-- ============================================

-- Allow superuser to bypass RLS for maintenance/debugging
-- This should only be used by database administrators
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE restocks FORCE ROW LEVEL SECURITY;
ALTER TABLE decants FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_velocity_metrics FORCE ROW LEVEL SECURITY;

-- ============================================
-- VERIFICATION QUERIES (FOR TESTING)
-- ============================================

-- Test RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Test policies exist
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
