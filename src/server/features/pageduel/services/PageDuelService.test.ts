import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageDuelService } from "./PageDuelService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  client: {
    listSites: vi.fn(),
    getStats:
      vi.fn<(siteId: string, range: { from: string }) => Promise<unknown>>(),
    getTimeseries: vi.fn(),
  },
  createClient: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: drizzle(async (query, params, method) => {
    if (!state.database) throw new Error("Database not initialized");
    const statement = state.database.prepare(query);
    const values = params.map((value: unknown): SQLInputValue => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      )
        return value;
      throw new Error("Unexpected SQL parameter");
    });
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    return { rows: statement.all(...values).map((row) => Object.values(row)) };
  }),
}));
vi.mock("@/db/pageduel-table", async () => ({
  pageduelConnections: (await import("@/db/pageduel.schema"))
    .pageduelConnections,
}));
vi.mock("@/server/lib/pageduelClient", () => ({
  createPageDuelClient: state.createClient,
}));

const apiKey = `pd_${"a".repeat(40)}`;
const stats = { visitors: 10, pageviews: 20, conversionRate: 0.1, revenue: 5 };

function rawRow(projectId: string) {
  return state.database
    ?.prepare("SELECT * FROM pageduel_connections WHERE project_id = ?")
    .get(projectId);
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "s".repeat(40);
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  const migration = readdirSync("drizzle/sqlite").find((file) =>
    file.endsWith("_pageduel_connections.sql"),
  );
  if (!migration) throw new Error("PageDuel migration not found");
  state.database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO projects VALUES ('p1'), ('p2');
  `);
  state.database.exec(readFileSync(`drizzle/sqlite/${migration}`, "utf8"));
  state.createClient.mockReturnValue(state.client);
  state.client.listSites.mockResolvedValue([
    { id: "site-1", name: "Acme", domain: "acme.com" },
  ]);
  state.client.getStats.mockResolvedValue({ current: stats, previous: stats });
  state.client.getTimeseries.mockResolvedValue([
    { bucket: "2026-10-01", visitors: 3 },
  ]);
});

describe("PageDuelService", () => {
  it("stores the key encrypted and reads the report with the decrypted key", async () => {
    await PageDuelService.connect({
      projectId: "p1",
      apiKey,
      siteId: "site-1",
    });

    expect(JSON.stringify(rawRow("p1"))).not.toContain(apiKey);

    const report = await PageDuelService.getDashboardReport("p1");

    expect(state.createClient).toHaveBeenLastCalledWith(apiKey);
    const [siteId, range] = state.client.getStats.mock.calls[0];
    expect(siteId).toBe("site-1");
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report).toMatchObject({
      connected: true,
      site: { name: "Acme" },
      trend: [{ date: "2026-10-01", visitors: 3 }],
    });
  });

  it("rejects a site the key cannot see and saves nothing", async () => {
    await expect(
      PageDuelService.connect({ projectId: "p1", apiKey, siteId: "other" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rawRow("p1")).toBeUndefined();
  });

  it("keeps one row on reconnect and disconnect only removes its own project", async () => {
    const connect = (projectId: string) =>
      PageDuelService.connect({ projectId, apiKey, siteId: "site-1" });
    await connect("p1");
    await connect("p1");
    await connect("p2");

    const count = state.database
      ?.prepare("SELECT count(*) AS n FROM pageduel_connections")
      .get();
    expect(count).toEqual({ n: 2 });

    await PageDuelService.disconnect("p1");

    expect(rawRow("p1")).toBeUndefined();
    expect(rawRow("p2")).toBeDefined();
    expect(await PageDuelService.getDashboardReport("p1")).toEqual({
      connected: false,
    });
  });

  it("refuses to connect without BETTER_AUTH_SECRET", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    await expect(
      PageDuelService.connect({ projectId: "p1", apiKey, siteId: "site-1" }),
    ).rejects.toMatchObject({ code: "AUTH_CONFIG_MISSING" });
  });
});
