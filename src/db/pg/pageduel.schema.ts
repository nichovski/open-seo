import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Keep this definition structurally identical to ../pageduel.schema.ts.
export const pageduelConnections = pgTable("pageduel_connections", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull(),
  siteName: text("site_name").notNull(),
  siteDomain: text("site_domain").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext").notNull(),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});
