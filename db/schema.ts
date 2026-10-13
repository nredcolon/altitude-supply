import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
// Each authenticated user owns an isolated development workspace.
export const workspaces = sqliteTable("supply_workspaces", {
  userId: text("user_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// M1 catalog uses its own schema and never imports the prototype's demo data.
export const catalogWorkspaces = sqliteTable("catalog_workspaces", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().unique(),
  name: text("name").notNull(),
  inviteHash: text("invite_hash").notNull().unique(),
  inviteExpiresAt: text("invite_expires_at").notNull(),
  revision: integer("revision").notNull().default(0),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});
