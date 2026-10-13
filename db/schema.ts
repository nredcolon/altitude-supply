import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
// Each authenticated user owns an isolated development workspace.
export const workspaces = sqliteTable('supply_workspaces', {
  userId: text('user_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
