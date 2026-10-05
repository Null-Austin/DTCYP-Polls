// Append-only. Never edit a shipped migration; add a new one.
export const migrations: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE polls (
  id TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*' AND length(id) BETWEEN 2 AND 60),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  require_verification INTEGER NOT NULL DEFAULT 1,
  opens_at TEXT,
  closes_at TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single','multiple','text','rating')),
  required INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);
CREATE INDEX questions_poll ON questions(poll_id);

CREATE TABLE options (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX options_question ON options(question_id);

CREATE TABLE link_batches (
  id INTEGER PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE links (
  token TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES link_batches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX links_poll ON links(poll_id);
CREATE INDEX links_batch ON links(batch_id);

-- status 'accepted' = poll does not require verification; counted as verified in results.
CREATE TABLE responses (
  id INTEGER PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  link_token TEXT NOT NULL REFERENCES links(token) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('verified','unverified','accepted')),
  submitted_at TEXT NOT NULL,
  device_class TEXT NOT NULL CHECK (device_class IN ('mobile','desktop')),
  language TEXT NOT NULL
);
CREATE UNIQUE INDEX responses_one_verified ON responses(link_token) WHERE status = 'verified';
CREATE INDEX responses_poll ON responses(poll_id);

CREATE TABLE answers (
  id INTEGER PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id INTEGER REFERENCES options(id) ON DELETE CASCADE,
  text TEXT
);
CREATE INDEX answers_response ON answers(response_id);
CREATE INDEX answers_question ON answers(question_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT
);
CREATE INDEX audit_at ON audit_log(at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    id: 2,
    sql: `
CREATE TABLE poll_shares (
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('view','edit')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
CREATE INDEX poll_shares_user ON poll_shares(user_id);
`,
  },
]
