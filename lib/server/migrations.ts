import type Database from "better-sqlite3"
import { auditHash } from "./audit-integrity"

// Append-only. Never edit a shipped migration; add a new one.
// `down` is best-effort (data created after the migration is lost); `run` is a JS data step in the same transaction.
export type Migration = { id: number; name: string; sql: string; down?: string; run?: (db: Database.Database) => void }

export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial schema",
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
    name: "poll shares",
    down: "DROP TABLE poll_shares;",
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
  {
    id: 3,
    name: "roles, permissions, bots",
    down: `
DROP TABLE bots; DROP TABLE user_roles; DROP TABLE role_permissions; DROP TABLE roles;
DROP INDEX one_root_user; ALTER TABLE users DROP COLUMN is_root; ALTER TABLE users DROP COLUMN kind;`,
    sql: `
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT NOT NULL DEFAULT '#99aab5' CHECK (color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 255),
  position INTEGER NOT NULL,
  is_root INTEGER NOT NULL DEFAULT 0 CHECK (is_root IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK (is_root = 0 OR level = 255)
);
CREATE UNIQUE INDEX one_root_role ON roles(is_root) WHERE is_root = 1;
CREATE TRIGGER root_role_no_update BEFORE UPDATE ON roles WHEN OLD.is_root = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin role is protected'); END;
CREATE TRIGGER root_role_no_delete BEFORE DELETE ON roles WHEN OLD.is_root = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin role is protected'); END;

-- scope: '' = everywhere, 'own' = only resources the holder owns, 'poll:<id>' / 'group:<id>' = one resource
CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (role_id, permission, scope)
);
CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role ON user_roles(role_id);

ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human','bot'));
ALTER TABLE users ADD COLUMN is_root INTEGER NOT NULL DEFAULT 0 CHECK (is_root IN (0,1));
CREATE UNIQUE INDEX one_root_user ON users(is_root) WHERE is_root = 1;

CREATE TABLE bots (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,
  token_prefix TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  last_used_ip TEXT,
  ip_allowlist TEXT
);
`,
    run: (db) => {
      // Frozen copies: later catalog changes must not rewrite history.
      const ADMIN = ["polls:create","polls:read","polls:edit","polls:delete","polls:publish","polls:share","groups:create","groups:read","groups:edit","groups:delete","urls:create","urls:read","urls:edit","urls:delete","urls:export","responses:read","responses:export","responses:delete","tokens:create","tokens:read","tokens:revoke","users:read","users:create","users:edit","users:disable","users:delete","role:read","role:create","role:edit","role:delete","role:assign","role:admin","audit:read","audit:export","api:docs","admin:settings","admin:branding","admin:export","admin:backups","admin:webhooks","admin:security","admin:system","admin:logs"]
      const EDITOR_OWN = ["polls:read","polls:edit","polls:delete","polls:publish","polls:share","groups:read","groups:edit","groups:delete","urls:read","urls:edit","urls:delete","urls:export","responses:read","responses:export"]
      const EDITOR_GLOBAL = ["polls:create","groups:create","urls:create"]
      const now = new Date().toISOString()
      const role = db.prepare("INSERT INTO roles (name, color, level, position, is_root, created_at) VALUES (?,?,?,?,?,?)")
      const perm = db.prepare("INSERT INTO role_permissions (role_id, permission, scope) VALUES (?,?,?)")
      const rootId = Number(role.run("rootadmin", "#ed4245", 255, 0, 1, now).lastInsertRowid)
      const adminId = Number(role.run("Admin", "#5865f2", 200, 1, 0, now).lastInsertRowid)
      const editorId = Number(role.run("Editor", "#3ba55d", 50, 2, 0, now).lastInsertRowid)
      for (const p of ADMIN) perm.run(adminId, p, "")
      for (const p of EDITOR_GLOBAL) perm.run(editorId, p, "")
      for (const p of EDITOR_OWN) perm.run(editorId, p, "own")
      const link = db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?,?)")
      // The original admin (lowest id) becomes rootadmin; everyone else keeps their old access via Admin/Editor.
      const first = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number } | undefined
      if (first) {
        db.prepare("UPDATE users SET is_root = 1 WHERE id = ?").run(first.id)
        link.run(first.id, rootId)
      }
      for (const u of db.prepare("SELECT id, role FROM users WHERE id != ?").all(first?.id ?? -1) as { id: number; role: string }[]) {
        link.run(u.id, u.role === "admin" ? adminId : editorId)
      }
    },
  },
  {
    id: 4,
    name: "protect root identity and grants",
    down: `
DROP TRIGGER root_perm_no_insert; DROP TRIGGER root_perm_no_update; DROP TRIGGER root_perm_no_delete; DROP TRIGGER root_user_no_demote; DROP TRIGGER root_user_no_delete;`,
    sql: `
CREATE TRIGGER root_perm_no_insert BEFORE INSERT ON role_permissions
  WHEN (SELECT is_root FROM roles WHERE id = NEW.role_id) = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
CREATE TRIGGER root_perm_no_update BEFORE UPDATE ON role_permissions
  WHEN (SELECT is_root FROM roles WHERE id = OLD.role_id) = 1 OR (SELECT is_root FROM roles WHERE id = NEW.role_id) = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
CREATE TRIGGER root_perm_no_delete BEFORE DELETE ON role_permissions
  WHEN (SELECT is_root FROM roles WHERE id = OLD.role_id) = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
CREATE TRIGGER root_user_no_demote BEFORE UPDATE OF is_root ON users WHEN OLD.is_root = 1 AND NEW.is_root != 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin user is protected'); END;
CREATE TRIGGER root_user_no_delete BEFORE DELETE ON users WHEN OLD.is_root = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin user is protected'); END;
`,
  },
  {
    id: 5,
    name: "scope editor creation permissions and complete root grants",
    down: `
  DROP TRIGGER root_perm_no_delete; DROP TRIGGER root_perm_no_update; DROP TRIGGER root_perm_no_insert;
  DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE is_root = 1);
  DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'Editor') AND permission IN ('groups:create','urls:create');
  INSERT INTO role_permissions (role_id, permission, scope) SELECT id, 'groups:create', '' FROM roles WHERE name = 'Editor';
  INSERT INTO role_permissions (role_id, permission, scope) SELECT id, 'urls:create', '' FROM roles WHERE name = 'Editor';
  CREATE TRIGGER root_perm_no_insert BEFORE INSERT ON role_permissions WHEN (SELECT is_root FROM roles WHERE id = NEW.role_id) = 1 BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
  CREATE TRIGGER root_perm_no_update BEFORE UPDATE ON role_permissions WHEN (SELECT is_root FROM roles WHERE id = OLD.role_id) = 1 OR (SELECT is_root FROM roles WHERE id = NEW.role_id) = 1 BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
  CREATE TRIGGER root_perm_no_delete BEFORE DELETE ON role_permissions WHEN (SELECT is_root FROM roles WHERE id = OLD.role_id) = 1 BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
  `,
    sql: `DROP TRIGGER root_perm_no_insert; DROP TRIGGER root_perm_no_update; DROP TRIGGER root_perm_no_delete;`,
    run: (db) => {
      const editor = db.prepare("SELECT id FROM roles WHERE name = 'Editor'").get() as { id: number }
      db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission IN ('groups:create','urls:create')").run(editor.id)
      db.prepare("INSERT INTO role_permissions (role_id, permission, scope) VALUES (?, 'groups:create', 'own'), (?, 'urls:create', 'own')").run(editor.id, editor.id)
      const root = db.prepare("SELECT id FROM roles WHERE is_root = 1").get() as { id: number }
      const all = ["polls:create","polls:read","polls:edit","polls:delete","polls:publish","polls:share","groups:create","groups:read","groups:edit","groups:delete","urls:create","urls:read","urls:edit","urls:delete","urls:export","responses:read","responses:export","responses:delete","tokens:create","tokens:read","tokens:revoke","users:read","users:create","users:edit","users:disable","users:delete","role:read","role:create","role:edit","role:delete","role:assign","role:admin","audit:read","audit:export","api:docs","admin:settings","admin:branding","admin:export","admin:backups","admin:webhooks","admin:security","admin:system","admin:logs"]
      const add = db.prepare("INSERT INTO role_permissions (role_id, permission, scope) VALUES (?, ?, '')")
      for (const permission of all) add.run(root.id, permission)
    },
  },
  {
    id: 6,
    name: "protect root permission insert after complete grants",
    down: "SELECT 1;",
    sql: `CREATE TRIGGER root_perm_no_insert BEFORE INSERT ON role_permissions
  WHEN (SELECT is_root FROM roles WHERE id = NEW.role_id) = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
CREATE TRIGGER root_perm_no_update BEFORE UPDATE ON role_permissions
  WHEN (SELECT is_root FROM roles WHERE id = OLD.role_id) = 1 OR (SELECT is_root FROM roles WHERE id = NEW.role_id) = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;
CREATE TRIGGER root_perm_no_delete BEFORE DELETE ON role_permissions
  WHEN (SELECT is_root FROM roles WHERE id = OLD.role_id) = 1
  BEGIN SELECT RAISE(ABORT, 'rootadmin permissions are protected'); END;`,
  },
  {
    id: 7,
    name: "distribution groups and per-url metadata",
    down: `DROP INDEX links_group; ALTER TABLE links DROP COLUMN display_title; ALTER TABLE links DROP COLUMN notes; ALTER TABLE links DROP COLUMN enabled; ALTER TABLE links DROP COLUMN group_id; DROP TABLE distribution_groups;`,
    sql: `
CREATE TABLE distribution_groups (
  id INTEGER PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO distribution_groups (id, poll_id, name, position, created_at)
  SELECT id, poll_id, label, id, created_at FROM link_batches;
ALTER TABLE links ADD COLUMN group_id INTEGER REFERENCES distribution_groups(id) ON DELETE SET NULL;
ALTER TABLE links ADD COLUMN display_title TEXT NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1));
UPDATE links SET group_id = batch_id;
CREATE INDEX links_group ON links(group_id);
`,
  },
  {
    id: 8,
    name: "audit request context and hash chain",
    down: `ALTER TABLE audit_log DROP COLUMN entry_hash; ALTER TABLE audit_log DROP COLUMN previous_hash; ALTER TABLE audit_log DROP COLUMN result; ALTER TABLE audit_log DROP COLUMN user_agent; ALTER TABLE audit_log DROP COLUMN ip; ALTER TABLE audit_log DROP COLUMN request_id; ALTER TABLE audit_log DROP COLUMN actor_name;`,
    sql: `
ALTER TABLE audit_log ADD COLUMN actor_name TEXT;
ALTER TABLE audit_log ADD COLUMN request_id TEXT;
ALTER TABLE audit_log ADD COLUMN ip TEXT;
ALTER TABLE audit_log ADD COLUMN user_agent TEXT;
ALTER TABLE audit_log ADD COLUMN result TEXT NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN previous_hash TEXT;
ALTER TABLE audit_log ADD COLUMN entry_hash TEXT;
`,
    run: (db) => {
      const rows = db.prepare("SELECT a.id, a.at, a.actor_user_id, a.action, a.target_type, a.target_id, a.details, u.username, u.kind FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id").all() as {
        id: number; at: string; actor_user_id: number | null; action: string; target_type: string | null; target_id: string | null; details: string | null; username: string | null; kind: string | null
      }[]
      let previous: string | null = null
      const update = db.prepare("UPDATE audit_log SET actor_name = ?, previous_hash = ?, entry_hash = ? WHERE id = ?")
      for (const r of rows) {
        const row = {
          id: r.id,
          at: r.at,
          actor_name: r.username ? (r.kind === "bot" ? r.username : r.username) : null,
          action: r.action,
          target_type: r.target_type,
          target_id: r.target_id,
          details: r.details,
          request_id: null,
          ip: null,
          user_agent: null,
          result: "success",
          previous_hash: previous,
        }
        const hash = auditHash(row)
        update.run(row.actor_name, previous, hash, r.id)
        previous = hash
      }
    },
  },
  {
    id: 9,
    name: "make audit log append-only",
    down: "DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete;",
    sql: `
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
`,
  },
]
