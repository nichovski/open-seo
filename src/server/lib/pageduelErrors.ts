export type PageDuelErrorCode =
  | "pageduel_not_connected"
  | "pageduel_reconnect_required"
  | "pageduel_plan_required"
  | "pageduel_rate_limited"
  | "pageduel_invalid_request"
  | "pageduel_upstream_unavailable"
  | "pageduel_malformed_response";

export class PageDuelError extends Error {
  constructor(
    public readonly code: PageDuelErrorCode,
    message: string = code,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "PageDuelError";
  }
}
