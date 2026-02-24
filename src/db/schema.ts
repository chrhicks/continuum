import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('open'),
    priority: integer('priority').notNull().default(100),
    intent: text('intent'),
    description: text('description'),
    plan: text('plan'),
    steps: text('steps').notNull().default('[]'),
    current_step: integer('current_step'),
    discoveries: text('discoveries').notNull().default('[]'),
    decisions: text('decisions').notNull().default('[]'),
    outcome: text('outcome'),
    completed_at: text('completed_at'),
    parent_id: text('parent_id'),
    blocked_by: text('blocked_by').notNull().default('[]'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.parent_id],
      foreignColumns: [table.id],
    }).onDelete('set null'),
    index('idx_tasks_status').on(table.status),
    index('idx_tasks_parent').on(table.parent_id),
    index('idx_tasks_priority').on(table.priority),
  ],
)
