-- Migration: Add resolved_at column
ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;