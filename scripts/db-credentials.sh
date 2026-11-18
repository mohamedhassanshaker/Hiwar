#!/usr/bin/env bash
# CloudNativePG generates the password of every database user it creates. This hands that
# password to the things that need it, so no database password is ever a literal in `.env`.
#
# One cluster, `awp-pg`, carries all five databases (stack specification 7.1):
#
#   awp                  the three DATABASE_* URLs of the `awp-app` Secret
#   awp_kb               KB_DATABASE_URL of the same Secret, for the agent service
#   temporal             `awp-pg-temporal` in awp-ai
#   temporal_visibility  the same Secret
#   phoenix              `awp-pg-phoenix` in awp-ai
#
# `infra/platform/helmfile.yaml` runs it as a postsync hook of the cluster, so the
# credentials exist before Temporal, Phoenix or the console are installed. It prints no
# value and re-running it changes nothing.
set -euo pipefail

data_namespace="${DATA_NAMESPACE:-awp-data}"
app_namespace="${APP_NAMESPACE:-awp-app}"
ai_namespace="${AI_NAMESPACE:-awp-ai}"
cluster="${CLUSTER:-awp-pg}"

# The operator creates the primary a moment after the Cluster resource is applied, and
# `kubectl wait` fails outright when nothing matches its selector yet. So wait for the pod
# to exist first, then for it to become ready.
selector="cnpg.io/cluster=${cluster},cnpg.io/instanceRole=primary"
for _ in $(seq 1 120); do
  [ -n "$(kubectl -n "${data_namespace}" get pod -l "${selector}" -o name 2>/dev/null)" ] && break
  sleep 5
done
kubectl -n "${data_namespace}" wait --for=condition=Ready pod   -l "${selector}" --timeout=10m >/dev/null

password_in() {
  kubectl -n "${data_namespace}" get secret "$1" -o jsonpath='{.data.password}' | base64 -d
}

# A generated password goes into a URL, so it is percent-encoded first.
encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

# The read path uses `-r`, not `-ro`: `-ro` selects replicas only, and a single-instance
# cluster has none, so the reporting connection would have nowhere to go. `-r` includes the
# primary and still spreads reads once replicas exist.
#
# `uselibpqcompat` keeps `prefer` meaning what libpq means by it: encrypt when the server
# offers it, without verifying the certificate. Without it `pg` reads `prefer` as
# `verify-full` and rejects the certificate authority CloudNativePG generated.
#   url <user> <encoded password> <service> <database>
url() {
  printf 'postgresql://%s:%s@%s.%s.svc.cluster.local:5432/%s?uselibpqcompat=true&sslmode=prefer' \
    "$1" "$2" "$3" "${data_namespace}" "$4"
}

apply_secret() {
  local namespace="$1" name="$2"
  shift 2
  kubectl -n "${namespace}" create secret generic "${name}" "$@" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "  ${namespace}/${name}"
}

echo "Database credentials:"

raw_app="$(password_in "${cluster}-app")"
app="$(encode "${raw_app}")"
# The console connects as `awp`; the migration creates extensions and reassigns schema
# ownership, which only the superuser may do.
superuser="$(encode "$(password_in "${cluster}-superuser")")"

host="${cluster}-rw.${data_namespace}.svc.cluster.local"

kubectl -n "${app_namespace}" patch secret awp-app --type merge -p "{\"stringData\":{\"DATABASE_URL\":\"$(url awp "${app}" "${cluster}-pooler" awp)\",\"DATABASE_RO_URL\":\"$(url awp "${app}" "${cluster}-r" awp)\",\"DATABASE_MIGRATE_URL\":\"$(url postgres "${superuser}" "${cluster}-rw" awp)\",\"KB_DATABASE_URL\":\"postgresql://awp:${app}@${host}:5432/awp_kb?sslmode=prefer\"}}" >/dev/null
echo "  ${app_namespace}/awp-app DATABASE_URL, DATABASE_RO_URL, DATABASE_MIGRATE_URL, KB_DATABASE_URL"

# Temporal's chart takes the user and the password; Phoenix takes one URL.
apply_secret "${ai_namespace}" "${cluster}-temporal"   --from-literal=username=awp   --from-literal=password="${raw_app}"

# Phoenix connects with asyncpg through SQLAlchemy and psycopg speaks libpq, and neither
# accepts node-postgres's `uselibpqcompat`. Each gets the spelling its own driver takes,
# both meaning "encrypt when the server offers it".
apply_secret "${ai_namespace}" "${cluster}-phoenix"   --from-literal=PHOENIX_SQL_DATABASE_URL="postgresql://awp:${app}@${host}:5432/phoenix?ssl=prefer"
