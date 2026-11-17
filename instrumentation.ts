import * as Sentry from "@sentry/nextjs";

// Server-side credential hygiene. CAUGHT YouTube failures are
// sanitized in lib/report.ts, but uncaught errors reach Sentry raw
// via onRequestError — an AxiosError serializes `config.params.key`
// (the YOUTUBE_API_KEY) and its `?key=` URL into event extras, and
// notifyAdmin embeds TELEGRAM_BOT_TOKEN in the fetch path, which
// query-param filtering never touches. Scrubbing the serialized
// payload covers every field an SDK integration might populate
// (extras, contexts, request.url, span data, breadcrumbs) without
// having to know the shape.
const SENTRY_SECRETS = [
  process.env.YOUTUBE_API_KEY,
  process.env.TELEGRAM_BOT_TOKEN,
].filter((s): s is string => !!s && s.length >= 8);

// Telegram bot tokens in URL paths — catches the token even if it
// rotates and this process is still running on the old env value.
const TELEGRAM_TOKEN_RE = /bot[0-9]+:[A-Za-z0-9_-]+/g;

// beforeSend/beforeSendSpan/beforeBreadcrumb all funnel here. The
// payload is already normalized plain data at send time, so a JSON
// round-trip is lossless; the try/catch guarantees a scrub failure
// can never break event delivery.
function scrubSecrets<T>(payload: T): T {
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return payload;
  }
  json = json.replace(TELEGRAM_TOKEN_RE, "bot[redacted]");
  for (const secret of SENTRY_SECRETS) {
    json = json.split(secret).join("[redacted]");
  }
  return JSON.parse(json) as T;
}

export function register() {
  // Only the Node.js runtime is in use (proxy.ts runs there too —
  // its errors are covered by onRequestError). Add an "edge" branch
  // if the edge runtime is ever adopted.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Same NEXT_PUBLIC_ DSN reaches the server bundle; absent DSN =
    // no init = no traffic.
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        // NEXT_PUBLIC_SENTRY_* are baked into the Cloud Run image
        // env (Dockerfile runner stage); VERCEL_* cover Vercel.
        // Unset build args bake in as "", so `||` (not `??`) is
        // required to fall through to the defaults.
        environment:
          process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
          process.env.VERCEL_ENV ||
          "development",
        release:
          process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
          process.env.VERCEL_GIT_COMMIT_SHA ||
          undefined,
        tracesSampleRate: 0.1,
        beforeSend: scrubSecrets,
        // `beforeSendTransaction` is ignored under the default
        // 'stream' trace lifecycle in SDK v11 — `beforeSendSpan` is
        // the hook that sees each streamed span (url.full data).
        beforeSendSpan: scrubSecrets,
        beforeBreadcrumb: scrubSecrets,
      });
    }
  }
}

// Captures nested RSC/route errors Next renders as digest-only 500s.
export const onRequestError = Sentry.captureRequestError;
