#!/usr/bin/env bash
# The TAWP services on Railway (D390), from the images `images.sh` pushed: created when
# missing, then given their image, start command and variables. Variables are Railway
# references to the backing services the templates created (`provision.sh`) and to the
# environment's shared secrets, so no secret is written here or printed. Safe to re-run;
# a re-run points every service at the current `IMAGE_TAG` and redeploys it.
set -euo pipefail
# shellcheck source=scripts/railway/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

read -r project_id environment_id <<<"$(ids)"

# The names of the shared variables the environment already holds.
shared_names() {
  printf 'query { variables(projectId: "%s", environmentId: "%s") }' "${project_id}" "${environment_id}" \
    | gql | python -I -c 'import json,sys; print("\n".join(json.load(sys.stdin)["data"]["variables"]))'
}

tmp="$(scratch_dir)"
trap 'rm -rf "${tmp}"' EXIT

step "shared secrets"
# Generated once; the production check in apps/web/src/lib/env.ts refuses the examples.
existing="$(shared_names)"
{
  for name in APP_KEK AUTH_SECRET RUN_TOKEN_SIGNING_KEY MAINTENANCE_API_TOKEN TEMPORAL_CODEC_KEY; do
    grep -qxF "${name}" <<<"${existing}" || echo "${name}=$(random_secret 32)"
  done
  # Taken from `.env` when it holds them: UAE PASS sign-in and the OpenRouter key.
  if [ -f "${root}/.env" ]; then
    for name in UAEPASS_BASE_URL UAEPASS_CLIENT_ID UAEPASS_CLIENT_SECRET OPENROUTER_API_KEY; do
      value="$(grep -E "^${name}=" "${root}/.env" | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//')"
      [ -n "${value}" ] && echo "${name}=${value}"
    done
  fi
} >"${tmp}/shared.env"
upsert "" <"${tmp}/shared.env"
cut -d= -f1 "${tmp}/shared.env" | sed 's/^/  /'

# The environment every application shares (the chart's `awp.env` and the awp-app Secret).
cat >"${tmp}/common.env" <<'ENV'
NODE_ENV=production
LOG_LEVEL=info
AWP_ENV=railway
APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
AUTH_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
WEBAUTHN_RP_ID=${{web.RAILWAY_PUBLIC_DOMAIN}}
AUTH_SECRET=${{shared.AUTH_SECRET}}
APP_KEK=${{shared.APP_KEK}}
RUN_TOKEN_SIGNING_KEY=${{shared.RUN_TOKEN_SIGNING_KEY}}
MAINTENANCE_API_TOKEN=${{shared.MAINTENANCE_API_TOKEN}}
TEMPORAL_CODEC_KEY=${{shared.TEMPORAL_CODEC_KEY}}
UAEPASS_BASE_URL=${{shared.UAEPASS_BASE_URL}}
UAEPASS_CLIENT_ID=${{shared.UAEPASS_CLIENT_ID}}
UAEPASS_CLIENT_SECRET=${{shared.UAEPASS_CLIENT_SECRET}}
DATABASE_URL=postgresql://awp:${{pgvector.AWP_APP_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp
DATABASE_RO_URL=postgresql://awp:${{pgvector.AWP_APP_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp
DATABASE_MIGRATE_URL=postgresql://postgres:${{pgvector.POSTGRES_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp
KB_DATABASE_URL=postgresql://awp:${{pgvector.AWP_APP_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp_kb
TEMPORAL_ADDRESS=${{Temporal.RAILWAY_PRIVATE_DOMAIN}}:7233
TEMPORAL_NAMESPACE=awp
AGW_LLM_URL=http://${{agentgateway.RAILWAY_PRIVATE_DOMAIN}}:8080
AGW_MCP_BASE_URL=http://${{agentgateway.RAILWAY_PRIVATE_DOMAIN}}:8080
CONNECTOR_RUNTIME_URL=http://${{connector-runtime.RAILWAY_PRIVATE_DOMAIN}}:8080
SANDBOX_MANAGER_URL=http://${{sandbox-manager.RAILWAY_PRIVATE_DOMAIN}}:8080
AGENT_SERVICE_URL=http://${{agent-service.RAILWAY_PRIVATE_DOMAIN}}:8000
PLATFORM_MCP_URL=http://${{web.RAILWAY_PRIVATE_DOMAIN}}:3000/api/mcp
PHOENIX_BASE_URL=http://${{Phoenix.RAILWAY_PRIVATE_DOMAIN}}:6006
PHOENIX_PUBLIC_ORIGIN=https://${{Phoenix.RAILWAY_PUBLIC_DOMAIN}}
PHOENIX_API_KEY=${{Phoenix.PHOENIX_ADMIN_SECRET}}
OTEL_EXPORTER_OTLP_ENDPOINT=http://${{Phoenix.RAILWAY_PRIVATE_DOMAIN}}:6006/v1/traces
NEO4J_URI=bolt://${{Neo4j.RAILWAY_PRIVATE_DOMAIN}}:7687
NEO4J_AUTH=${{Neo4j.NEO4J_AUTH}}
VALKEY_URL=${{Valkey.VALKEY_URL}}
S3_ENDPOINT=http://${{Bucket.RAILWAY_PRIVATE_DOMAIN}}:9000
S3_ACCESS_KEY=${{Bucket.MINIO_ROOT_USER}}
S3_SECRET_KEY=${{Bucket.MINIO_ROOT_PASSWORD}}
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
GRAPHITI_TELEMETRY_ENABLED=false
ENV

# Railway's private network is reached over IPv6, so every server binds `::`.
#   name | image | start command | extra variables (`;`-separated) | public domain port
services=(
  "model-engine|model-engine|uvicorn awp_modelstub.main:app --host :: --port 8080||"
  "agentgateway|agentgateway||OPENROUTER_API_KEY=\${{shared.OPENROUTER_API_KEY}};MODEL_ENGINE_URL=http://\${{model-engine.RAILWAY_PRIVATE_DOMAIN}}:8080/v1|"
  "connector-runtime|connector-runtime|uvicorn awp_connectors.main:app --host :: --port 8080||"
  # Workspaces are Railway sandboxes; the token is one a person creates (README).
  "sandbox-manager|sandbox-manager|uvicorn awp_sandbox.main:app --host :: --port 8080|LOG_LEVEL=info;SANDBOX_BACKEND=railway;SANDBOX_WARM_POOL=1|"
  "agent-service|agent|uvicorn awp_agent.main:app --host :: --port 8000|common|"
  "agent-worker-agent-runs|agent|python -m awp_agent.worker agent-runs|common;AWP_WORKER_HEALTH_PORT=8010|"
  "agent-worker-ingestion|agent|python -m awp_agent.worker ingestion|common;AWP_WORKER_HEALTH_PORT=8010|"
  "agent-worker-maintenance|agent|python -m awp_agent.worker maintenance|common;AWP_WORKER_HEALTH_PORT=8010|"
  # ioredis resolves IPv4 only unless told otherwise; `family=0` lets it use the IPv6 address.
  "web|web|node apps/web/server.js|common;HOSTNAME=::;PORT=3000;VALKEY_URL=\${{Valkey.VALKEY_URL}}?family=0;AWP_MIGRATIONS_DIR=/repo/apps/web/db-migrate/migrations;AWP_POSTGRES_SQL_DIR=/repo/infra/postgres|3000"
  # Runs once per deploy and stops (infra/railway/init/init.sh).
  "init|railway-init||common;DATABASE_URL=postgresql://postgres:\${{pgvector.POSTGRES_PASSWORD}}@\${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp;POSTGRES_ADMIN_URL=postgresql://postgres:\${{pgvector.POSTGRES_PASSWORD}}@\${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/railway;AWP_APP_PASSWORD=\${{pgvector.AWP_APP_PASSWORD}};OPENROUTER_API_KEY=\${{shared.OPENROUTER_API_KEY}};NODE_ENV=development|"
)

# Only these services, when set: `SERVICES="web init"`. DEPLOY=0 skips the deploys.
selected="${SERVICES:-}"

for entry in "${services[@]}"; do
  IFS='|' read -r name image start extra port <<<"${entry}"
  [ -n "${selected}" ] && ! grep -qw -- "${name}" <<<"${selected}" && continue
  step "${name}"
  if ! has_service "${name}"; then
    railway add --service "${name}" --image "$(image_of "${image}")" >/dev/null
    echo "  created"
  fi
  service="$(service_id "${name}")"

  # Variables: the shared block when asked for, then this service's own.
  : >"${tmp}/service.env"
  IFS=';' read -ra parts <<<"${extra}"
  for part in "${parts[@]}"; do
    if [ "${part}" = "common" ]; then cat "${tmp}/common.env" >>"${tmp}/service.env"
    elif [ -n "${part}" ]; then
      # A later line wins, so a service's own value overrides the shared one.
      grep -v "^${part%%=*}=" "${tmp}/service.env" >"${tmp}/next.env" || true
      echo "${part}" >>"${tmp}/next.env"
      mv "${tmp}/next.env" "${tmp}/service.env"
    fi
  done
  [ -s "${tmp}/service.env" ] && upsert "${service}" <"${tmp}/service.env"
  echo "  $(wc -l <"${tmp}/service.env" | tr -d ' ') variables"

  # Image, start command, restart policy and, for web, the migration before each deploy.
  python -I -c '
import json, os, sys
service, environment, image, start, name = sys.argv[1:6]
data = {"source": {"image": image}, "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 5}
if start:
    data["startCommand"] = start
if name == "web":
    data["preDeployCommand"] = ["node apps/web/db-migrate/db/migrate.js"]
    data["healthcheckPath"] = "/api/health"
    data["healthcheckTimeout"] = 120
if name == "init":
    data["restartPolicyType"] = "NEVER"
# Private images: pull credentials only from the shell running this, never from a file.
username, password = os.environ.get("DOCKERHUB_USERNAME"), os.environ.get("DOCKERHUB_TOKEN")
if username and password:
    data["registryCredentials"] = {"username": username, "password": password}
query = ("mutation($s: String!, $e: String!, $i: ServiceInstanceUpdateInput!) "
         "{ serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $i) }")
open(sys.argv[6], "w").write(json.dumps({"s": service, "e": environment, "i": data}))
print(query)
' "${service}" "${environment_id}" "$(image_of "${image}")" "${start}" "${name}" "${tmp}/instance.json" \
    | railway api --file - --variables "@${tmp}/instance.json" >/dev/null
  echo "  image $(image_of "${image}")"

  if [ -n "${port}" ] && ! railway variable list --service "${name}" --json | grep -q '"RAILWAY_PUBLIC_DOMAIN"'; then
    railway domain --service "${name}" --port "${port}" >/dev/null
    echo "  public domain on ${port}"
  fi

  if [ "${DEPLOY:-1}" = "1" ]; then
    printf 'mutation { serviceInstanceDeployV2(serviceId: "%s", environmentId: "%s") }' \
      "${service}" "${environment_id}" | gql >/dev/null
    echo "  deploying"
  fi
done
