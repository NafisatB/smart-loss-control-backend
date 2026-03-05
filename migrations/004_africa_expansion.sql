-- ============================================
-- Migration 004: Africa Expansion (Safe & Idempotent)
-- Purpose: Expand from Nigeria-only to Pan-African
-- Date: March 2026
-- ============================================

-- ============================================
-- 1️⃣ Update shops table for multi-country support
-- ============================================

-- Change default currency to USD (if not already)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='shops' AND column_name='currency_code' AND column_default LIKE '%USD%'
    ) THEN
        ALTER TABLE shops ALTER COLUMN currency_code SET DEFAULT 'USD';
    END IF;
END $$;

-- Add country_code if missing
ALTER TABLE shops ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);

-- Add city if missing
ALTER TABLE shops ADD COLUMN IF NOT EXISTS city VARCHAR(100);

-- Ensure timezone default
ALTER TABLE shops ALTER COLUMN timezone SET DEFAULT 'Africa/Lagos';

COMMENT ON COLUMN shops.currency_code IS 'ISO 4217 currency code - USD for pan-African operations';
COMMENT ON COLUMN shops.country_code IS 'ISO 3166-1 alpha-2 country code (NG, KE, GH, ZA, etc.)';
COMMENT ON COLUMN shops.city IS 'City/location for regional analytics and support';

-- ============================================
-- 2️⃣ Rename loss_value_naira to loss_value_usd (if exists)
-- ============================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='audit_logs' AND column_name='loss_value_naira'
    ) THEN
        ALTER TABLE audit_logs 
            RENAME COLUMN loss_value_naira TO loss_value_usd;
        COMMENT ON COLUMN audit_logs.loss_value_usd IS 'Estimated loss value in USD for pan-African operations';
    END IF;
END $$;

-- ============================================
-- 3️⃣ Update alerts column comment
-- ============================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='alerts' AND column_name='estimated_loss'
    ) THEN
        COMMENT ON COLUMN alerts.estimated_loss IS 'Estimated loss in USD (pan-African standard currency)';
    END IF;
END $$;

-- ============================================
-- 4️⃣ African phone validation function
-- ============================================

CREATE OR REPLACE FUNCTION is_valid_african_phone(phone_number TEXT) RETURNS BOOLEAN AS $$
BEGIN
    RETURN phone_number ~ '^\+2(3[3-4]|5[0-6]|7)\d{7,10}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_valid_african_phone IS 'Validates phone numbers for African countries (NG, KE, GH, ZA, UG, TZ, ET, CM, CI, SN)';

-- ============================================
-- 5️⃣ Update existing shops with country_code
-- ============================================

UPDATE shops 
SET country_code = CASE 
    WHEN owner_phone LIKE '+234%' THEN 'NG'
    WHEN owner_phone LIKE '+254%' THEN 'KE'
    WHEN owner_phone LIKE '+233%' THEN 'GH'
    WHEN owner_phone LIKE '+27%' THEN 'ZA'
    WHEN owner_phone LIKE '+256%' THEN 'UG'
    WHEN owner_phone LIKE '+255%' THEN 'TZ'
    WHEN owner_phone LIKE '+251%' THEN 'ET'
    WHEN owner_phone LIKE '+237%' THEN 'CM'
    WHEN owner_phone LIKE '+225%' THEN 'CI'
    WHEN owner_phone LIKE '+221%' THEN 'SN'
    ELSE 'NG'
END
WHERE country_code IS NULL;

-- ============================================
-- 6️⃣ Countries reference table
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
-- 7️⃣ Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_shops_country_code ON shops(country_code);
CREATE INDEX IF NOT EXISTS idx_shops_city ON shops(city);

-- ============================================
-- 8️⃣ Update triggers to use USD
-- ============================================

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

CREATE TRIGGER trg_create_alert
AFTER INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION create_alert_if_critical();

-- ============================================
-- 9️⃣ Exchange rates table
-- ============================================

CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    rate NUMERIC(12,6) NOT NULL CHECK (rate > 0),
    effective_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_currency, to_currency, effective_date)
);

INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date) VALUES
    ('USD', 'USD', 1.000000, CURRENT_DATE),
    ('NGN', 'USD', 0.0013, CURRENT_DATE),
    ('KES', 'USD', 0.0077, CURRENT_DATE),
    ('GHS', 'USD', 0.083, CURRENT_DATE),
    ('ZAR', 'USD', 0.055, CURRENT_DATE)
ON CONFLICT (from_currency, to_currency, effective_date) DO NOTHING;

COMMENT ON TABLE exchange_rates IS 'Currency exchange rates for multi-currency support';

-- ============================================
-- 10️⃣ Migration complete
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '✅ Migration 004 Complete: Africa Expansion (Safe)';
END $$;