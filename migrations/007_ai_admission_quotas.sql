BEGIN;
CREATE TABLE ai_user_daily (
  user_id text NOT NULL REFERENCES users(id),
  quota_day date NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,quota_day)
);
CREATE TABLE ai_workspace_daily (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  quota_day date NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,quota_day)
);
CREATE INDEX ai_user_daily_retention ON ai_user_daily(quota_day);
CREATE INDEX ai_workspace_daily_retention ON ai_workspace_daily(quota_day);
COMMIT;
