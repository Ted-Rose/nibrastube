import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// withSentryConfig lives in the /config subpath since SDK v11 —
// the package root only exports the runtime API.
import { withSentryConfig } from "@sentry/nextjs/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for the Docker/Cloud Run deploy (see Dockerfile).
  output: "standalone",
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Client router cache: a visited route's RSC payload stays reusable
    // for 5 min, so back-and-forth feed navigation and tab/sort switches
    // skip the server round trip. router.refresh() (Pusher events) and
    // revalidatePath/revalidateTag always bypass it.
    staleTimes: { dynamic: 300 },
  },
}

// Safe without SENTRY_AUTH_TOKEN — sourcemap upload and release
// creation are skipped when the token is unset.
export default withSentryConfig(nextConfig, {
  org: "nibrastube-a2",
  project: "nibrastube-app",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
})
