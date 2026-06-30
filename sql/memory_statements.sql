-- Sensitive memory statement columns are stored encrypted (AES-256-GCM).
-- Plaintext statement content lives only inside sensitive_payload after decryption.

CREATE TABLE IF NOT EXISTS memact_memory_statements (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  field_path TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  label TEXT NOT NULL,
  strength DOUBLE PRECISION,
  state TEXT NOT NULL DEFAULT 'active',
  source_app_id TEXT,
  allowed_app_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_actor_types JSONB NOT NULL DEFAULT '["memact_worker"]'::jsonb,
  sensitive_payload BYTEA NOT NULL,
  payload_iv BYTEA NOT NULL,
  payload_tag BYTEA NOT NULL,
  encryption_key_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memact_memory_statements_type_idx
  ON memact_memory_statements (memory_type);

CREATE INDEX IF NOT EXISTS memact_memory_statements_field_path_idx
  ON memact_memory_statements (field_path);

CREATE INDEX IF NOT EXISTS memact_memory_statements_sensitivity_idx
  ON memact_memory_statements (sensitivity);
  
CREATE TABLE IF NOT EXISTS memact_query_audit_trail (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  queried_path TEXT,
  result_count INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memact_query_audit_trail_client_idx 
  ON memact_query_audit_trail (client_id);

CREATE INDEX IF NOT EXISTS memact_query_audit_trail_timestamp_idx 
  ON memact_query_audit_trail (timestamp);