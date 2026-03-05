-- ============================================
-- Migration 009: Add soft delete support for SKUs
-- ============================================

ALTER TABLE skus
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;

ALTER TABLE skus
ADD COLUMN IF NOT EXISTS discontinued_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_skus_is_active ON skus(is_active);

COMMENT ON COLUMN skus.is_active IS 'Whether this SKU is currently active (false = discontinued/deleted)';
COMMENT ON COLUMN skus.discontinued_at IS 'When this SKU was discontinued/soft-deleted';

DO $$
BEGIN
  RAISE NOTICE 'Migration 006: SKUs soft delete columns added successfully';
END $$;