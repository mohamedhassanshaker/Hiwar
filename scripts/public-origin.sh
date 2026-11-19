#!/usr/bin/env bash
# The one place the public origin is computed from the host ports, so no consumer has to
# repeat the "omit the port when it is the scheme's default" rule.
#
#   scripts/public-origin.sh                            https://hiwar.localtest.me:8443
#   HTTPS_PORT=443 scripts/public-origin.sh             https://hiwar.localtest.me
#   scripts/public-origin.sh http hiwar.localtest.me      http://hiwar.localtest.me:8080
set -euo pipefail

scheme="${1:-https}"
host="${2:-hiwar.localtest.me}"

case "${scheme}" in
  https) port="${HTTPS_PORT:-8443}"; scheme_default=443 ;;
  http) port="${HTTP_PORT:-8080}"; scheme_default=80 ;;
  *)
    echo "usage: public-origin.sh [https|http] [host]" >&2
    exit 2
    ;;
esac

if [ "${port}" = "${scheme_default}" ]; then
  printf '%s://%s\n' "${scheme}" "${host}"
else
  printf '%s://%s:%s\n' "${scheme}" "${host}" "${port}"
fi
