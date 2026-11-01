import { z } from "zod";
import { parseRetryAfterMs } from "@/server/lib/audit/crawl-throttle";
import { PageDuelError } from "@/server/lib/pageduelErrors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

const DEFAULT_BASE_URL = "https://pageduel.com";
const SITES_PAGE_LIMIT = 100;
const MAX_SITES_PAGES = 10;

export type PageDuelRange = {
  from: string;
  to: string;
};

const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
});

const statsSchema = z.object({
  visitors: z.number(),
  pageviews: z.number(),
  conversionRate: z.number(),
  revenue: z.number(),
});

const breakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  visitors: z.number(),
  pageviews: z.number(),
});

const goalSchema = z.object({
  id: z.string(),
  name: z.string(),
  uniques: z.number(),
  total: z.number(),
  conversionRate: z.number(),
  revenue: z.number(),
});

const timeseriesPointSchema = z.object({
  bucket: z.string(),
  visitors: z.number(),
});

type PageDuelSite = z.infer<typeof siteSchema>;

const sitesResponse = z.object({
  data: z.array(siteSchema),
  meta: z.object({ pagination: z.object({ hasMore: z.boolean() }) }),
});
const statsResponse = z.object({
  data: statsSchema,
  meta: z.object({ previous: statsSchema }),
});
const timeseriesResponse = z.object({ data: z.array(timeseriesPointSchema) });
const breakdownResponse = z.object({ data: z.array(breakdownRowSchema) });
const goalsResponse = z.object({ data: z.array(goalSchema) });

function statusToError(response: Response): PageDuelError {
  const { status } = response;
  if (status === 401 || status === 403 || status === 404) {
    return new PageDuelError("pageduel_reconnect_required");
  }
  if (status === 402) return new PageDuelError("pageduel_plan_required");
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    return new PageDuelError(
      "pageduel_rate_limited",
      retryAfterMs ? Math.ceil(retryAfterMs / 1000) : null,
    );
  }
  if (status >= 400 && status < 500) {
    return new PageDuelError("pageduel_invalid_request");
  }
  return new PageDuelError("pageduel_upstream_unavailable");
}

const siteBase = (siteId: string) => `/sites/${encodeURIComponent(siteId)}`;

export function createPageDuelClient(apiKey: string) {
  async function get<T>(
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const baseUrl =
      (await getOptionalEnvValue("PAGEDUEL_BASE_URL")) ?? DEFAULT_BASE_URL;
    const url = `${baseUrl}/api/v1${path}?${new URLSearchParams(query)}`;
    let response: Response;
    let body: string;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw statusToError(response);
      body = await response.text();
    } catch (error) {
      if (error instanceof PageDuelError) throw error;
      throw new PageDuelError("pageduel_upstream_unavailable");
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new PageDuelError("pageduel_malformed_response");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new PageDuelError("pageduel_malformed_response");
    return parsed.data;
  }

  return {
    async listSites(): Promise<PageDuelSite[]> {
      const sites: PageDuelSite[] = [];
      for (let page = 0; page < MAX_SITES_PAGES; page++) {
        const result = await get(
          "/sites",
          {
            limit: String(SITES_PAGE_LIMIT),
            offset: String(page * SITES_PAGE_LIMIT),
          },
          sitesResponse,
        );
        sites.push(...result.data);
        if (!result.meta.pagination.hasMore) break;
      }
      return sites;
    },

    async getStats(siteId: string, range: PageDuelRange) {
      const result = await get(
        `${siteBase(siteId)}/stats`,
        range,
        statsResponse,
      );
      return { current: result.data, previous: result.meta.previous };
    },

    async getTimeseries(siteId: string, range: PageDuelRange) {
      const result = await get(
        `${siteBase(siteId)}/timeseries`,
        range,
        timeseriesResponse,
      );
      return result.data;
    },

    async getBreakdown(
      siteId: string,
      range: PageDuelRange,
      dimension: "page" | "entry_page",
      limit: number,
    ) {
      const result = await get(
        `${siteBase(siteId)}/breakdown`,
        { ...range, dimension, limit: String(limit) },
        breakdownResponse,
      );
      return result.data;
    },

    async getGoals(siteId: string, range: PageDuelRange) {
      const result = await get(
        `${siteBase(siteId)}/goals`,
        range,
        goalsResponse,
      );
      return result.data;
    },
  };
}
