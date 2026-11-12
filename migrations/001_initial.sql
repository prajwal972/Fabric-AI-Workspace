BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_uq
  ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  memory_enabled boolean NOT NULL DEFAULT true,
  research_url text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hash bytea,
  user_agent_hash bytea
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS encrypted_secrets (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  key_version integer NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_secret_id text REFERENCES encrypted_secrets(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unchecked',
  last_error_code text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS providers_workspace_idx ON providers(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS providers_one_default_uq
  ON providers(workspace_id) WHERE is_default AND enabled;

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES users(id),
  title text NOT NULL,
  system_instructions text NOT NULL DEFAULT '',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS conversations_workspace_updated_idx
  ON conversations(workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'complete',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS messages_workspace_created_idx
  ON messages(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL REFERENCES users(id),
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  detected_mime text,
  declared_mime text,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('quarantined','scanning','processing','ready','rejected','failed','deleted')),
  extraction_method text,
  extracted_text_object_key text,
  error_code text,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS files_workspace_created_idx
  ON files(workspace_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS plugins (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  auth_scheme text NOT NULL,
  credential_secret_id text REFERENCES encrypted_secrets(id) ON DELETE SET NULL,
  oauth_provider text,
  oauth_expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, plugin_id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash bytea PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  provider text NOT NULL,
  pkce_verifier_secret_id text REFERENCES encrypted_secrets(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','retrying','completed','failed','cancelled','dead_letter')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  run_after timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_dispatch_idx ON jobs(status, run_after, created_at);
CREATE INDEX IF NOT EXISTS jobs_workspace_idx ON jobs(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analyst_states (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  provider_id text REFERENCES providers(id) ON DELETE SET NULL,
  model text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_micros bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_workspace_created_idx
  ON usage_ledger(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  request_id text,
  target_type text,
  target_id text,
  outcome text NOT NULL,
  ip_hash bytea,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_workspace_created_idx
  ON audit_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  status_code integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_keys(expires_at);

COMMIT;