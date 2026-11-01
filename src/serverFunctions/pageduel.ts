import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { PageDuelService } from "@/server/features/pageduel/services/PageDuelService";
import { AppError } from "@/server/lib/errors";
import { PageDuelError } from "@/server/lib/pageduelErrors";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const apiKeySchema = z
  .string()
  .trim()
  .regex(/^pd_[0-9a-f]{40}$/);
const listSitesSchema = projectScopedSchema.extend({ apiKey: apiKeySchema });
const connectSchema = listSitesSchema.extend({
  siteId: z.string().min(1).max(100),
});

type KeyProblem = "invalid_key" | "no_api_access" | "rate_limited";

/** Problems the user can fix show as a result; real faults still throw. */
function toKeyProblem(error: unknown): { problem: KeyProblem } {
  if (error instanceof PageDuelError) {
    if (error.code === "pageduel_reconnect_required") {
      return { problem: "invalid_key" };
    }
    if (error.code === "pageduel_plan_required") {
      return { problem: "no_api_access" };
    }
    if (error.code === "pageduel_rate_limited") {
      return { problem: "rate_limited" };
    }
    if (error.code === "pageduel_upstream_unavailable") {
      throw new AppError("UPSTREAM_UNAVAILABLE");
    }
  }
  throw error;
}

export const getPageDuelConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [connection, encryptionConfigured] = await Promise.all([
      PageDuelService.getConnection(context.projectId),
      PageDuelService.isConfigured(),
    ]);
    return {
      connected: Boolean(connection),
      canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
      encryptionConfigured,
      siteId: connection?.siteId ?? null,
      siteName: connection?.siteName ?? null,
      siteDomain: connection?.siteDomain ?? null,
      connectedAt: connection?.createdAt ?? null,
    };
  });

export const listPageDuelSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSitesSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      return { sites: await PageDuelService.listSites(data.apiKey) };
    } catch (error) {
      return toKeyProblem(error);
    }
  });

export const connectPageDuel = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(connectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      await PageDuelService.connect({
        projectId: context.projectId,
        apiKey: data.apiKey,
        siteId: data.siteId,
      });
      return { connected: true as const };
    } catch (error) {
      return toKeyProblem(error);
    }
  });

export const disconnectPageDuel = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await PageDuelService.disconnect(context.projectId);
    return { success: true };
  });

export const getPageDuelDashboardReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    try {
      return await PageDuelService.getDashboardReport(context.projectId);
    } catch (error) {
      if (error instanceof PageDuelError) {
        if (error.code === "pageduel_rate_limited") {
          throw new AppError("RATE_LIMITED");
        }
        if (error.code === "pageduel_upstream_unavailable") {
          throw new AppError("UPSTREAM_UNAVAILABLE");
        }
      }
      throw error;
    }
  });
