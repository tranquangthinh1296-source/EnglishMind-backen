-- Knowledge Warehouse tables (B2) — DDL theo PLATFORM_SPEC.md §11.5-11.9, idempotent.

CREATE TABLE IF NOT EXISTS user_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_key TEXT NOT NULL,
  feature TEXT NOT NULL,
  source_lang TEXT,
  target_lang TEXT,
  domain TEXT,
  intent TEXT,
  tone TEXT,
  level TEXT,
  event_type TEXT NOT NULL,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS ai_generation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_key TEXT,
  feature TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  normalized_input TEXT,
  privacy_level TEXT NOT NULL,
  intent TEXT,
  domain TEXT,
  tone TEXT,
  level TEXT,
  response_json JSONB,
  model_name TEXT,
  schema_version INTEGER NOT NULL,
  quality_score NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS shared_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  intent TEXT NOT NULL,
  domain TEXT,
  subdomain TEXT,
  vi_template TEXT NOT NULL,
  en_template TEXT NOT NULL,
  tone TEXT,
  level TEXT,
  slots_json JSONB,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_score NUMERIC DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate'
);

CREATE TABLE IF NOT EXISTS template_quality_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  template_id UUID REFERENCES shared_templates(id),
  user_key TEXT,
  event_type TEXT NOT NULL,
  weight INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_redaction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  input_hash TEXT NOT NULL,
  detected_sensitive_types TEXT[],
  privacy_level TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ule_user ON user_learning_events (user_key, created_at);
CREATE INDEX IF NOT EXISTS idx_agr_hash ON ai_generation_records (input_hash);
CREATE INDEX IF NOT EXISTS idx_agr_intent ON ai_generation_records (intent, domain);
CREATE INDEX IF NOT EXISTS idx_st_intent ON shared_templates (intent, status);
