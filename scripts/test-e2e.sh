#!/usr/bin/env bash
# `make test-e2e`: the Playwright journey in `tests/e2e` against the kind deployment.
#
# The suite goes through the console at BASE_URL and reads the verification and invitation
# emails from Mailpit, which it reaches through a port-forward. Arguments go to Playwright,
# so `scripts/test-e2e.sh --grep AC-DEP` runs one case.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mail_port="${MAIL_LOCAL_PORT:-58025}"

# shellcheck source=scripts/port-forward.sh
. "${root}/scripts/port-forward.sh"
trap forward_stop EXIT
forward_start hiwar-app svc/mailpit "${mail_port}" 8025

cd "${root}"
BASE_URL="$("${root}/scripts/public-origin.sh" https hiwar.localtest.me)" \
MAILPIT_URL="http://127.0.0.1:${mail_port}" \
  npx playwright test "$@"
