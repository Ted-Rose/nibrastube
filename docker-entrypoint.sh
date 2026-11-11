#!/bin/sh
# Container entrypoint for the Cloud Run deploy.
#
# Runtime config arrives as ONE env var — ENV_FILE holds the entire dotenv
# payload (set via `gcloud run deploy --env-vars-file`, see
# docs/deploy-gcp-cloud-run.md). Standalone `node server.js` does not load
# .env files itself, so we materialize the payload and preload
# docker-load-env.cjs, which populates process.env BEFORE any app module
# runs (lib/db and lib/pusher read env at import time).
set -eu

ENV_FILE_PATH="${ENV_FILE_PATH:-/tmp/.env.runtime}"
export ENV_FILE_PATH

if [ -n "${ENV_FILE:-}" ]; then
  printf '%s\n' "$ENV_FILE" > "$ENV_FILE_PATH"
fi

exec node --require /app/docker-load-env.cjs server.js
