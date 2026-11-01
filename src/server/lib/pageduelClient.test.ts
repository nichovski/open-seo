import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageDuelClient } from "@/server/lib/pageduelClient";

const range = { from: "2026-10-01", to: "2026-10-28" };
const stats = { visitors: 10, pageviews: 20, conversionRate: 0.1, revenue: 5 };

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createPageDuelClient", () => {
  it("calls the default base URL with the bearer key and parses stats with previous", async () => {
    const fetchMock = stubFetch(
      json({ data: stats, meta: { previous: { ...stats, visitors: 4 } } }),
    );

    const result = await createPageDuelClient("pd_key").getStats(
      "site 1",
      range,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://pageduel.com/api/v1/sites/site%201/stats?from=2026-10-01&to=2026-10-28",
    );
    expect(init?.headers).toEqual({ Authorization: "Bearer pd_key" });
    expect(result.current.visitors).toBe(10);
    expect(result.previous.visitors).toBe(4);
  });

  it("pages listSites until hasMore is false", async () => {
    const site = { id: "a", name: "A", domain: "a.com" };
    const fetchMock = stubFetch(
      json({ data: [site], meta: { pagination: { hasMore: true } } }),
      json({
        data: [{ ...site, id: "b" }],
        meta: { pagination: { hasMore: false } },
      }),
    );

    const sites = await createPageDuelClient("k").listSites();

    expect(sites.map((s) => s.id)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "pageduel_reconnect_required"],
    [402, "pageduel_plan_required"],
    [500, "pageduel_upstream_unavailable"],
  ])("maps HTTP %i to %s", async (status, code) => {
    stubFetch(new Response("{}", { status }));
    await expect(
      createPageDuelClient("k").getGoals("s", range),
    ).rejects.toMatchObject({ code });
  });

  it("maps 429 to rate_limited with retryAfterSeconds", async () => {
    stubFetch(
      new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
    );
    await expect(
      createPageDuelClient("k").getGoals("s", range),
    ).rejects.toMatchObject({
      code: "pageduel_rate_limited",
      retryAfterSeconds: 30,
    });
  });

  it("maps a body that fails the schema to malformed_response", async () => {
    stubFetch(json({ data: { visitors: "many" }, meta: {} }));
    await expect(
      createPageDuelClient("k").getStats("s", range),
    ).rejects.toMatchObject({ code: "pageduel_malformed_response" });
  });

  it("reads an HTTP-date retry-after as seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    const at = "Sun, 01 Nov 2026 10:01:00 GMT";
    stubFetch(
      new Response("{}", { status: 429, headers: { "retry-after": at } }),
    );
    await expect(
      createPageDuelClient("k").getGoals("s", range),
    ).rejects.toMatchObject({
      code: "pageduel_rate_limited",
      retryAfterSeconds: 60,
    });
  });

  it("maps other 4xx to invalid_request", async () => {
    stubFetch(new Response("{}", { status: 422 }));
    await expect(
      createPageDuelClient("k").getGoals("s", range),
    ).rejects.toMatchObject({ code: "pageduel_invalid_request" });
  });

  it("maps a failed body read to upstream_unavailable", async () => {
    const response = new Response("{}");
    vi.spyOn(response, "text").mockRejectedValue(new TypeError("aborted"));
    stubFetch(response);
    await expect(
      createPageDuelClient("k").getGoals("s", range),
    ).rejects.toMatchObject({ code: "pageduel_upstream_unavailable" });
  });

  it("maps a non-JSON body to malformed_response", async () => {
    stubFetch(new Response("<html>"));
    await expect(
      createPageDuelClient("k").getGoals("s", range),
    ).rejects.toMatchObject({ code: "pageduel_malformed_response" });
  });
});
