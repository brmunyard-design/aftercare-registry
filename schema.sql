PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS registries (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  family_name TEXT NOT NULL,
  family_message TEXT DEFAULT '',
  admin_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'Practical help',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (registry_id) REFERENCES registries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  supporter_name TEXT NOT NULL,
  supporter_contact TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offered',
  availability TEXT DEFAULT '',
  note TEXT DEFAULT '',
  recovery_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_registry ON tasks(registry_id);
CREATE INDEX IF NOT EXISTS idx_commitments_task ON commitments(task_id);
CREATE INDEX IF NOT EXISTS idx_commitments_code ON commitments(recovery_code);