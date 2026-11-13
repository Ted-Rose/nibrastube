import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// withSentryConfig lives in the /config subpath since SDK v11 —
// the package root only exports the runtime API.
import { withSentryConfig } from "@sentry/nextjs/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output exists only for the Docker/Cloud Run image — the
  // Dockerfile sets DOCKER_BUILD=1. On Vercel it would confuse function
  // tracing, so it stays off there.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
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
  // Cache headers apply on both deploy targets (Vercel + Cloud Run).
  async headers() {
    return [
      {
        // public/icons/* only changes when generate-icons.mjs reruns —
        // safe to cache effectively forever.
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The service worker must always revalidate so PWA updates ship.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        // app/manifest.ts emits /manifest.webmanifest.
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ]
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
