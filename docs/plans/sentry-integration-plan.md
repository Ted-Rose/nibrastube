# Sentry integration — nibrastube

Status: in progress — Sentry provisioning DONE 2026-10-28.
  Org `nibrastube-a2` (EU, de.sentry.io) holds `nibrastube-app`
  with DSN, web inbound filters, org data-scrubbing and a
  production level:error email workflow. Key rate-limit calls
  no-op on this org (`rate-limits` feature not enabled on
  new-org plans). `NEXT_PUBLIC_SENTRY_DSN` still needs adding
  to the `redzi` Vercel project env. Code changes below not
  implemented.
Date: 2026-10-28
Standard: `Bible Research/docs/plans/sentry-integration-standard.md`
Reviewed-by: independent repo audit 2026-10-28 — corrections
  folded in (@sentry/nextjs >=10.13.0 for Turbopack,
  NEXT_RUNTIME guard, .env-stubs claim unverifiable).

## What this is

Add DSN-gated Sentry monitoring to the Next.js app, following
the workspace playbook. One deployable — Next.js 16 SSR
(Turbopack) on Vercel (project `redzi`, prod
`https://redzi.vercel.app` — verify the project name in the
dashboard; not recorded in-repo) — covering BOTH browser and
Node.js server runtimes in a single Sentry project.

Deploy surfaces (verified): no Dockerfile/railway/fly/render
config — Vercel is the ONLY web deploy. The Capacitor APK loads
the remote URL in a WebView (`android-release.yml` only runs
`cap sync`, no `next build`, `CAPACITOR_SERVER_URL` is the only
env), so the browser SDK covers Android for free — no bundled
web build → no `android`/`android-debug` environments needed.

Sentry org: **`nibrastube-a2`** (EU, de.sentry.io — one org per
product; the clean `nibrastube` slug was taken by a US org
created during provisioning). Project:

- `nibrastube-app` — platform `javascript-nextjs`.

Environment: `NEXT_PUBLIC_VERCEL_ENV` client-side /
`VERCEL_ENV` server-side (Vercel auto-exposes system env vars;
requires the default-on "Expose System Environment Variables"
project setting). Local dev reports `development`, previews
`preview` — both stay out of the prod queue.
Release: `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` /
`VERCEL_GIT_COMMIT_SHA` → `resolvedInNextRelease` resolves at
the next deploy.

## Provisioning (Sentry REST API)

DONE 2026-10-28 — recorded for repeatability. Org `nibrastube-a2`
was created by the user in the Sentry web UI (EU region picker —
the API only creates US orgs); team slug `nibrastube`. Token:
`source ~/.config/devin/sentry.env` (SENTRY_API_TOKEN).

```bash
BASE="https://de.sentry.io/api/0"
AUTH="Authorization: Bearer $SENTRY_API_TOKEN"
ORG="nibrastube-a2"; TEAM="nibrastube"

curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"nibrastube-app","platform":"javascript-nextjs"}' \
  "$BASE/teams/$ORG/$TEAM/projects/"
curl -s -H "$AUTH" "$BASE/projects/$ORG/nibrastube-app/keys/"

# DSN abuse protection (NESTED object — flat fields silently no-op):
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"rateLimit":{"window":3600,"count":100}}' \
  "$BASE/projects/$ORG/nibrastube-app/keys/<key_id>/"

# Browser-facing project → web-noise inbound filters ON:
for f in browser-extensions web-crawlers legacy-browsers localhost; do
  curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"active":true}' \
    "$BASE/projects/$ORG/nibrastube-app/filters/$f/"
done

# Org-level scrubbing (replicate the bible-research settings):
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"dataScrubber":true,"sensitiveFields":["password","token",
  "authorization","api_key","secret","access_token",
  "refresh_token","session","csrftoken"]}' \
  "$BASE/organizations/$ORG/"

# Alert: POST $BASE/organizations/$ORG/workflows/ — same shape as
# the other products: triggers first_seen_event + regression_event;
# filters environment eq production AND level eq error; email
# action; detectorIds=[<auto "Issue Stream" detector id>].
# Verified working payload on 2026-10-28.
```

Note: key `rateLimit` PUTs silently no-op on this org (the
`rate-limits` feature isn't enabled on new-org plans). Also fix
`SENTRY_ORG=nibrastube-a2` in the Vercel env list below — the
org slug matters for sourcemap uploads.

## Env wiring

- Vercel project `redzi` env vars (Production scope; dashboard or
  REST API — no vercel CLI installed):
  - `NEXT_PUBLIC_SENTRY_DSN` — required, reaches the browser
    bundle AND the Node runtime init.
  - `SENTRY_AUTH_TOKEN`, `SENTRY_ORG=nibrastube-a2`,
    `SENTRY_PROJECT=nibrastube-app` — OPTIONAL, enables sourcemap
    upload + release creation at build; the token is
    release-upload scoped, separate from `SENTRY_API_TOKEN`. EU
    region needs `SENTRY_URL=https://de.sentry.io` or uploads 401.
- Local `.env`: `.env` is gitignored and has no committed
  `.env.example` — document the new vars in AGENTS.md's env-var
  list (the earlier "commented stubs already exist" claim could
  not be verified).

## Code changes

- `npm i @sentry/nextjs` — **>= 10.13.0** (first release with
  Turbopack sourcemap upload support; `next build` is Turbopack
  by default in Next 16).
- `instrumentation-client.ts` (repo root — Next 15+/16
  convention, no `src/` dir): `Sentry.init` gated on
  `NEXT_PUBLIC_SENTRY_DSN`; `browserTracingIntegration` +
  `replayIntegration({maskAllText:true, blockAllMedia:true})`;
  `replaysSessionSampleRate:0` + `replaysOnErrorSampleRate:1.0`
  (only config that fits the ~50/mo free replay tier);
  `tracesSampleRate:0.1`; `environment`:
  `process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development'`;
  `release`: `process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  undefined` (never `''`).
  `beforeSend` drop list: `AbortError` (Error OR DOMException),
  `ChunkLoadError`/`Loading chunk \d+ failed`/`Loading CSS chunk`
  (match `event.message` + `exception.values[0].value` —
  GlobalHandlers' onerror path is message-only), `ResizeObserver
  loop`; `TypeError` network failures tagged `errorKind:network`
  not dropped; re-apply `context` on `onunhandledrejection`.
- `instrumentation.ts` (repo root):
  `export function register()` — guard `if
  (process.env.NEXT_RUNTIME === 'nodejs')` before the Node
  `Sentry.init` (same DSN env var works server-side; add an
  `'edge'` branch only if edge runtime is ever adopted);
  `export const onRequestError = Sentry.captureRequestError`
  (SDK >= 8.28) — captures nested RSC/route/middleware errors
  Next renders as digest-only 500s. `proxy.ts` errors are Node
  runtime → covered; do NOT create a `middleware.ts`.
- `app/global-error.tsx` (new — catches root-layout render
  crashes): `'use client'` + `Sentry.captureException` in
  `useEffect` + minimal fallback UI — it replaces the root
  layout so it needs its own `<html>/<body>`.
- `next.config.mjs` → `withSentryConfig(nextConfig, {
  org:'nibrastube-a2', project:'nibrastube-app',
  authToken:process.env.SENTRY_AUTH_TOKEN, silent:true })` —
  safe without the token (upload skipped).
- `lib/report.ts` (new) — the thin chokepoint for CAUGHT
  failures, matching the playbook's explicit-capture allowlist:
  - `captureInternalException(exc)` — level error, tag
    `error_code:internal_error`; wire into unexpected-failure
    catch blocks (`app/api/sync-channels/route.ts` `after()`
    catch, watch-progress writes).
  - `captureProviderException(exc, code)` — level warning, tag
    `error_code` in {`rate_limited`, `provider_error`}; natural
    call sites: `lib/youtube.ts` quota/HTTP failures and
    `lib/channel-sync.ts:275` (YouTube quota aborts a run early
    — trend-only stream, never in the fix queue).
  - Keep `lib/notify.ts` (Telegram) as the human-alert channel;
    optionally include the Sentry event id in the Telegram text.
- No CORS work: client calls are same-origin (`sentry-trace`/
  `baggage` propagation to the Node runtime is automatic).
- `public/sw.js` exists (PWA cache-first for `/_next/static`):
  Sentry ingest is cross-origin → passes through; note for
  completeness. Ad-blockers do list `ingest.*.sentry.io` —
  acceptable for a family app; the SDK's `tunnel` option is the
  escape hatch if reports look thin.

## Event-stream contract (document in AGENTS.md, incl. the new
env vars in its env-var list)

`is:unresolved level:error environment:production` = agent-fixable
bugs only:

| Stream | Transport | Level | Tag |
|---|---|---|---|
| Client exceptions | captureException / global-error | error | — |
| Server/RSC crashes | onRequestError + runtime init | error | — |
| Caught server bugs | captureInternalException | error |
  `error_code:internal_error` |
| YouTube quota/outages | captureProviderException | warning |
  `error_code:{rate_limited,provider_error}` |

Logs stay console/Vercel logs — no logging integration events.

## Verification

- `npm run typecheck && npm run lint && npm run build` (no test
  suite — build is the infra-level gate).
- No DSN → all capture calls no-op.
- After deploy: `GET .../nibrastube-app/issues/` shows a real
  event; force a preview error to confirm `environment:preview`
  tagging.
- Phase 2: port `.devin/skills/fix-sentry-issue-*` from Bible
  Research adapted to this repo (org `nibrastube`); all `gh`
  operations target `Ted-Rose/nibrastube`.
