#!/usr/bin/env bash
# `make seed`: loads the organisation into the cluster's domain database. Running it twice
# leaves the same row counts (requirement 24). This is the only seed the platform ships: one
# project, the organisation's request types, one knowledge base and its agent, every setting
# on. The organisation the test suites read is test data — `apps/web/tests/fixtures/demo`,
# loaded by `npm --prefix apps/web run test:seed` against whatever `DATABASE_URL` names;
# `SEED=test` loads it here, through the same forwards and secrets. Either one truncates the
# `core`, `work`, `ai` and `gov` schemas first.
set -euo pipefail

case "${SEED:-product}" in
  product) seed_script="db:seed" ;;
  test) seed_script="test:seed" ;;
  *) echo "SEED must be 'product' or 'test', not '${SEED}'." >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
namespace="${NAMESPACE:-awp-data}"
local_port="${LOCAL_PORT:-55433}"
s3_local_port="${S3_LOCAL_PORT:-55435}"

kubectl -n "${namespace}" wait --for=condition=Ready pod -l cnpg.io/cluster=awp-pg --timeout=5m

# The superuser, not the application role: clearing and reseeding truncates tables,
# and the application role deliberately may not (infra/postgres/06-roles.sql).
password="$(kubectl -n "${namespace}" get secret awp-pg-superuser -o jsonpath='{.data.password}' | base64 -d)"
# shellcheck source=scripts/port-forward.sh
. "${root}/scripts/port-forward.sh"
trap forward_stop EXIT
forward_start "${namespace}" svc/awp-pg-rw "${local_port}" 5432

# The seed also writes the demo files and artifacts into the object store (work.ts), which
# it reaches through a forward of its own, the same way it reaches the database.
forward_start "${namespace}" svc/minio "${s3_local_port}" 9000

# The seed writes channel credentials, which are stored encrypted, so it needs the same
# key the application reads them back with. The object store's region is not a secret;
# its credentials are the ones `scripts/secrets-from-env.sh` wrote from the same `.env`.
kek="$(kubectl -n awp-app get secret awp-app -o jsonpath='{.data.APP_KEK}' | base64 -d)"
s3_access_key="$(kubectl -n awp-app get secret awp-app -o jsonpath='{.data.S3_ACCESS_KEY}' | base64 -d)"
s3_secret_key="$(kubectl -n awp-app get secret awp-app -o jsonpath='{.data.S3_SECRET_KEY}' | base64 -d)"
s3_region="$(kubectl -n awp-app get deploy/web -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="S3_REGION")].value}')"

# `seedModels`'s `orderedChain` decides a route's failover order from which providers this
# install can actually reach (`reachable()`, keyed on these same variable names) — so the
# seed needs the cluster's own provider keys, not whatever happens to be exported in the
# shell it runs from, or every route silently reorders itself around a local shell that has
# none of them and puts the local engine first regardless of what the cluster can really call.
anthropic_key="$(kubectl -n awp-ai get secret agentgateway-providers -o jsonpath='{.data.ANTHROPIC_API_KEY}' 2>/dev/null | base64 -d || true)"
openai_key="$(kubectl -n awp-ai get secret agentgateway-providers -o jsonpath='{.data.OPENAI_API_KEY}' 2>/dev/null | base64 -d || true)"
azure_key="$(kubectl -n awp-ai get secret agentgateway-providers -o jsonpath='{.data.AZURE_API_KEY}' 2>/dev/null | base64 -d || true)"
openrouter_key="$(kubectl -n awp-ai get secret agentgateway-providers -o jsonpath='{.data.OPENROUTER_API_KEY}' 2>/dev/null | base64 -d || true)"

DATABASE_URL="postgresql://postgres:${password}@127.0.0.1:${local_port}/awp?uselibpqcompat=true&sslmode=prefer" \
APP_KEK="${kek}" \
S3_ENDPOINT="http://127.0.0.1:${s3_local_port}" \
S3_REGION="${s3_region}" \
S3_FORCE_PATH_STYLE="true" \
S3_ACCESS_KEY="${s3_access_key}" \
S3_SECRET_KEY="${s3_secret_key}" \
ANTHROPIC_API_KEY="${anthropic_key}" \
OPENAI_API_KEY="${openai_key}" \
AZURE_API_KEY="${azure_key}" \
OPENROUTER_API_KEY="${openrouter_key}" \
  npm --prefix "${root}/apps/web" run "${seed_script}"

# The seed replaced the routes in the database, and agentgateway serves the ones the console
# last published, which it does when it starts (`apps/web/src/instrumentation.ts`). Restarting
# it publishes the seeded routes, so the gateway serves what the database holds (D366).
kubectl -n awp-app rollout restart deploy/web
kubectl -n awp-app rollout status deploy/web --timeout=10m
