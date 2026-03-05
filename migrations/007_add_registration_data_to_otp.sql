-- ============================================
-- Migration 007: Add registration data to otp_verifications
-- Purpose: Temporarily store registration info until OTP verified
-- ============================================

ALTER TABLE otp_verifications
ADD COLUMN IF NOT EXISTS full_name VARCHAR(150),
ADD COLUMN IF NOT EXISTS shop_name VARCHAR(150);

COMMENT ON COLUMN otp_verifications.full_name IS 'Temporary storage of owner full name during registration (before OTP verification)';
COMMENT ON COLUMN otp_verifications.shop_name IS 'Temporary storage of shop name during registration (before OTP verification)';

DO $$
BEGIN
  RAISE NOTICE 'Migration 007: OTP verification columns added successfully';
END $$;