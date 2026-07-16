-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Initial schema (design/05 §3 + design/06 additions).

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_budget_used BIGINT NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ
);

CREATE TABLE manufacturers (
  id            TEXT PRIMARY KEY,
  profile       JSONB NOT NULL,          -- validated ManufacturerProfile
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  manufacturer_id TEXT REFERENCES manufacturers(id),
  title         TEXT,
  product_type  TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'draft',   -- denormalized last WorkflowEvent.to
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE design_briefs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  manufacturer_id TEXT REFERENCES manufacturers(id),
  brief         JSONB NOT NULL,          -- validated DesignBrief
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE spec_revisions (
  id            BIGSERIAL PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  rev_no        INTEGER NOT NULL,
  designspec    JSONB NOT NULL,          -- validated DesignSpec
  origin        TEXT NOT NULL CHECK (origin IN ('llm','form','fastpath')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, rev_no)
);

CREATE TABLE artifacts (
  content_hash  TEXT PRIMARY KEY,        -- sha256 of (input, exporter, options)
  kind          TEXT NOT NULL,           -- gltf|usdz|dxf|svg|3mf|csv|pdf|manual-json
  object_key    TEXT NOT NULL,
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_events (
  id            BIGSERIAL PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  event         JSONB NOT NULL,          -- validated WorkflowEvent
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_events_project ON workflow_events(project_id, id);

CREATE TABLE llm_calls (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT REFERENCES sessions(id),
  stage         TEXT NOT NULL,           -- scope_gate|extract|caption_polish
  model         TEXT NOT NULL,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  outcome       TEXT NOT NULL,           -- ok|schema_reject|refused|error
  request       JSONB,
  response      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_session ON llm_calls(session_id, created_at);
