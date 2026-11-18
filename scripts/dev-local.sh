#!/usr/bin/env bash
# `make dev-local`: everything the console and the end-to-end suite need outside the kind
# cluster — PostgreSQL and an object store — plus a migrated and seeded database.
# Idempotent: running it again reuses the containers and re-seeds.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="${root}/apps/web"

db_image="postgres:18"
db_container="awp-dev-db"
db_port="${AWP_DB_PORT:-55432}"

# The same distribution the cluster runs (`infra/platform/values/minio.yaml`), standalone,
# so a skill import or a file upload exercises the real object-store path locally instead of
# refusing with "S3_ENDPOINT and its credentials are not set" — which `importSkill` does
# unconditionally since it actually stores a skill's body.
minio_image="bitnamilegacy/minio:2025.7.23-debian-12-r3"
minio_container="awp-dev-minio"
minio_port="${AWP_MINIO_PORT:-9000}"
minio_access_key="${AWP_MINIO_ACCESS_KEY:-awp-root}"
minio_secret_key="${AWP_MINIO_SECRET_KEY:-dev-object-store-root}"
minio_buckets="raw-docs files artifacts attachments skills memory run-payloads branding"

# Starts a container once; a later run only starts it again if it was stopped.
start() {
  local name="$1"
  shift
  if ! docker container inspect "${name}" >/dev/null 2>&1; then
    docker run -d --name "${name}" "$@" >/dev/null
    echo "  ${name} created"
  elif [ "$(docker container inspect -f '{{.State.Running}}' "${name}")" = "true" ]; then
    echo "  ${name} is already running"
  else
    docker start "${name}" >/dev/null
    echo "  ${name} restarted"
  fi
}

echo "Containers:"
# The domain database. Its data lives in a named volume, so a stop and start keeps it.
start "${db_container}" --restart unless-stopped \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=awp -e POSTGRES_DB=awp \
  -p "${db_port}:5432" -v awp-dev-db-data:/var/lib/postgresql "${db_image}"
# The object store. Data lives in a named volume, same as the database.
start "${minio_container}" --restart unless-stopped \
  -e MINIO_ROOT_USER="${minio_access_key}" -e MINIO_ROOT_PASSWORD="${minio_secret_key}" \
  -p "${minio_port}:9000" -v awp-dev-minio-data:/bitnami/minio/data "${minio_image}"

echo "Waiting for PostgreSQL:"
for _ in $(seq 1 60); do
  if docker exec "${db_container}" pg_isready -U postgres -d awp >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "${db_container}" pg_isready -U postgres -d awp

echo "Waiting for MinIO:"
for _ in $(seq 1 60); do
  if docker exec "${minio_container}" curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "${minio_container}" curl -sf http://localhost:9000/minio/health/live >/dev/null

# Buckets do not auto-create (`putObject` issues a plain `PutObjectCommand`), and versioning
# is part of the contract for the buckets `infra/charts/awp/values.yaml` marks `versioned`.
echo "Buckets:"
S3_ENDPOINT="http://localhost:${minio_port}" S3_ACCESS_KEY="${minio_access_key}" S3_SECRET_KEY="${minio_secret_key}" \
  node "${web}/scripts/ensure-buckets.mjs" ${minio_buckets}

if [ -f "${web}/.env.local" ]; then
  echo "Keeping the existing apps/web/.env.local"
else
  cp "${web}/.env.local.example" "${web}/.env.local"
  echo "Wrote apps/web/.env.local from .env.local.example"
fi

# The migrate and seed scripts are plain Node, not Next.js, so they do not read
# `.env.local` by themselves.
set -a
# shellcheck disable=SC1091
. "${web}/.env.local"
set +a

npm --prefix "${web}" run db:migrate
# The suites' own fixtures, not the install seed: the local test suite and
# `apps/web/tests/traceability.test.ts`'s 567 scenarios are written against this exact data.
npm --prefix "${web}" run test:seed

echo
echo "Ready. Next: npm --prefix apps/web run dev, then http://localhost:3000"
