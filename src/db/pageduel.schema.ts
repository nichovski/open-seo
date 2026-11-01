import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

// One connected PageDuel site per project. The API key is stored encrypted.
export const pageduelConnections = sqliteTable("pageduel_connections", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull(),
  siteName: text("site_name").notNull(),
  siteDomain: text("site_domain").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});
