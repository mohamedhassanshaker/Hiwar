#!/usr/bin/env bash
# The Railway `data-import` service (D390): replaces the `awp` and `awp_kb` databases with the
# dumps `scripts/railway/copy-kind-data.sh` left in the `transfer` bucket, then runs the
# migration, which re-creates the roles and grants the dumps leave out. Prints no secret.
#
# Same variables as `init.sh`: POSTGRES_ADMIN_URL, AWP_APP_PASSWORD, S3_*, DATABASE_MIGRATE_URL.
set -euo pipefail

admin_url() { echo "${POSTGRES_ADMIN_URL%/*}/$1"; }

echo "== dumps"
export MC_CONFIG_DIR=/tmp/mc
mc alias set awp "${S3_ENDPOINT}" "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}" >/dev/null
mc cp --quiet awp/transfer/awp.dump awp/transfer/awp_kb.dump /tmp/ >/dev/null
ls -l /tmp/awp.dump /tmp/awp_kb.dump | awk '{print "  " $NF " " $5 " bytes"}'

echo "== databases"
# Dropped with FORCE: the console and the agents hold connections and reconnect afterwards.
psql "${POSTGRES_ADMIN_URL}" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS awp WITH (FORCE)" -c "CREATE DATABASE awp OWNER awp" \
  -c "DROP DATABASE IF EXISTS awp_kb WITH (FORCE)" -c "CREATE DATABASE awp_kb OWNER awp"
psql "$(admin_url awp_kb)" -v ON_ERROR_STOP=1 -q \
  -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"

echo "== restore"
pg_restore --no-owner --no-acl --exit-on-error -d "$(admin_url awp)" /tmp/awp.dump
# The agent service connects as `awp`, which owns everything in awp_kb, as on kind.
pg_restore --no-owner --no-acl --role=awp -d "$(admin_url awp_kb)" /tmp/awp_kb.dump \
  || echo "  awp_kb: entries the awp role may not restore (extension comments) were skipped"
psql "$(admin_url awp)" -tAc "select 'people ' || count(*) from core.person"
psql "$(admin_url awp_kb)" -tAc "select 'passages ' || count(*) from passage"

echo "== migrations (roles and grants)"
npm run --silent db:migrate

mc rm --recursive --force --quiet awp/transfer >/dev/null
echo "import complete"
