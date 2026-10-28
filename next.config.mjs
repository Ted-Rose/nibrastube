// withSentryConfig lives in the /config subpath since SDK v11 —
// the package root only exports the runtime API.
import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {}

// Safe without SENTRY_AUTH_TOKEN — sourcemap upload and release
// creation are skipped when the token is unset.
export default withSentryConfig(nextConfig, {
  org: "nibrastube-a2",
  project: "nibrastube-app",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
})
