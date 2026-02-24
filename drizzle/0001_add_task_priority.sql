ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
