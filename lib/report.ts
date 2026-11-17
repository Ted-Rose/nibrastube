import * as Sentry from "@sentry/nextjs";

// Thin chokepoint for CAUGHT failures — unhandled errors already
// reach Sentry via instrumentation.ts's onRequestError / the browser
// SDK. Event-stream contract (see AGENTS.md "Sentry event streams"):
// level:error = the agent-fixable bug queue; provider outages stay
// at warning so they never land in it.
// No-op by construction when no DSN is configured (Sentry.init
// never ran).

// Axios errors own `config`/`request`/`response` objects that Sentry
// serializes into event extras — `config.params.key` is the
// YOUTUBE_API_KEY and the request URL echoes `?key=…`. Detect the
// shape without importing axios (this module ships to the browser
// via pusher-listener) and wrap it in a credential-free Error that
// keeps name, message, HTTP status/code and stack.
function sanitizeForCapture(exc: unknown): unknown {
  if (
    typeof exc !== "object" ||
    exc === null ||
    !(exc as { isAxiosError?: boolean }).isAxiosError
  ) {
    return exc;
  }
  const err = exc as Error & {
    code?: string;
    response?: { status?: number };
  };
  const detail = [
    err.response?.status ? `HTTP ${err.response.status}` : null,
    err.code,
  ]
    .filter(Boolean)
    .join(", ");
  const safe = new Error(
    detail ? `${err.message} (${detail})` : err.message
  );
  safe.name = err.name;
  safe.stack = err.stack;
  return safe;
}

/**
 * Unexpected internal bug — level error, lands in the fix queue.
 * Wire into catch blocks that log a failure and keep going.
 */
export function captureInternalException(exc: unknown): void {
  Sentry.captureException(sanitizeForCapture(exc), {
    level: "error",
    tags: { error_code: "internal_error" },
  });
}

/**
 * Expected upstream failure (YouTube quota, provider outage) —
 * level warning, trend-only stream. `code` is the error_code tag:
 * rate_limited for quota aborts, provider_error for other outages.
 */
export function captureProviderException(
  exc: unknown,
  code: "rate_limited" | "provider_error"
): void {
  Sentry.captureException(sanitizeForCapture(exc), {
    level: "warning",
    tags: { error_code: code },
  });
}
