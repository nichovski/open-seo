import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PageDuelService } from "@/server/features/pageduel/services/PageDuelService";
import { PageDuelError } from "@/server/lib/pageduelErrors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, percentCell } from "@/server/mcp/table";
import { buildDashboardUrl } from "@/server/mcp/urls";
import type { OpenSeoToolDefinition, ToolSchema } from "@/server/mcp/server";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Inclusive YYYY-MM-DD date. Provide both startDate and endDate.");

const dateShape = {
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
};

const bothOrNeither = (value: { startDate?: string; endDate?: string }) =>
  (value.startDate === undefined) === (value.endDate === undefined);
const bothOrNeitherMessage = "Provide both startDate and endDate, or neither.";

const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
};
const validRange = (value: { startDate?: string; endDate?: string }) =>
  value.startDate === undefined ||
  value.endDate === undefined ||
  (isRealDate(value.startDate) &&
    isRealDate(value.endDate) &&
    value.startDate <= value.endDate);
const validRangeMessage =
  "Dates must be valid YYYY-MM-DD values with startDate on or before endDate.";

const outputSchema = z
  .object({ status: z.enum(["ok", "error"]) })
  .passthrough();

const annotations = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
};

const READ_ONLY_NOTE =
  "Reads only the PageDuel site already connected to an OpenSEO project the caller is authorized to access. Read-only and uses no OpenSEO credits. Defaults to the last 28 complete UTC days.";

const overviewInputSchema = z
  .strictObject(dateShape)
  .refine(bothOrNeither, bothOrNeitherMessage)
  .refine(validRange, validRangeMessage);
const topPagesInputSchema = z
  .strictObject({
    ...dateShape,
    dimension: z
      .enum(["page", "entry_page"])
      .optional()
      .default("entry_page")
      .describe(
        "entry_page ranks landing pages (default). page ranks every page by pageviews.",
      ),
    limit: z.number().int().min(1).max(50).optional().default(25),
  })
  .refine(bothOrNeither, bothOrNeitherMessage)
  .refine(validRange, validRangeMessage);

type ProjectContext = { baseUrl: string };

function errorResponse(
  projectId: string,
  context: ProjectContext,
  error: unknown,
): CallToolResult {
  if (!(error instanceof PageDuelError)) throw error;
  const needsSettings =
    error.code === "pageduel_not_connected" ||
    error.code === "pageduel_reconnect_required";
  const actionUrl = needsSettings
    ? buildDashboardUrl(
        context.baseUrl,
        `/p/${projectId}/settings/integrations`,
        {},
      )
    : undefined;
  return mcpResponse({
    text: `PageDuel: ${error.message}${actionUrl ? ` Continue here: ${actionUrl}` : ""}`,
    meta: buildProjectMeta(context, projectId),
    structuredContent: {
      status: "error",
      error: {
        code: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
        actionUrl,
      },
    },
  });
}

/** Wraps a read in project auth and turns PageDuel failures into tool errors. */
function pageDuelHandler<Args extends { projectId: string }>(
  run: (args: Args) => Promise<{ text: string; data: Record<string, unknown> }>,
) {
  return withMcpProjectAuth(async (args: Args, context) => {
    try {
      const { text, data } = await run(args);
      return mcpResponse({
        text,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: { status: "ok" as const, ...data },
      });
    } catch (error) {
      return errorResponse(args.projectId, context, error);
    }
  });
}

type OverviewArgs = z.infer<typeof overviewInputSchema>;
type TopPagesArgs = z.infer<typeof topPagesInputSchema>;

const getPageDuelOverviewTool = {
  name: "get_pageduel_overview",
  config: {
    title: "Get PageDuel overview",
    description: `Visitors, pageviews, conversion rate and revenue from PageDuel for the previous period too, plus a daily visitors trend. ${READ_ONLY_NOTE}`,
    inputSchema: overviewInputSchema,
    outputSchema,
    annotations,
  },
  handler: pageDuelHandler(async (args: OverviewArgs) => {
    const overview = await PageDuelService.getOverview(args);
    const { current, previous } = overview;
    return {
      text: [
        `PageDuel ${overview.site.name} (${overview.site.domain}), ${overview.range.from} to ${overview.range.to}`,
        `Visitors: ${current.visitors} (previous ${previous.visitors})`,
        `Pageviews: ${current.pageviews} (previous ${previous.pageviews})`,
        `Conversion rate: ${percentCell(current.conversionRate)} (previous ${percentCell(previous.conversionRate)})`,
        `Revenue: ${current.revenue} (previous ${previous.revenue})`,
      ].join("\n"),
      data: overview,
    };
  }),
};

const getPageDuelTopPagesTool = {
  name: "get_pageduel_top_pages",
  config: {
    title: "Get PageDuel top pages",
    description: `Top landing pages (default) or top pages by pageviews from PageDuel. ${READ_ONLY_NOTE}`,
    inputSchema: topPagesInputSchema,
    outputSchema,
    annotations,
  },
  handler: pageDuelHandler(async (args: TopPagesArgs) => {
    const result = await PageDuelService.getTopPages(args);
    return {
      text: formatMcpTable(result.rows, [
        { header: "Path", value: (row) => row.path },
        { header: "Visitors", value: (row) => row.visitors },
        { header: "Pageviews", value: (row) => row.pageviews },
      ]),
      data: { ...result, dimension: args.dimension },
    };
  }),
};

const getPageDuelGoalsTool = {
  name: "get_pageduel_goals",
  config: {
    title: "Get PageDuel goals",
    description: `Goals with unique converters, total conversions, conversion rate and revenue from PageDuel. ${READ_ONLY_NOTE}`,
    inputSchema: overviewInputSchema,
    outputSchema,
    annotations,
  },
  handler: pageDuelHandler(async (args: OverviewArgs) => {
    const result = await PageDuelService.getGoals(args);
    return {
      text: formatMcpTable(result.goals, [
        { header: "Goal", value: (goal) => goal.name },
        { header: "Uniques", value: (goal) => goal.uniques },
        { header: "Total", value: (goal) => goal.total },
        {
          header: "Conversion rate",
          value: (goal) => goal.conversionRate,
          format: percentCell,
        },
        { header: "Revenue", value: (goal) => goal.revenue },
      ]),
      data: result,
    };
  }),
};

export function registerPageDuelTools(
  register: <Input extends ToolSchema>(
    tool: OpenSeoToolDefinition<Input>,
  ) => void,
) {
  register(getPageDuelOverviewTool);
  register(getPageDuelTopPagesTool);
  register(getPageDuelGoalsTool);
}
