#!/usr/bin/env bash
# `make test-e2e`: the Playwright suite in `tests/` (run from that folder) against the kind deployment.
#
# The suite needs only BASE_URL, the address the console is served on. It reads no database:
# every check goes through the console, so nothing here opens a port-forward.
#
# `MODE=fast|normal|full` picks the run mode of tests/AGENTS.md section 3 (default `normal`; the gate is `full`).
# `GREP=...` runs one case or one file, which is how a single scenario is checked without
# running the whole suite. `PROJECT=live` runs the live missions (they need the agent service) instead of a mode.
# Other arguments go to Playwright.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_url="$("${root}/scripts/public-origin.sh" https awp.localtest.me)"

cd "${root}/tests"
if [[ -n "${PROJECT:-}" ]]; then
  BASE_URL="${base_url}" npx playwright test --project="${PROJECT}" ${GREP:+--grep "${GREP}"} "$@"
else
  BASE_URL="${base_url}" npm run "test:${MODE:-normal}" -- ${GREP:+--grep "${GREP}"} "$@"
fi
