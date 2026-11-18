#!/usr/bin/env bash
# Replaces the Railway data with a copy of the kind cluster's (D390): both databases, every
# object-store bucket, and the encryption key the database's sealed credentials need.
# `make railway-copy-kind-data`. Reads kind; changes nothing there. Prints no secret.
#
#   1. pg_dump `awp` and `awp_kb` from the CloudNativePG primary
#   2. mirror the eight buckets from kind's MinIO to Railway's (public HTTPS endpoint)
#   3. upload the dumps to Railway's `transfer` bucket
#   4. give Railway kind's APP_KEK: connector, channel and provider credentials are sealed with it
#   5. run the `data-import` service (infra/railway/init/import.sh), which restores and migrates
#
# What the Railway databases held before is gone afterwards; there is no undo but a re-run of
# `init` on empty databases.
set -euo pipefail
# shellcheck source=scripts/railway/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

data_namespace="${DATA_NAMESPACE:-awp-data}"
app_namespace="${APP_NAMESPACE:-awp-app}"
cluster="${CLUSTER:-awp-pg}"
minio_port="${MINIO_LOCAL_PORT:-55436}"
buckets=(raw-docs files artifacts attachments skills memory run-payloads branding)

read -r project_id environment_id <<<"$(ids)"
tmp="$(scratch_dir)"
# shellcheck source=scripts/port-forward.sh
. "${root}/scripts/port-forward.sh"
trap 'forward_stop; rm -rf "${tmp}"' EXIT

kind_secret() {
  kubectl -n "$1" get secret "$2" -o jsonpath="{.data.$3}" | base64 -d
}
railway_field() {
  railway variable list --service "$1" --json \
    | python -I -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$2"
}

step "dump (kind ${cluster})"
primary="$(kubectl -n "${data_namespace}" get pod \
  -l "cnpg.io/cluster=${cluster},cnpg.io/instanceRole=primary" -o jsonpath='{.items[0].metadata.name}')"
for database in awp awp_kb; do
  kubectl -n "${data_namespace}" exec "${primary}" -c postgres -- \
    pg_dump -U postgres -Fc -d "${database}" >"${tmp}/${database}.dump"
  echo "  ${database}: $(wc -c <"${tmp}/${database}.dump" | tr -d ' ') bytes"
done

step "objects (kind MinIO -> Railway MinIO)"
forward_start "${data_namespace}" svc/minio "${minio_port}" 9000
# The two stores' credentials reach the client in a file, never on a command line.
{
  echo "MC_HOST_kind=http://$(kind_secret "${app_namespace}" awp-app S3_ACCESS_KEY):$(kind_secret "${app_namespace}" awp-app S3_SECRET_KEY)@host.docker.internal:${minio_port}"
  echo "MC_HOST_railway=https://$(railway_field Bucket MINIO_ROOT_USER):$(railway_field Bucket MINIO_ROOT_PASSWORD)@$(railway_field Bucket MINIO_PUBLIC_HOST)"
} >"${tmp}/mc.env"
MSYS_NO_PATHCONV=1 docker run --rm -i --env-file "${tmp}/mc.env" -v "${tmp}:/work" \
  -e "BUCKETS=${buckets[*]}" --entrypoint /bin/sh \
  bitnamilegacy/minio-client:2025.7.21-debian-12-r2 -s <<'SH'
set -e
export MC_CONFIG_DIR=/tmp/mc
for bucket in ${BUCKETS}; do
  mc mb --ignore-existing --quiet "railway/${bucket}" >/dev/null
  mc mirror --overwrite --quiet "kind/${bucket}" "railway/${bucket}" >/dev/null
  echo "  ${bucket}: $(mc ls --recursive "railway/${bucket}" | wc -l) objects"
done
mc mb --ignore-existing --quiet railway/transfer >/dev/null
mc cp --quiet /work/awp.dump /work/awp_kb.dump railway/transfer/ >/dev/null
echo "  dumps uploaded to transfer/"
SH
rm -f "${tmp}/mc.env"

step "APP_KEK"
printf 'APP_KEK=%s\n' "$(kind_secret "${app_namespace}" awp-app APP_KEK)" | upsert ""
echo "  the shared APP_KEK is kind's"

step "import (data-import service)"
image="$(image_of railway-init)"
has_service data-import || railway add --service data-import --image "${image}" >/dev/null
service="$(service_id data-import)"
# What import.sh reads, as references to the backing services (the same as `init`'s).
upsert "${service}" <<'ENV'
POSTGRES_ADMIN_URL=postgresql://postgres:${{pgvector.POSTGRES_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/railway
DATABASE_URL=postgresql://postgres:${{pgvector.POSTGRES_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp
DATABASE_MIGRATE_URL=postgresql://postgres:${{pgvector.POSTGRES_PASSWORD}}@${{pgvector.RAILWAY_PRIVATE_DOMAIN}}:5432/awp
AWP_APP_PASSWORD=${{pgvector.AWP_APP_PASSWORD}}
S3_ENDPOINT=http://${{Bucket.RAILWAY_PRIVATE_DOMAIN}}:9000
S3_ACCESS_KEY=${{Bucket.MINIO_ROOT_USER}}
S3_SECRET_KEY=${{Bucket.MINIO_ROOT_PASSWORD}}
APP_KEK=${{shared.APP_KEK}}
ENV
python -I -c '
import json, sys
open(sys.argv[3], "w").write(json.dumps({"s": sys.argv[1], "e": sys.argv[2], "i": {
    "source": {"image": sys.argv[4]},
    "startCommand": "bash /repo/infra/railway/init/import.sh",
    "restartPolicyType": "NEVER"}}))
print("mutation($s: String!, $e: String!, $i: ServiceInstanceUpdateInput!) "
      "{ serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $i) }")
' "${service}" "${environment_id}" "${tmp}/instance.json" "${image}" \
  | railway api --file - --variables "@${tmp}/instance.json" >/dev/null
printf 'mutation { serviceInstanceDeployV2(serviceId: "%s", environmentId: "%s") }' \
  "${service}" "${environment_id}" | gql >/dev/null
echo "  deploying; follow it with: railway logs --service data-import"
echo "  then restart web and the agents so they pick up the new APP_KEK and data:"
echo "  SERVICES=\"web agent-service agent-worker-agent-runs agent-worker-ingestion agent-worker-maintenance\" make railway-apps"
