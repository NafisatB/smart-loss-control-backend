-- ============================================
-- Smart Loss Control - FINAL PRODUCTION SCHEMA
-- Migration: 001_init_final.sql
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- SHOPS
-- ============================================
CREATE TABLE shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_name VARCHAR(150) NOT NULL,
    owner_phone VARCHAR(20) UNIQUE NOT NULL,
    aes_key_hash TEXT,
    currency_code VARCHAR(3) DEFAULT 'NGN' NOT NULL,
    timezone VARCHAR(50) DEFAULT 'Africa/Lagos' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- USERS (OWNER / STAFF)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'STAFF')),
    pin_hash TEXT,  -- allow NULL during OTP onboarding
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN users.pin_hash IS 'Stores the hashed version of a strictly 4-digit numeric PIN (e.g., 1234).';

CREATE UNIQUE INDEX unique_users_phone_per_shop ON users(shop_id, phone);
CREATE INDEX idx_users_shop_id ON users(shop_id);

-- ============================================
-- DEVICES (QR ONBOARDING & WHITELISTING)
-- ============================================
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL, 
    is_whitelisted BOOLEAN DEFAULT TRUE NOT NULL,
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_id),
    UNIQUE(device_id)
);

-- ============================================
-- SKUS (PRODUCT MASTER LIST)
-- ============================================
CREATE TABLE skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand VARCHAR(100) NOT NULL, 
    size VARCHAR(50) NOT NULL,  
    is_carton BOOLEAN DEFAULT FALSE NOT NULL,
    units_per_carton INTEGER DEFAULT 12 NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(brand, size, is_carton)
);

-- ============================================
-- INVENTORY (CURRENT STOCK STATE)
-- ============================================
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    cost_price NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
    selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
    reorder_level INTEGER DEFAULT 5 NOT NULL,
    last_count_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shop_id, sku_id),
    CHECK (selling_price >= cost_price)
);

-- Optional: auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_inventory_timestamp() RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at := NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_updated_at
BEFORE UPDATE ON inventory
FOR EACH ROW
EXECUTE FUNCTION update_inventory_timestamp();

-- ============================================
-- TRANSACTIONS (IMMUTABLE LOG WITH OFFLINE SUPPORT)
-- ============================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('SALE', 'RESTOCK', 'DECANT', 'AUDIT')),
    quantity INTEGER NOT NULL CHECK (quantity <> 0),
    is_offline BOOLEAN DEFAULT FALSE NOT NULL,
    offline_ref TEXT,
    occurred_at TIMESTAMP NOT NULL,
    device_id TEXT NOT NULL,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shop_id, offline_ref)
);

CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);
CREATE INDEX idx_transactions_shop_id ON transactions(shop_id);
CREATE INDEX idx_transactions_sku_id ON transactions(sku_id);
CREATE INDEX idx_transactions_type_occurred ON transactions(type, occurred_at);

-- ============================================
-- AUDIT LOGS (EXPECTED VS ACTUAL COUNT)
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, 
    sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    expected_qty INTEGER NOT NULL,
    actual_qty INTEGER NOT NULL,
    deviation INTEGER NOT NULL,
    deviation_percent NUMERIC(6,2),
    loss_value_naira NUMERIC(12,2) NOT NULL DEFAULT 0, 
    trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('RANDOM', 'ANOMALY', 'MANUAL')),
    status VARCHAR(20) DEFAULT 'OK' NOT NULL CHECK (status IN ('OK', 'WARNING', 'CRITICAL')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger: calculate deviation_percent & set status
CREATE OR REPLACE FUNCTION check_audit_severity() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expected_qty = 0 THEN
        NEW.deviation_percent := 100;
    ELSE
        NEW.deviation_percent := (NEW.deviation::numeric / NEW.expected_qty) * 100;
    END IF;

    IF ABS(NEW.deviation_percent) >= 10.00 THEN
        NEW.status := 'CRITICAL';
    ELSIF ABS(NEW.deviation_percent) > 0 THEN
        NEW.status := 'WARNING';
    ELSE
        NEW.status := 'OK';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_severity
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION check_audit_severity();

CREATE INDEX idx_audit_logs_shop_sku ON audit_logs(shop_id, sku_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================
-- ALERTS & SEVERITY LOGIC
-- ============================================
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
    audit_log_id UUID REFERENCES audit_logs(id) ON DELETE SET NULL,
    deviation INTEGER NOT NULL,
    estimated_loss NUMERIC(12,2) NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger: auto-create alerts for CRITICAL
CREATE OR REPLACE FUNCTION create_alert_if_critical() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'CRITICAL' THEN
        INSERT INTO alerts(shop_id, sku_id, audit_log_id, deviation, estimated_loss)
        VALUES (NEW.shop_id, NEW.sku_id, NEW.id, NEW.deviation, NEW.loss_value_naira);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_alert
AFTER INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION create_alert_if_critical();

CREATE INDEX idx_alerts_unresolved ON alerts(shop_id, is_resolved) WHERE is_resolved = FALSE;
CREATE INDEX idx_alerts_created_at ON alerts(created_at);

-- ============================================
-- RESTOCKS & DECANTS
-- ============================================
CREATE TABLE restocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    ordered_qty INTEGER NOT NULL CHECK (ordered_qty >= 0),
    received_qty INTEGER NOT NULL CHECK (received_qty >= 0),
    cost_price NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
    selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
    discrepancy INTEGER GENERATED ALWAYS AS (received_qty - ordered_qty) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE decants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    carton_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    unit_sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    cartons_used INTEGER NOT NULL CHECK (cartons_used > 0),
    units_created INTEGER NOT NULL CHECK (units_created > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (carton_sku_id <> unit_sku_id)
);

-- ============================================
-- OTP VERIFICATIONS (OWNER ONBOARDING)
-- ============================================
CREATE TABLE otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    full_name VARCHAR(150),
    shop_name VARCHAR(150),
    is_verified BOOLEAN DEFAULT FALSE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_otp_phone_verified ON otp_verifications(phone, is_verified);
CREATE INDEX idx_otp_expires_at ON otp_verifications(expires_at);

COMMENT ON TABLE otp_verifications IS 'Stores OTP codes for owner registration verification (PRD Section 5.5 Phase 1.1)';

-- ============================================
-- SESSIONS (12-HOUR AUTO-LOGOUT)
-- ============================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user_device ON sessions(user_id, device_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

COMMENT ON TABLE sessions IS 'Session management for 12-hour auto-logout (PRD NFR Security requirement)';

-- ============================================
-- QR CODES (ONE-TIME-USE STAFF LINKING)
-- ============================================
CREATE TABLE qr_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_qr_codes_shop_id ON qr_codes(shop_id);
CREATE INDEX idx_qr_codes_code_used ON qr_codes(code, is_used) WHERE is_used = FALSE;

COMMENT ON TABLE qr_codes IS 'One-time-use QR codes for secure staff onboarding (PRD Section 3.1.C)';

-- ============================================
-- NOTIFICATION LOGS (WHATSAPP ALERT TRACKING)
-- ============================================
CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
    recipient_phone VARCHAR(20) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('WHATSAPP', 'SMS', 'PUSH')),
    message_body TEXT,
    status VARCHAR(20) DEFAULT 'PENDING' NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'DELIVERED')),
    external_id TEXT,
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_logs_alert_id ON notification_logs(alert_id);
CREATE INDEX idx_notification_logs_status ON notification_logs(status);

COMMENT ON TABLE notification_logs IS 'Tracks WhatsApp/SMS alert delivery status (PRD Section 5.7.6)';

-- ============================================
-- SALES VELOCITY METRICS (AI ANOMALY DETECTION)
-- ============================================
CREATE TABLE sales_velocity_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    time_window VARCHAR(20) NOT NULL CHECK (time_window IN ('HOURLY', 'DAILY', 'WEEKLY')),
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    units_sold INTEGER NOT NULL DEFAULT 0,
    avg_velocity NUMERIC(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shop_id, sku_id, time_window, period_start)
);

CREATE INDEX idx_velocity_shop_sku_period ON sales_velocity_metrics(shop_id, sku_id, period_start);

COMMENT ON TABLE sales_velocity_metrics IS 'Tracks sales velocity for AI anomaly detection (PRD Section 5.7.4 - 2x average trigger)';

-- ============================================
-- ADDITIONAL INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_restocks_shop_created ON restocks(shop_id, created_at);
CREATE INDEX idx_decants_shop_created ON decants(shop_id, created_at);
