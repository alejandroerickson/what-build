/**
 * One error shape for both front doors. REST returns `{ error: { code, status, message, details } }`
 * with the status; MCP returns the same JSON in a tool error whose text begins with the status
 * ("422: …"), so an agent and a person see the same failure for the same cause.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return { code: this.code, status: this.status, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const unauthenticated = (message = "Sign in first.") =>
  new AppError(401, "unauthenticated", message);

export const forbidden = (message: string, details?: Record<string, unknown>) =>
  new AppError(403, "forbidden", message, details);

export const notFound = (message: string, details?: Record<string, unknown>) =>
  new AppError(404, "not_found", message, details);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);

export const gone = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(410, code, message, details);

export const tooLarge = (message: string, details?: Record<string, unknown>) =>
  new AppError(413, "too_large", message, details);

export const invalid = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(422, code, message, details);

export const rateLimited = (message: string, details?: Record<string, unknown>) => new AppError(429, "rate_limited", message, details);

export function staleEtag(current: string, what = "item") {
  return conflict(
    "stale_etag",
    `This ${what} changed since you read it. Read it again, reconcile, and retry with the new etag.`,
    { current_etag: current },
  );
}
