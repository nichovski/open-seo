# PageDuel connector

**Date:** 2026-11-01 · **Branch:** `feat/pageduel-connector` (base upstream v0.1.22, `1523750b`) · **Author:** Bogdan

## What it does

Each OpenSEO project can connect one [PageDuel](https://pageduel.com) site, the same way it connects Google Analytics.

- **Settings > Integrations > PageDuel:** paste a PageDuel API key (`pd_` + 40 hex), click **Find sites**, pick a site, **Connect**. **Disconnect** removes it.
- **Dashboard card "PageDuel traffic":** visitors, pageviews, conversion rate and revenue for the last 28 complete UTC days, with change against the 28 days before, plus a daily visitors trend. The card is hidden when PageDuel is not connected.
- **MCP tools** (read-only, no OpenSEO credits):
  - `get_pageduel_overview` - the same numbers as the card.
  - `get_pageduel_top_pages` - `dimension` `entry_page` (default, landing pages) or `page` (all pages by pageviews), `limit` 1-50.
  - `get_pageduel_goals` - goals with uniques, total, conversion rate and revenue.
  - All take optional `startDate` and `endDate` (both or neither, real `YYYY-MM-DD` dates, start on or before end). Default: last 28 complete UTC days.

## Why

Bogdan uses PageDuel for analytics on his sites and wants that data next to SEO data in OpenSEO, and available to agents over MCP.

The hard rule for this fork: **it must keep merging upstream OpenSEO releases with few conflicts.** So all PageDuel code lives in new files. Upstream files only get one-line hooks.

## How it works

### Files

New (fork-only):

| Area                 | File                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Table                | `src/db/pageduel.schema.ts`, `src/db/pg/pageduel.schema.ts`, `src/db/pageduel-table.ts`                                  |
| Migrations           | `drizzle/sqlite/0069_pageduel_connections.sql`, `drizzle/pg/0047_pageduel_connections.sql`                               |
| API client + errors  | `src/server/lib/pageduelClient.ts`, `src/server/lib/pageduelErrors.ts`                                                   |
| Repository + service | `src/server/features/pageduel/`                                                                                          |
| Server functions     | `src/serverFunctions/pageduel.ts`                                                                                        |
| UI                   | `src/client/features/integrations/pageduel/PageDuelConnectionCard.tsx`, `src/client/features/dashboard/PageDuelCard.tsx` |
| MCP tools            | `src/server/mcp/tools/pageduel-tools.ts`                                                                                 |

Upstream files touched (hooks only): `DashboardPage.tsx` (+6), `routes/_app/p/$projectId/settings/integrations.tsx` (+5), `db/schema-parity.test.ts` (+4), `db/d1/schema.ts` (+1), `db/pg/schema.ts` (+1), `server/mcp/server.ts` (+2), and the generated drizzle meta journals.

### Data

Table `pageduel_connections`: `project_id` (PK, FK to projects, cascade delete), `site_id`, `site_name`, `site_domain`, `api_key_ciphertext`, `created_at`, `updated_at`. SQLite and Postgres schemas are identical (checked by the schema parity test). The migrations are hand-edited to be idempotent (`CREATE TABLE IF NOT EXISTS`; the Postgres FK is added in a `DO $$ ... duplicate_object` block) so they can be regenerated after an upstream merge (see below).

### API key

- Encrypted with `symmetricEncrypt` from `better-auth/crypto`, keyed by `BETTER_AUTH_SECRET` (same approach as `CrawlerCredentialService`). Without a secret of the minimum length, connecting is blocked and the card says encryption is not configured.
- The ciphertext never leaves `PageDuelService`. The plaintext key is never returned to the browser, logged, or put in errors or MCP output.
- If decryption fails (for example, the secret changed), the user sees "reconnect".

### PageDuel API

- Base URL: env `PAGEDUEL_BASE_URL`, default `https://pageduel.com`, plus `/api/v1`. Bearer auth, 10 s timeout, site id URL-encoded, responses checked with Zod against the `{data, meta}` envelope.
- `listSites` pages with `limit=100` while `hasMore`, at most 10 pages.
- Error mapping:

| Upstream                                           | Code                            |
| -------------------------------------------------- | ------------------------------- |
| 401, 403, 404                                      | `pageduel_reconnect_required`   |
| 402                                                | `pageduel_plan_required`        |
| 429 (+ `Retry-After` seconds or HTTP-date)         | `pageduel_rate_limited`         |
| other 4xx                                          | `pageduel_invalid_request`      |
| 408, 5xx, network error, timeout, failed body read | `pageduel_upstream_unavailable` |
| non-JSON or wrong shape                            | `pageduel_malformed_response`   |

### Server functions and permissions

All use `requireProjectContext`. Listing sites, connecting and disconnecting also need the `integration: manage` permission. Connect checks the chosen site is in the key's site list before saving. Problems the user can fix (`invalid_key`, `no_api_access`, `rate_limited`, `site_not_found`) come back as a `{problem}` result and show under the key field. Real faults still throw.

### MCP registration

`registerPageDuelTools(register)` is called in `createServer` right after `registerOpenSeoTools`, **not inside it**. This keeps the Every App catalog test at 81 tools, so an upstream change to that test does not conflict. Trade-off: the PageDuel tools are not in the Every App catalog.

## Upstream sync

```powershell
git fetch upstream
git merge upstream/main
```

If the drizzle meta files conflict:

1. Take upstream's meta: `git checkout --theirs drizzle/sqlite/meta drizzle/pg/meta`
2. Remove our migrations: `git rm drizzle/sqlite/*_pageduel_connections.sql drizzle/pg/*_pageduel_connections.sql`
3. Regenerate them on top of upstream: `pnpm db:generate:d1 --name pageduel_connections` and `pnpm db:generate:pg --name pageduel_connections`
4. Re-apply the idempotent edits (`IF NOT EXISTS`, the `DO $$ ... duplicate_object` FK block).
5. `pnpm test`, then commit the merge.

D1 sees the new file name and runs it as a no-op, because the table already exists. Postgres: check that the new journal entry's `when` is later than upstream's newest entry.

## Verification (2026-11-01)

- Unit tests: PageDuel client, service and MCP test files (41 files, 255 tests) pass. `tsc` and `oxlint` are clean.
- Full suite on Windows: 4 files fail (`GoogleAccountService`, `googleOAuth`, `googleOAuthMigration`, `samSkills`). They fail the same way on clean upstream `1523750b`, so they are not from this change.
- Browser test with Playwright against a local mock PageDuel API (`AUTH_MODE=local_noauth`, local D1 migrated): wrong key message, plan message, site list, connect, plaintext key not in the page, dashboard card with numbers and change.

## Review

Reviewed by GLM-5.3 Flash and DeepSeek V4 Flash (pi, high thinking) and GPT-6.1 Sol (Codex, medium). No security or authorization findings.

Fixed: real-date and start-before-end checks in the MCP tools; failed body read maps to `upstream_unavailable`; HTTP-date `Retry-After` (reuses `parseRetryAfterMs` from the audit crawler); other 4xx map to `invalid_request` and 408 to `upstream_unavailable`; dashboard card explains a plan without API access; a site removed between "Find sites" and "Connect" shows `site_not_found`.

Not changed, on purpose:

- `updated_at` is set with `sql\`(current_timestamp)\``, which gives a different text format on Postgres. Same as `Ga4ConnectionRepository`.
- The card shows "Connected <created date>", not the last reconnect. Same as the GA4 card.
- MCP tools rethrow errors that are not PageDuel errors (for example, a missing `BETTER_AUTH_SECRET`). The GA4 tools do the same.
- `plan_required` in MCP has no action URL, because Settings cannot fix a plan.
- Only the site check can produce `NOT_FOUND` in the connect path, so mapping it to `site_not_found` is safe.

## Notes

- Not yet tested against the real pageduel.com API (no read API key was available). Do one real connect before relying on it.
- The MCP date validation has no unit test.
- Each dashboard load or overview call makes 2 PageDuel requests (Starter plan: 2000 per day).
- Revenue has no currency.
- The SAM chat does not get the PageDuel tools.
