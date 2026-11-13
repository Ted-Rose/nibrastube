import * as Sentry from "@sentry/nextjs";

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
        environment:
          process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
          process.env.VERCEL_ENV ??
          "development",
        release:
          process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
          process.env.VERCEL_GIT_COMMIT_SHA ??
          undefined,
        tracesSampleRate: 0.1,
      });
    }
  }
}

// Captures nested RSC/route errors Next renders as digest-only 500s.
export const onRequestError = Sentry.captureRequestError;
