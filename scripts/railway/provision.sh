#!/usr/bin/env bash
# The Railway project and its backing services, each from a Railway marketplace template
# (D390). A template whose service already exists is skipped, so this is safe to re-run.
#
#   pgvector         3jJFCA           PostgreSQL 18 with pgvector: databases awp and awp_kb
#   Valkey           pQYeJx           live updates and spend counters
#   Bucket, Console  SMKOEA           MinIO, the S3 object store (Console renamed minio-console)
#   Temporal         temporal-server  Temporal with its own PostgreSQL (renamed temporal-db),
#                                     the UI and a basic-auth gateway (renamed temporal-ui-auth)
#   Phoenix          phoenix          Arize Phoenix with its own PostgreSQL (renamed phoenix-db)
#   Neo4j            neo4j-1          graph memory
#
# Two templates bring a service called `Postgres`, so each is renamed right after its
# template is deployed; Railway keeps the references that name it working.
set -euo pipefail
# shellcheck source=scripts/railway/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step "project ${project}"
if ! railway status --json >/dev/null 2>&1 || [ "$(railway status --json | python -I -c 'import json,sys; print(json.load(sys.stdin)["name"])')" != "${project}" ]; then
  railway init --name "${project}" ${RAILWAY_WORKSPACE:+--workspace "${RAILWAY_WORKSPACE}"} --json >/dev/null
  echo "  created and linked"
else
  echo "  linked"
fi

rename() {
  local from="$1" to="$2" id
  id="$(service_id "${from}")"
  [ -n "${id}" ] || return 0
  printf 'mutation { serviceUpdate(id: "%s", input: {name: "%s"}) { name } }' "${id}" "${to}" \
    | gql >/dev/null
  echo "  ${from} renamed ${to}"
}

# deploy <service the template creates> <template code> [railway deploy options...]
# `</dev/null`: a template variable with no default would otherwise wait for an answer.
deploy() {
  local marker="$1" code="$2"
  shift 2
  if has_service "${marker}"; then
    echo "  ${code}: ${marker} exists"
    return 0
  fi
  railway deploy -t "${code}" "$@" </dev/null >/dev/null
  echo "  ${code} deployed"
  sleep 5
}

step "backing services"
deploy pgvector 3jJFCA
deploy Valkey pQYeJx
deploy Bucket SMKOEA
rename Console minio-console
deploy Temporal temporal-server -v "Temporal.DEFAULT_NAMESPACE=awp"
rename Postgres temporal-db
rename Gateway temporal-ui-auth
deploy Phoenix phoenix -v "Phoenix.PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD=$(random_secret 18 hex)Aa1!"
rename Postgres phoenix-db
deploy Neo4j neo4j-1

step "backing service settings"
# Railway's private network is IPv6; Phoenix's template binds IPv4 only.
railway variable set "PHOENIX_HOST=::" --service Phoenix --skip-deploys >/dev/null
# The bearer token the platform sends its traces with (PHOENIX_API_KEY in apps.sh).
if ! railway variable list --service Phoenix --json | grep -q '"PHOENIX_ADMIN_SECRET"'; then
  random_secret 32 hex | railway variable set PHOENIX_ADMIN_SECRET --stdin --service Phoenix >/dev/null
  echo "  Phoenix admin secret generated"
fi
# The console's database login; init.sh creates the role with it.
if ! railway variable list --service pgvector --json | grep -q '"AWP_APP_PASSWORD"'; then
  random_secret 24 hex | railway variable set AWP_APP_PASSWORD --stdin --service pgvector --skip-deploys >/dev/null
  echo "  database password generated"
fi
echo "  done"
