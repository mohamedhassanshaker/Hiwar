#!/usr/bin/env bash
# `make verify`: every required check, in one place.
#
# NFR-30 is that the same entry point runs locally and in CI, so CI calls this script
# rather than listing the commands again and drifting from it. Each check keeps its own
# exit status; the first failure stops the run.
#
# The database-backed suites of `apps/web` are required, not optional. The script resolves
# a connection string and exports REQUIRE_DATABASE=1, which makes `tests/db/harness.ts`
# fail loudly if one is missing rather than skipping twenty-three suites and reporting a
# false pass.
#
# DATABASE_URL may be supplied by the caller — CI points it at its own PostgreSQL service.
# Otherwise the script uses the `make dev-local` container, which is a plain PostgreSQL on
# a published port. It deliberately does not port-forward the kind cluster: a long
# `kubectl port-forward` drops under the suite's connection pattern on Windows, and a gate
# that fails for its own reasons teaches people to ignore it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev_db_container="${DEV_DB_CONTAINER:-awp-dev-db}"
dev_db_port="${AWP_DB_PORT:-55432}"

step() { printf '\n=== %s ===\n' "$1"; }

if [ -z "${DATABASE_URL:-}" ]; then
  if [ "$(docker container inspect -f '{{.State.Running}}' "${dev_db_container}" 2>/dev/null)" != "true" ]; then
    echo "No DATABASE_URL set and the ${dev_db_container} container is not running." >&2
    echo "The database-backed suites are required, not optional. Run 'make dev-local'," >&2
    echo "or export DATABASE_URL, then run 'make verify' again." >&2
    exit 1
  fi
  # `127.0.0.1`, not `localhost`: on Windows `localhost` resolves to `::1`, which WSL's relay
  # serves, and that relay stalls new connections for a minute at a time under the suites' load.
  export DATABASE_URL="postgresql://postgres:awp@127.0.0.1:${dev_db_port}/awp"
fi
# The seed writes channel credentials, which are stored encrypted, so the suites that run it
# need the same key the application reads them back with. The developer .env holds it; a run
# with no key at all would fail inside the seed rather than at the gate.
if [ -z "${APP_KEK:-}" ] && [ -f "${root}/.env" ]; then
  APP_KEK="$(grep -E '^APP_KEK=' "${root}/.env" | head -1 | cut -d= -f2- | cut -d' ' -f1)"
  export APP_KEK
fi
if [ -z "${APP_KEK:-}" ]; then
  echo "APP_KEK is not set and .env does not carry one. The seed cannot store a secret." >&2
  exit 1
fi

export DATABASE_MIGRATE_URL="${DATABASE_MIGRATE_URL:-${DATABASE_URL}}"
export REQUIRE_DATABASE=1

# Same pattern as DATABASE_URL above: CI's `minio` service sets these at the job level, so a
# caller-supplied S3_ENDPOINT wins there; a local run falls back to the `make dev-local`
# container, which is a plain MinIO on a published port.
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:${AWP_MINIO_PORT:-9000}}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-${AWP_MINIO_ACCESS_KEY:-awp-root}}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-${AWP_MINIO_SECRET_KEY:-dev-object-store-root}}"
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

# A gate run against a schema older than the migrations proves nothing about the code being
# checked, so the schema is brought up to date first. The migrator is idempotent.
step "database: migrate"
npm --prefix "${root}/apps/web" run db:migrate

# The database-backed suites assert against their own fixtures (a seeded project, agents,
# requests — `tests/db/projects.test.ts` and the rest), not against whatever happened to
# already be in the database. A genuinely fresh one, which is exactly what a CI service
# container is on every run, has none of that until this loads it: without this step every
# `beforeAll` that reads a fixture row fails before its test even starts.
step "database: fixtures"
npm --prefix "${root}/apps/web" run test:seed

step "web: lint"
npm --prefix "${root}/apps/web" run lint

step "web: typecheck"
npm --prefix "${root}/apps/web" run typecheck

step "web: unit and database suites"
npm --prefix "${root}/apps/web" test

step "web: build"
npm --prefix "${root}/apps/web" run build

# Every Python service, not just the agent: three of them were outside the gate entirely,
# which is the same as having no checks at all for the code in them. A new service is
# covered by existing here, not by someone remembering to add it.
for service in "${root}"/services/*/pyproject.toml; do
  name="$(basename "$(dirname "${service}")")"
  step "${name}: lint"
  (cd "${root}/services/${name}" && uv run ruff check .)

  step "${name}: types"
  (cd "${root}/services/${name}" && uv run mypy --strict src tests)

  step "${name}: tests"
  (cd "${root}/services/${name}" && uv run pytest -q)
done

printf '\n=== all required checks passed ===\n'
