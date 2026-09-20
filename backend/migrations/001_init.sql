-- Modelo mínimo, conforme seção 13 do briefing.
-- Sem histórico de fotos: current_state guarda somente o estado atual.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS current_state (
  frame_id UUID PRIMARY KEY REFERENCES frames(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  slot1_path TEXT,
  slot1_mime TEXT,
  slot2_path TEXT,
  slot2_mime TEXT,
  slot3_path TEXT,
  slot3_mime TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frame_id UUID NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_frame_id ON sessions(frame_id);
