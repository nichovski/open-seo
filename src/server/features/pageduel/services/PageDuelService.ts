import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { PageDuelConnectionRepository } from "@/server/features/pageduel/repositories/PageDuelConnectionRepository";
import { AppError } from "@/server/lib/errors";
import {
  createPageDuelClient,
  type PageDuelRange,
} from "@/server/lib/pageduelClient";
import { PageDuelError } from "@/server/lib/pageduelErrors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_DAYS = 28;

async function readEncryptionKey(): Promise<string | null> {
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  return secret && secret.length >= MIN_BETTER_AUTH_SECRET_LENGTH
    ? secret
    : null;
}

async function isConfigured(): Promise<boolean> {
  return (await readEncryptionKey()) !== null;
}

async function getEncryptionKey(): Promise<string> {
  const key = await readEncryptionKey();
  if (!key) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      `Set BETTER_AUTH_SECRET to at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters to store PageDuel API keys. It encrypts them.`,
    );
  }
  return key;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The last 28 complete UTC days, or the given dates. */
function resolveRange(startDate?: string, endDate?: string): PageDuelRange {
  if (startDate && endDate) return { from: startDate, to: endDate };
  const to = new Date(Date.now() - DAY_MS);
  return {
    from: isoDay(new Date(to.getTime() - (REPORT_DAYS - 1) * DAY_MS)),
    to: isoDay(to),
  };
}

async function getConnection(projectId: string) {
  const row = await PageDuelConnectionRepository.getByProjectId(projectId);
  if (!row) return null;
  const { apiKeyCiphertext: _omitted, ...connection } = row;
  return connection;
}

function listSites(apiKey: string) {
  return createPageDuelClient(apiKey).listSites();
}

async function connect(input: {
  projectId: string;
  apiKey: string;
  siteId: string;
}): Promise<void> {
  const key = await getEncryptionKey();
  const sites = await listSites(input.apiKey);
  const site = sites.find((candidate) => candidate.id === input.siteId);
  if (!site) throw new AppError("NOT_FOUND");
  await PageDuelConnectionRepository.upsert({
    projectId: input.projectId,
    siteId: site.id,
    siteName: site.name,
    siteDomain: site.domain,
    apiKeyCiphertext: await symmetricEncrypt({ key, data: input.apiKey }),
  });
}

async function disconnect(projectId: string): Promise<void> {
  await PageDuelConnectionRepository.deleteByProjectId(projectId);
}

async function openClient(projectId: string) {
  const row = await PageDuelConnectionRepository.getByProjectId(projectId);
  if (!row) throw new PageDuelError("pageduel_not_connected");
  const key = await getEncryptionKey();
  let apiKey: string;
  try {
    apiKey = await symmetricDecrypt({ key, data: row.apiKeyCiphertext });
  } catch {
    throw new PageDuelError("pageduel_reconnect_required");
  }
  return { client: createPageDuelClient(apiKey), row };
}

async function getOverview(input: {
  projectId: string;
  startDate?: string;
  endDate?: string;
}) {
  const { client, row } = await openClient(input.projectId);
  const range = resolveRange(input.startDate, input.endDate);
  const [stats, timeseries] = await Promise.all([
    client.getStats(row.siteId, range),
    client.getTimeseries(row.siteId, range),
  ]);
  return {
    site: { id: row.siteId, name: row.siteName, domain: row.siteDomain },
    range,
    current: stats.current,
    previous: stats.previous,
    trend: timeseries.map((point) => ({
      date: point.bucket,
      visitors: point.visitors,
    })),
  };
}

async function getDashboardReport(projectId: string) {
  try {
    return { connected: true as const, ...(await getOverview({ projectId })) };
  } catch (error) {
    if (error instanceof PageDuelError) {
      if (error.code === "pageduel_not_connected") {
        return { connected: false as const };
      }
      if (error.code === "pageduel_reconnect_required") {
        return { connected: true as const, problem: "reconnect" as const };
      }
    }
    throw error;
  }
}

async function getTopPages(input: {
  projectId: string;
  startDate?: string;
  endDate?: string;
  dimension: "page" | "entry_page";
  limit: number;
}) {
  const { client, row } = await openClient(input.projectId);
  const range = resolveRange(input.startDate, input.endDate);
  const rows = await client.getBreakdown(
    row.siteId,
    range,
    input.dimension,
    input.limit,
  );
  return {
    site: { id: row.siteId, name: row.siteName, domain: row.siteDomain },
    range,
    rows: rows.map((item) => ({
      path: item.key,
      visitors: item.visitors,
      pageviews: item.pageviews,
    })),
  };
}

async function getGoals(input: {
  projectId: string;
  startDate?: string;
  endDate?: string;
}) {
  const { client, row } = await openClient(input.projectId);
  const range = resolveRange(input.startDate, input.endDate);
  return {
    site: { id: row.siteId, name: row.siteName, domain: row.siteDomain },
    range,
    goals: await client.getGoals(row.siteId, range),
  };
}

export const PageDuelService = {
  isConfigured,
  getConnection,
  listSites,
  connect,
  disconnect,
  getOverview,
  getDashboardReport,
  getTopPages,
  getGoals,
};
