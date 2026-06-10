-- Beta Ops tables (B1) — DDL theo PLATFORM_SPEC.md §11.1-11.4, idempotent.
-- Q1: PostgreSQL chỉ cho bảng mới; quota/tier/tower giữ Firestore.

CREATE TABLE IF NOT EXISTS beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_version TEXT,
  android_version TEXT,
  device_model TEXT,
  device_hash TEXT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS beta_bug_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_version TEXT,
  android_version TEXT,
  device_model TEXT,
  device_hash TEXT,
  screen_name TEXT,
  feature_name TEXT,
  error_type TEXT,
  severity TEXT NOT NULL DEFAULT 'warning',
  safe_message TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date DATE NOT NULL,
  device_hash TEXT NOT NULL,
  app_version TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  denied_count INTEGER NOT NULL DEFAULT 0,
  first_request_at TIMESTAMPTZ,
  last_request_at TIMESTAMPTZ,
  UNIQUE (usage_date, device_hash)
);

CREATE TABLE IF NOT EXISTS beta_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_version TEXT,
  android_version TEXT,
  device_model TEXT,
  device_hash TEXT,
  event_type TEXT NOT NULL,
  feature_name TEXT,
  safe_metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_beta_feedback_status ON beta_feedback (status, created_at);
CREATE INDEX IF NOT EXISTS idx_beta_bug_report_status ON beta_bug_report (status, created_at);
CREATE INDEX IF NOT EXISTS idx_beta_event_log_type ON beta_event_log (event_type, created_at);
