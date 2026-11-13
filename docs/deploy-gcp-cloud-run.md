# Deploy NibrasTube to GCP Cloud Run

A provisioning script sets up all GCP resources and GitHub Actions
secrets; every push to `main` then deploys automatically.

```
push to main
  └─> GitHub Actions (Workload Identity Federation — no SA keys)
        ├─> docker build ──> push to Artifact Registry
        ├─> gcloud run deploy (min-instances=0 → scales to zero)
        └─> delete old images (keep latest 2)

Cloud Run ──TLS──> Neon Postgres (pooled DATABASE_URL)
```

## Role: backup deployment

**Vercel (`redzi.vercel.app`) is the primary production deploy.** The
Cloud Run service is a standby for Vercel outages — same `main`
branch, same Neon DB, deployed in parallel by
`.github/workflows/deploy.yml`. On a Vercel outage, point users at
the `*.run.app` URL and flip GitHub var `APP_URL` to move the
Capacitor APK over. In normal operation `APP_URL` stays on Vercel.

## Runtime config: one ENV_FILE var

The whole `.env` is shipped as a **single env var** `ENV_FILE` (a GitHub
secret for CI, `--env-vars-file` for manual deploys). At container start
`docker-entrypoint.sh` writes it to `/tmp/.env.runtime` and
`docker-load-env.cjs` (preloaded via `node --require`) populates
`process.env` before any app module is imported — necessary because
`lib/db` / `lib/pusher` read env at module scope and standalone
`server.js` does not load dotenv files itself. No Secret Manager — zero
per-secret cost and one place to update config.

`NEXT_PUBLIC_*` vars are inlined at **build** time — they are Docker
`--build-arg`s (`NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`,
`NEXT_PUBLIC_SENTRY_DSN`), not runtime env vars. The Sentry DSN lives
in the `NEXT_PUBLIC_SENTRY_DSN` GitHub **variable** (DSNs are public)
and must also be uncommented in `.env`/`ENV_FILE` so server-side
instrumentation sees it at runtime.

## Prerequisites

- [gcloud SDK](https://cloud.google.com/sdk/docs/install) + [gh CLI],
  both authenticated
- A GCP project with **billing linked** (current: `nibrastube-app`)
- A populated `.env` in the repo root (Neon `DATABASE_URL`,
  `DATABASE_URL_UNPOOLED`, `JWT_SECRET`, `YOUTUBE_API_KEY`, `PUSHER_*`,
  `NEXT_PUBLIC_PUSHER_*`, …)

## Provision (+ optional deploy)

```bash
./scripts/gcp-setup.sh            # provision only
./scripts/gcp-setup.sh --deploy   # provision + Cloud Build image + deploy
```

Idempotent. It will:

- enable `run`, `artifactregistry`, `cloudbuild`, `iamcredentials`,
  `sts`, `cloudresourcemanager` APIs
- create the `nibrastube` Artifact Registry repo + a cleanup policy
  (delete images older than 1 day, always keep newest 2)
- create the `github-deploy` service account
  (`run.admin`, `artifactregistry.writer`, `iam.serviceAccountUser`)
- create a Workload Identity pool + OIDC provider restricted to
  `Ted-Rose/nibrastube`
- push GitHub **variables** (`GCP_PROJECT_ID`, `GCP_REGION`,
  `NEXT_PUBLIC_PUSHER_CLUSTER`) and **secrets** (`WIF_PROVIDER`,
  `WIF_SERVICE_ACCOUNT`, `NEXT_PUBLIC_PUSHER_KEY`, `ENV_FILE`)

Optional overrides: `GCP_PROJECT_ID`, `GCP_REGION`, `GITHUB_REPO`.

## Manual deploy (no CI)

```bash
IMAGE=europe-west1-docker.pkg.dev/nibrastube-app/nibrastube/nibrastube:latest

gcloud builds submit --config cloudbuild.yaml \
  --project nibrastube-app \
  --substitutions="_IMAGE=$IMAGE,_NEXT_PUBLIC_PUSHER_KEY=$(grep '^NEXT_PUBLIC_PUSHER_KEY=' .env | cut -d= -f2-),_NEXT_PUBLIC_PUSHER_CLUSTER=eu,_NEXT_PUBLIC_SENTRY_DSN=$(grep '^NEXT_PUBLIC_SENTRY_DSN=' .env | cut -d= -f2-)"

{ echo "ENV_FILE: |"; sed 's/^/  /' .env; } > /tmp/env.yaml
gcloud run deploy nibrastube --project nibrastube-app --region europe-west1 \
  --image "$IMAGE" \
  --allow-unauthenticated --min-instances=0 --max-instances=1 \
  --memory=512Mi --cpu=1 --concurrency=80 \
  --env-vars-file /tmp/env.yaml
```

Get the URL:

```bash
gcloud run services describe nibrastube \
  --project nibrastube-app --region europe-west1 --format='value(status.url)'
```

## Free-tier guardrails

| Resource | Free limit | Guardrail |
| --- | --- | --- |
| Cloud Run | 2M req/mo, 180k vCPU-s, 360k GiB-s | `min=0`, `max=1`, 512Mi/1vCPU, CPU-allocated-only-during-requests |
| Artifact Registry | 0.5 GB | keep ≤2 images (CI delete + 1-day policy) |
| Cloud Build | 120 build-min/day | ~5 min/build |
| GH Actions | free on public repos | ~3 min/deploy |

## Notes

- Updating runtime config: edit `.env`, re-run `gh secret set ENV_FILE
  --repo Ted-Rose/nibrastube < .env`, redeploy.
- A custom domain later needs `serverActions.allowedOrigins` in
  `next.config.mjs`; `*.run.app` works out of the box.
- Cloud Run reaches Neon over the public internet — the pooled
  `DATABASE_URL` already carries `sslmode=require`.
