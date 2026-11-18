#!/usr/bin/env bash
# Runs once per deploy of the `init` service (D390); every step is idempotent. Reads only
# Railway variables (scripts/railway/apps.sh) and prints no secret.
#
#   POSTGRES_ADMIN_URL   the pgvector superuser, on the private network
#   AWP_APP_PASSWORD     the console's login role `awp`, owner of `awp` and `awp_kb`
#   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY   MinIO's root credentials
#   DATABASE_MIGRATE_URL, DATABASE_URL, APP_KEK ...   what the migration and the seed read
set -euo pipefail

echo "== databases"
psql "${POSTGRES_ADMIN_URL}" -v ON_ERROR_STOP=1 -q -v pw="${AWP_APP_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE awp LOGIN PASSWORD %L', :'pw') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awp') \gexec
SELECT format('ALTER ROLE awp LOGIN PASSWORD %L', :'pw') \gexec
SELECT 'CREATE DATABASE awp OWNER awp' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'awp') \gexec
SELECT 'CREATE DATABASE awp_kb OWNER awp' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'awp_kb') \gexec
SQL
# The passage vectors (stack specification 7.1); the extensions need the superuser.
psql "${POSTGRES_ADMIN_URL%/*}/awp_kb" -v ON_ERROR_STOP=1 -q \
  -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
echo "  awp, awp_kb owned by awp"

echo "== buckets"
# The names and policies of infra/charts/awp/values.yaml `jobs.objectBuckets`.
export MC_CONFIG_DIR=/tmp/mc
mc alias set awp "${S3_ENDPOINT}" "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}" >/dev/null
for b in raw-docs files artifacts attachments skills memory run-payloads branding; do
  mc mb --ignore-existing --quiet "awp/${b}" >/dev/null
done
for b in files artifacts memory; do mc version enable --quiet "awp/${b}" >/dev/null; done
mc ilm rule ls awp/run-payloads 2>/dev/null | grep -q "30" || mc ilm rule add --expire-days 30 awp/run-payloads >/dev/null
echo "  8 buckets; versioned: files artifacts memory; run-payloads expire after 30 days"

echo "== migrations"
npm run --silent db:migrate

echo "== seed"
seeded="$(psql "${DATABASE_MIGRATE_URL}" -tAc "select exists (select 1 from core.role where is_system)")"
if [ "${seeded}" = "t" ]; then
  echo "  already seeded"
else
  npm run --silent db:seed
fi
echo "init complete"
