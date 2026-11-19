#!/usr/bin/env bash
# Stack specification 9: `.env` is the only manual step locally. This turns it into the
# Secrets each namespace needs. It never prints a value, and it is safe to re-run.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-${root}/.env}"

if [ ! -f "${env_file}" ]; then
  echo "No ${env_file}. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

# `.env` computes the public origin with `scripts/public-origin.sh`, which it reaches
# through AWP_ROOT.
export AWP_ROOT="${root}"
set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

secret() {
  local namespace="$1" name="$2"
  shift 2
  kubectl -n "${namespace}" create secret generic "${name}" "$@" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "  ${namespace}/${name}"
}

echo "Secrets:"

# The application namespace: everything apps/web and services/* read.
#
# A variable that is empty is left out rather than written as an empty string: the console
# validates its environment, and "" is not the same as absent. The DATABASE_* URLs are
# normally empty here and written by `scripts/db-credentials.sh` from what CloudNativePG
# generated.
app_secret=()
for name in AUTH_SECRET UAEPASS_BASE_URL UAEPASS_CLIENT_ID UAEPASS_CLIENT_SECRET \
  APP_KEK RUN_TOKEN_SIGNING_KEY TEMPORAL_CODEC_KEY TEMPORAL_CODEC_PREVIOUS_KEYS MAINTENANCE_API_TOKEN DATABASE_URL DATABASE_RO_URL DATABASE_MIGRATE_URL \
  KB_DATABASE_URL PHOENIX_API_KEY S3_ACCESS_KEY S3_SECRET_KEY NEO4J_AUTH \
  SECRET_KEY AGENT_SERVICE_TOKEN MODEL_API_KEY MAIL_FROM STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
  value="${!name:-}"
  [ -n "${value}" ] && app_secret+=("--from-literal=${name}=${value}")
done
secret hiwar-app hiwar-app "${app_secret[@]}"

# The AI namespace.
#
# agentgateway holds every provider credential: the harness never sees one (6.1). Each key
# is a Secret the gateway's backends reference by name.
secret hiwar-ai agentgateway-providers \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --from-literal=OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
  --from-literal=AZURE_API_KEY="${AZURE_API_KEY:-}" \
  --from-literal=AZURE_API_BASE="${AZURE_API_BASE:-}"

# agentgateway validates the per-run JWT the web application mints, so both sides hold the
# same signing key (stack specification 9 and 10).
secret hiwar-ai run-token --from-literal=signing-key="${RUN_TOKEN_SIGNING_KEY}"

secret hiwar-ai phoenix \
  --from-literal=secret="${PHOENIX_SECRET}" \
  --from-literal=api-key="${PHOENIX_API_KEY}"

# The data namespace: the roots of the stores the operators create.
secret hiwar-data minio-root \
  --from-literal=rootUser="${S3_ACCESS_KEY}" \
  --from-literal=rootPassword="${S3_SECRET_KEY}"

secret hiwar-data neo4j-auth --from-literal=NEO4J_AUTH="${NEO4J_AUTH:-neo4j/please-change}"
