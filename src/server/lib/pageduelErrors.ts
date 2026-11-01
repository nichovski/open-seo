const MESSAGES = {
  pageduel_not_connected: "PageDuel is not connected to this project.",
  pageduel_reconnect_required:
    "PageDuel rejected the saved API key or site. Reconnect PageDuel.",
  pageduel_plan_required: "The PageDuel plan does not include API access.",
  pageduel_rate_limited: "PageDuel rate limit reached. Try again later.",
  pageduel_invalid_request: "PageDuel rejected the request.",
  pageduel_upstream_unavailable: "PageDuel is temporarily unavailable.",
  pageduel_malformed_response: "PageDuel returned an unexpected response.",
} as const;

type PageDuelErrorCode = keyof typeof MESSAGES;

export class PageDuelError extends Error {
  constructor(
    public readonly code: PageDuelErrorCode,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(MESSAGES[code]);
    this.name = "PageDuelError";
  }
}
