#!/usr/bin/env bash
# Idempotent GCP + GitHub provisioning for deploying nibrastube to Cloud Run.
#
# Usage:
#   ./scripts/gcp-setup.sh            # provision infra + GitHub secrets
#   ./scripts/gcp-setup.sh --deploy   # also build (Cloud Build) + deploy
#
# Runtime config strategy: the ENTIRE .env file is shipped as one GitHub
# secret (ENV_FILE) / one Cloud Run env var; docker-entrypoint.sh writes it
# to a file and docker-load-env.cjs populates process.env at boot. No
# Secret Manager usage — zero per-secret cost, one place to update config.
#
# Env vars honored (fall back to values parsed from .env in repo root):
#   NEXT_PUBLIC_PUSHER_KEY      (docker --build-arg, client-bundle inline)
#   NEXT_PUBLIC_PUSHER_CLUSTER  (docker --build-arg; defaults to PUSHER_CLUSTER)
# Optional:
#   GCP_PROJECT_ID (default nibrastube-app)
#   GCP_REGION     (default europe-west1)
#   GITHUB_REPO    (default Ted-Rose/nibrastube)
set -euo pipefail

GCP_PROJECT_ID="${GCP_PROJECT_ID:-nibrastube-app}"
GCP_REGION="${GCP_REGION:-europe-west1}"
GITHUB_REPO="${GITHUB_REPO:-Ted-Rose/nibrastube}"
AR_REPO="nibrastube"
SERVICE_NAME="nibrastube"
CI_SA_NAME="github-deploy"
WIF_POOL="github-pool"
WIF_PROVIDER_NAME="github"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
POLICY_FILE="$ROOT/cleanup-policy.json"
BUILD_FILE="$ROOT/cloudbuild.yaml"

# --- Inputs -------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found — it is the runtime config payload." >&2
  exit 1
fi

# Extract a value from .env without sourcing it (values are not
# POSIX-quote-safe).
dotenv_get() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-
}

NEXT_PUBLIC_PUSHER_KEY="${NEXT_PUBLIC_PUSHER_KEY:-$(dotenv_get NEXT_PUBLIC_PUSHER_KEY)}"
NEXT_PUBLIC_PUSHER_CLUSTER="${NEXT_PUBLIC_PUSHER_CLUSTER:-$(dotenv_get NEXT_PUBLIC_PUSHER_CLUSTER)}"
NEXT_PUBLIC_PUSHER_CLUSTER="${NEXT_PUBLIC_PUSHER_CLUSTER:-$(dotenv_get PUSHER_CLUSTER)}"

if [ -z "$NEXT_PUBLIC_PUSHER_KEY" ]; then
  echo "ERROR: NEXT_PUBLIC_PUSHER_KEY missing (env and $ENV_FILE)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# --- Billing check ------------------------------------------------------------

BILLING="$(gcloud billing projects describe "$GCP_PROJECT_ID" \
  --format='value(billingAccountName)' 2>/dev/null || true)"
if [ -z "$BILLING" ]; then
  echo "ERROR: project $GCP_PROJECT_ID has no billing account linked." >&2
  echo "       Link one at https://console.cloud.google.com/billing/linkedaccount?project=$GCP_PROJECT_ID" >&2
  exit 1
fi

# --- Enable APIs ----------------------------------------------------------------

echo "==> Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="$GCP_PROJECT_ID"

PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" \
  --format='value(projectNumber)')"
CI_SA_EMAIL="$CI_SA_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com"
POOL_RES="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$WIF_POOL"
PROVIDER_RES="$POOL_RES/providers/$WIF_PROVIDER_NAME"

# --- Artifact Registry ----------------------------------------------------------

echo "==> Artifact Registry repo"
if ! gcloud artifacts repositories describe "$AR_REPO" \
  --location="$GCP_REGION" --project="$GCP_PROJECT_ID" &>/dev/null; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker --location="$GCP_REGION" \
    --project="$GCP_PROJECT_ID"
fi
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" \
  --location="$GCP_REGION" --project="$GCP_PROJECT_ID" \
  --policy="$POLICY_FILE"

# --- CI service account ---------------------------------------------------------

echo "==> CI service account: $CI_SA_EMAIL"
if ! gcloud iam service-accounts describe "$CI_SA_EMAIL" \
  --project="$GCP_PROJECT_ID" &>/dev/null; then
  gcloud iam service-accounts create "$CI_SA_NAME" \
    --display-name="GitHub Actions deploy" --project="$GCP_PROJECT_ID"
fi
for role in roles/run.admin roles/artifactregistry.writer \
  roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:$CI_SA_EMAIL" --role="$role" \
    --quiet >/dev/null
done

# --- Workload Identity Federation -------------------------------------------------

echo "==> Workload Identity Federation"
if ! gcloud iam workload-identity-pools describe "$WIF_POOL" \
  --location=global --project="$GCP_PROJECT_ID" &>/dev/null; then
  gcloud iam workload-identity-pools create "$WIF_POOL" \
    --location=global --project="$GCP_PROJECT_ID" \
    --display-name="GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_NAME" \
  --workload-identity-pool="$WIF_POOL" --location=global \
  --project="$GCP_PROJECT_ID" &>/dev/null; then
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_NAME" \
    --workload-identity-pool="$WIF_POOL" --location=global \
    --project="$GCP_PROJECT_ID" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$GITHUB_REPO'"
fi

gcloud iam service-accounts add-iam-policy-binding "$CI_SA_EMAIL" \
  --project="$GCP_PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/$POOL_RES/attribute.repository/$GITHUB_REPO" \
  --quiet >/dev/null

# --- GitHub variables/secrets -------------------------------------------------------

echo "==> GitHub repo $GITHUB_REPO"
gh variable set GCP_PROJECT_ID --repo "$GITHUB_REPO" --body "$GCP_PROJECT_ID"
gh variable set GCP_REGION --repo "$GITHUB_REPO" --body "$GCP_REGION"
gh variable set NEXT_PUBLIC_PUSHER_CLUSTER --repo "$GITHUB_REPO" \
  --body "$NEXT_PUBLIC_PUSHER_CLUSTER"
gh secret set WIF_PROVIDER --repo "$GITHUB_REPO" --body "$PROVIDER_RES"
gh secret set WIF_SERVICE_ACCOUNT --repo "$GITHUB_REPO" --body "$CI_SA_EMAIL"
gh secret set NEXT_PUBLIC_PUSHER_KEY --repo "$GITHUB_REPO" \
  --body "$NEXT_PUBLIC_PUSHER_KEY"
# Whole dotenv payload — piped, never echoed.
gh secret set ENV_FILE --repo "$GITHUB_REPO" < "$ENV_FILE"

# --- Optional first deploy -----------------------------------------------------------

IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$AR_REPO/$SERVICE_NAME"

if [ "${1:-}" = "--deploy" ]; then
  echo "==> Building image via Cloud Build"
  gcloud builds submit --config="$BUILD_FILE" --project="$GCP_PROJECT_ID" \
    --substitutions="_IMAGE=$IMAGE:latest,_NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY,_NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER" \
    "$ROOT"

  echo "==> Deploying to Cloud Run"
  # --env-vars-file wants YAML: one key (ENV_FILE) whose literal-block value
  # is the entire .env, indented two spaces.
  { echo "ENV_FILE: |"; sed 's/^/  /' "$ENV_FILE"; } > "$TMP_DIR/env.yaml"
  gcloud run deploy "$SERVICE_NAME" \
    --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
    --image="$IMAGE:latest" \
    --allow-unauthenticated --min-instances=0 --max-instances=1 \
    --memory=512Mi --cpu=1 --concurrency=80 \
    --env-vars-file="$TMP_DIR/env.yaml"

  gcloud run services describe "$SERVICE_NAME" \
    --project="$GCP_PROJECT_ID" --region="$GCP_REGION" \
    --format='value(status.url)'
fi

cat <<EOF

Done. Next steps:
  1. ./scripts/gcp-setup.sh --deploy   # first image build + deploy
  2. Merge to main — GitHub Actions deploys on every push.
EOF
