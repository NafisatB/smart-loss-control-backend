-- ============================================
-- Migration 004: Africa Expansion
-- Purpose: Expand from Nigeria-only to Pan-African
-- Changes: USD currency, multi-country support
-- Date: February 2026
-- ============================================

-- ============================================
-- 1. UPDATE SHOPS TABLE FOR AFRICA-WIDE SUPPORT
-- ============================================

-- Change default currency from NGN to USD
ALTER TABLE shops 
    ALTER COLUMN currency_code SET DEFAULT 'USD';

-- Add country code for multi-country support
ALTER TABLE shops 
    ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);

-- Add city/location for better regional support
ALTER TABLE shops 
    ADD COLUMN IF NOT EXISTS city VARCHAR(100);

-- Update timezone to be more flexible (keep Africa/Lagos as default for existing)
ALTER TABLE shops 
    ALTER COLUMN timezone SET DEFAULT 'Africa/Lagos';

COMMENT ON COLUMN shops.currency_code IS 'ISO 4217 currency code - USD for pan-African operations';
COMMENT ON COLUMN shops.country_code IS 'ISO 3166-1 alpha-2 country code (NG, KE, GH, ZA, etc.)';
COMMENT ON COLUMN shops.city IS 'City/location for regional analytics and support';

-- ============================================
-- 2. UPDATE AUDIT_LOGS - RENAME NAIRA COLUMN TO USD
-- ============================================

-- Rename loss_value_naira to loss_value_usd
ALTER TABLE audit_logs 
    RENAME COLUMN loss_value_naira TO loss_value_usd;

-- Update column comment
COMMENT ON COLUMN audit_logs.loss_value_usd IS 'Estimated loss value in USD for pan-African operations';

-- ============================================
-- 3. UPDATE ALERTS - RENAME ESTIMATED_LOSS TO USD
-- ============================================

-- The alerts.estimated_loss column already exists, just update comment
COMMENT ON COLUMN alerts.estimated_loss IS 'Estimated loss in USD (pan-African standard currency)';

-- ============================================
-- 4. ADD COUNTRY-SPECIFIC PHONE VALIDATION
-- ============================================

-- Add function to validate African phone numbers
CREATE OR REPLACE FUNCTION is_valid_african_phone(phone_number TEXT) RETURNS BOOLEAN AS $$
BEGIN
    -- African country codes: +234 (NG), +254 (KE), +233 (GH), +27 (ZA), +256 (UG), +255 (TZ), etc.
    RETURN phone_number ~ '^\+2(3[3-4]|5[0-6]|7)\d{7,10}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_valid_african_phone IS 'Validates phone numbers for African countries (Nigeria, Kenya, Ghana, South Africa, Uganda, Tanzania, etc.)';

-- ============================================
-- 5. UPDATE EXISTING DATA (IF ANY)
-- ============================================

-- Update existing shops to have country code based on phone prefix
UPDATE shops 
SET country_code = CASE 
    WHEN owner_phone LIKE '+234%' THEN 'NG'  -- Nigeria
    WHEN owner_phone LIKE '+254%' THEN 'KE'  -- Kenya
    WHEN owner_phone LIKE '+233%' THEN 'GH'  -- Ghana
    WHEN owner_phone LIKE '+27%' THEN 'ZA'   -- South Africa
    WHEN owner_phone LIKE '+256%' THEN 'UG'  -- Uganda
    WHEN owner_phone LIKE '+255%' THEN 'TZ'  -- Tanzania
    WHEN owner_phone LIKE '+251%' THEN 'ET'  -- Ethiopia
    WHEN owner_phone LIKE '+237%' THEN 'CM'  -- Cameroon
    WHEN owner_phone LIKE '+225%' THEN 'CI'  -- Ivory Coast
    WHEN owner_phone LIKE '+221%' THEN 'SN'  -- Senegal
    ELSE 'NG'  -- Default to Nigeria for unknown
END
WHERE country_code IS NULL;

-- ============================================
-- 6. CREATE COUNTRY REFERENCE TABLE (OPTIONAL)
-- ============================================

CREATE TABLE IF NOT EXISTS countries (
    code VARCHAR(2) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone_prefix VARCHAR(5) NOT NULL,
    currency_code VARCHAR(3) NOT NULL,
    timezone VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert major African countries
INSERT INTO countries (code, name, phone_prefix, currency_code, timezone, is_active) VALUES
    ('NG', 'Nigeria', '+234', 'NGN', 'Africa/Lagos', TRUE),
    ('KE', 'Kenya', '+254', 'KES', 'Africa/Nairobi', TRUE),
    ('GH', 'Ghana', '+233', 'GHS', 'Africa/Accra', TRUE),
    ('ZA', 'South Africa', '+27', 'ZAR', 'Africa/Johannesburg', TRUE),
    ('UG', 'Uganda', '+256', 'UGX', 'Africa/Kampala', TRUE),
    ('TZ', 'Tanzania', '+255', 'TZS', 'Africa/Dar_es_Salaam', TRUE),
    ('ET', 'Ethiopia', '+251', 'ETB', 'Africa/Addis_Ababa', TRUE),
    ('CM', 'Cameroon', '+237', 'XAF', 'Africa/Douala', TRUE),
    ('CI', 'Ivory Coast', '+225', 'XOF', 'Africa/Abidjan', TRUE),
    ('SN', 'Senegal', '+221', 'XOF', 'Africa/Dakar', TRUE),
    ('RW', 'Rwanda', '+250', 'RWF', 'Africa/Kigali', TRUE),
    ('ZM', 'Zambia', '+260', 'ZMW', 'Africa/Lusaka', TRUE),
    ('ZW', 'Zimbabwe', '+263', 'ZWL', 'Africa/Harare', TRUE),
    ('BW', 'Botswana', '+267', 'BWP', 'Africa/Gaborone', TRUE),
    ('MW', 'Malawi', '+265', 'MWK', 'Africa/Blantyre', TRUE)
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE countries IS 'Reference table for supported African countries';

-- ============================================
-- 7. ADD INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_shops_country_code ON shops(country_code);
CREATE INDEX IF NOT EXISTS idx_shops_city ON shops(city);

-- ============================================
-- 8. UPDATE TRIGGERS TO USE USD
-- ============================================

-- Update the alert creation trigger to use new column name
DROP TRIGGER IF EXISTS trg_create_alert ON audit_logs;

CREATE OR REPLACE FUNCTION create_alert_if_critical() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'CRITICAL' THEN
        INSERT INTO alerts(shop_id, sku_id, audit_log_id, deviation, estimated_loss)
        VALUES (NEW.shop_id, NEW.sku_id, NEW.id, NEW.deviation, NEW.loss_value_usd);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_alert ON audit_logs;
CREATE TRIGGER trg_create_alert
AFTER INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION create_alert_if_critical();

-- ============================================
-- 9. ADD CURRENCY CONVERSION SUPPORT (FUTURE)
-- ============================================

-- Table for currency exchange rates (for future multi-currency support)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    rate NUMERIC(12,6) NOT NULL CHECK (rate > 0),
    effective_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_currency, to_currency, effective_date)
);

-- Insert initial USD rates (1:1 for USD to USD)
INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date) VALUES
    ('USD', 'USD', 1.000000, CURRENT_DATE),
    ('NGN', 'USD', 0.0013, CURRENT_DATE),  -- Approximate: 1 NGN = $0.0013
    ('KES', 'USD', 0.0077, CURRENT_DATE),  -- Approximate: 1 KES = $0.0077
    ('GHS', 'USD', 0.083, CURRENT_DATE),   -- Approximate: 1 GHS = $0.083
    ('ZAR', 'USD', 0.055, CURRENT_DATE)    -- Approximate: 1 ZAR = $0.055
ON CONFLICT (from_currency, to_currency, effective_date) DO NOTHING;

COMMENT ON TABLE exchange_rates IS 'Currency exchange rates for multi-currency support (future enhancement)';

-- ============================================
-- 10. MIGRATION SUMMARY
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '✅ Migration 004 Complete: Africa Expansion';
    RAISE NOTICE '   - Currency changed from NGN to USD';
    RAISE NOTICE '   - Added country_code and city columns';
    RAISE NOTICE '   - Renamed loss_value_naira to loss_value_usd';
    RAISE NOTICE '   - Added African phone validation';
    RAISE NOTICE '   - Created countries reference table';
    RAISE NOTICE '   - Added exchange rates table for future';
    RAISE NOTICE '   - System now supports pan-African operations';
END;
$$;