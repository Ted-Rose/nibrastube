import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

// Web noise dropped before it burns event quota — stale chunks after
// a deploy, ResizeObserver loops. Matched against event.message AND
// exception.values[0].value: GlobalHandlers' onerror path produces
// message-only events with no Error instance.
const DROP_PATTERNS = [
  /^ChunkLoadError/,
  /Loading chunk \d+ failed/,
  /Loading CSS chunk/,
  /ResizeObserver loop/,
];

// TypeError network failures ("Failed to fetch", Safari's "Load
// failed", Firefox's NetworkError) are availability signals, not
// bugs — kept but tagged so they're searchable apart from real
// errors.
const NETWORK_RE = /failed to fetch|load failed|networkerror/i;

function sentryBeforeSend(
  event: ErrorEvent,
  hint: EventHint
): ErrorEvent | null {
  const err = hint.originalException;

  // Real aborts surface as DOMExceptions, which are not Error
  // subclasses — check both. Routine fetch cancellation (navigation
  // races, superseded beacons) is not a bug.
  if (
    (err instanceof Error || err instanceof DOMException) &&
    err.name === "AbortError"
  ) {
    return null;
  }

  const texts = [
    event.message,
    event.exception?.values?.[0]?.value,
    err instanceof Error ? err.message : undefined,
    err instanceof DOMException ? err.message : undefined,
  ];
  if (texts.some((t) => t && DROP_PATTERNS.some((p) => p.test(t)))) {
    return null;
  }

  if (err instanceof TypeError && NETWORK_RE.test(err.message)) {
    event.tags = { ...event.tags, errorKind: "network" };
  }

  // Sentry's GlobalHandlers captures unhandled rejections before any
  // tagged captureException — Dedupe then drops the tagged copy,
  // taking the `context` tag with it. Re-apply on the surviving
  // event.
  const mechanism = event.exception?.values?.[0]?.mechanism?.type;
  if (
    mechanism === "onunhandledrejection" &&
    event.tags?.context === undefined
  ) {
    event.tags = {
      ...event.tags,
      context: "Unhandled promise rejection",
    };
  }

  return event;
}

// DSN-gated: no NEXT_PUBLIC_SENTRY_DSN → the SDK never initializes →
// zero traffic in dev, tests and unconfigured builds.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Free tier ~= 50 replays/mo: record only sessions that hit an
      // error (0 ambient sampling, 1.0 on-error). Text and media are
      // masked — kids' viewing data is private.
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    tracesSampleRate: 0.1,
    beforeSend: sentryBeforeSend,
  });
}
