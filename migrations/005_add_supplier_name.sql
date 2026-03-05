-- ============================================
-- Migration 005: Add supplier_name to restocks table (Safe & Idempotent)
-- ============================================

-- Add supplier_name column if it does not exist
ALTER TABLE restocks 
ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(150);

-- Add index if it does not exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'idx_restocks_supplier_name'
    ) THEN
        CREATE INDEX idx_restocks_supplier_name ON restocks(supplier_name);
    END IF;
END $$;

-- Add comment (will override if exists)
COMMENT ON COLUMN restocks.supplier_name IS 'Name of the supplier who delivered the stock (e.g., "Lagos Distributors Ltd")';