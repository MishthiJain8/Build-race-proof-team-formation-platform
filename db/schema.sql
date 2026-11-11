CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  timezone TEXT NOT NULL DEFAULT 'UTC+05:30',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hackathons (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  min_size INTEGER NOT NULL CHECK (min_size >= 2),
  max_size INTEGER NOT NULL CHECK (max_size >= min_size)
);

INSERT INTO hackathons (id,title,min_size,max_size)
VALUES ('00000000-0000-4000-8000-000000000001','Hack4Hack Crew Challenge',2,5)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id UUID NOT NULL REFERENCES hackathons(id),
  name TEXT NOT NULL,
  leader_id UUID NOT NULL REFERENCES users(id),
  max_size INTEGER NOT NULL CHECK (max_size BETWEEN 2 AND 5),
  member_count INTEGER NOT NULL DEFAULT 1 CHECK (member_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (member_count <= max_size)
);

CREATE TABLE IF NOT EXISTS memberships (
  hackathon_id UUID NOT NULL REFERENCES hackathons(id),
  user_id UUID NOT NULL REFERENCES users(id),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hackathon_id,user_id)
);

CREATE INDEX IF NOT EXISTS memberships_team_idx ON memberships(team_id);
CREATE INDEX IF NOT EXISTS teams_board_idx ON teams(hackathon_id,created_at);

CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 100,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id,user_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  team_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  subject_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_team_idx ON audit_log(team_id,id DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  actor_id UUID NOT NULL REFERENCES users(id),
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,route,key)
);
