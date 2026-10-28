import * as Sentry from "@sentry/nextjs";

// Thin chokepoint for CAUGHT failures — unhandled errors already
// reach Sentry via instrumentation.ts's onRequestError / the browser
// SDK. Event-stream contract (see AGENTS.md "Sentry event streams"):
// level:error = the agent-fixable bug queue; provider outages stay
// at warning so they never land in it.
// No-op by construction when no DSN is configured (Sentry.init
// never ran).

/**
 * Unexpected internal bug — level error, lands in the fix queue.
 * Wire into catch blocks that log a failure and keep going.
 */
export function captureInternalException(exc: unknown): void {
  Sentry.captureException(exc, {
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
  Sentry.captureException(exc, {
    level: "warning",
    tags: { error_code: code },
  });
}
