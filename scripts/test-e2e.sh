#!/usr/bin/env bash
# `make test-e2e`: the Playwright suite in `tests/e2e` against the kind deployment.
#
# The suite goes through the console at BASE_URL and reads the verification and invitation
# emails from Mailpit, which it reaches through a port-forward. The operator-portal specs give
# their staff accounts a platform role with `npm run ops:grant`, which has no screen by design;
# it reaches the database through a second forward, as `scripts/seed.sh` does. Arguments go to
# Playwright, so `scripts/test-e2e.sh --grep AC-DEP` runs one case.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mail_port="${MAIL_LOCAL_PORT:-58025}"
db_port="${DB_LOCAL_PORT:-55434}"
data_namespace="${DATA_NAMESPACE:-hiwar-data}"

# shellcheck source=scripts/port-forward.sh
. "${root}/scripts/port-forward.sh"
trap forward_stop EXIT
forward_start hiwar-app svc/mailpit "${mail_port}" 8025
forward_start "${data_namespace}" svc/hiwar-pg-rw "${db_port}" 5432
db_password="$(kubectl -n "${data_namespace}" get secret hiwar-pg-superuser -o jsonpath='{.data.password}' | base64 -d)"

cd "${root}"
BASE_URL="$("${root}/scripts/public-origin.sh" https hiwar.localtest.me)" \
MAILPIT_URL="http://127.0.0.1:${mail_port}" \
E2E_DATABASE_URL="postgresql://postgres:${db_password}@127.0.0.1:${db_port}/hiwar?uselibpqcompat=true&sslmode=prefer" \
  npx playwright test "$@"
