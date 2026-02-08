-- Add completion metadata
ALTER TABLE tasks ADD COLUMN completed_at TEXT;

-- Normalize status values to SDK end-state
UPDATE tasks SET status = 'ready' WHERE status = 'in_progress';

-- Add SDK fields to steps JSON while preserving legacy fields
UPDATE tasks
SET steps = (
  SELECT json_group_array(
    json_patch(
      json_object(
        'description', COALESCE(json_extract(value, '$.description'), json_extract(value, '$.details'), ''),
        'position', COALESCE(json_extract(value, '$.position'), 0)
      ),
      value
    )
  )
  FROM json_each(tasks.steps)
)
WHERE steps IS NOT NULL AND steps != '[]';

-- Add SDK fields to discoveries JSON while preserving legacy fields
UPDATE tasks
SET discoveries = (
  SELECT json_group_array(
    json_patch(
      json_object(
        'source', COALESCE(json_extract(value, '$.source'), 'system'),
        'impact', json_extract(value, '$.impact')
      ),
      value
    )
  )
  FROM json_each(tasks.discoveries)
)
WHERE discoveries IS NOT NULL AND discoveries != '[]';

-- Add SDK fields to decisions JSON while preserving legacy fields
UPDATE tasks
SET decisions = (
  SELECT json_group_array(
    json_patch(
      json_object(
        'source', COALESCE(json_extract(value, '$.source'), 'system'),
        'impact', json_extract(value, '$.impact')
      ),
      value
    )
  )
  FROM json_each(tasks.decisions)
)
WHERE decisions IS NOT NULL AND decisions != '[]';
