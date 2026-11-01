import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pageduelConnections } from "@/db/pageduel-table";

type PageDuelConnection = typeof pageduelConnections.$inferSelect;

async function getByProjectId(
  projectId: string,
): Promise<PageDuelConnection | null> {
  const rows = await db
    .select()
    .from(pageduelConnections)
    .where(eq(pageduelConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsert(input: {
  projectId: string;
  siteId: string;
  siteName: string;
  siteDomain: string;
  apiKeyCiphertext: string;
}): Promise<void> {
  await db
    .insert(pageduelConnections)
    .values(input)
    .onConflictDoUpdate({
      target: pageduelConnections.projectId,
      set: {
        siteId: input.siteId,
        siteName: input.siteName,
        siteDomain: input.siteDomain,
        apiKeyCiphertext: input.apiKeyCiphertext,
        updatedAt: sql`(current_timestamp)`,
      },
    });
}

async function deleteByProjectId(projectId: string): Promise<void> {
  await db
    .delete(pageduelConnections)
    .where(eq(pageduelConnections.projectId, projectId));
}

export const PageDuelConnectionRepository = {
  getByProjectId,
  upsert,
  deleteByProjectId,
};
