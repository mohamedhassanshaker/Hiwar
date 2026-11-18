#!/usr/bin/env bash
# Renders the manifests that carry the host ports or the admin allowlist.
# `infra/kind/kind-config.yaml` and the files in `infra/gateway/` are templates with the
# placeholders below; the bootstrap pipes them through this script, and running it by hand
# shows what a given port pair produces.
#
#   scripts/render-infra.sh infra/kind/kind-config.yaml
#   HTTP_PORT=80 HTTPS_PORT=443 scripts/render-infra.sh infra/gateway/gateway.yaml
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
origin="${root}/scripts/public-origin.sh"

[ $# -eq 1 ] || { echo "usage: render-infra.sh <file>" >&2; exit 2; }

# A comma-separated list in `.env` becomes the YAML flow sequence Traefik's middleware
# wants. The default is the private ranges plus loopback, which is what a laptop needs.
cidrs="${ADMIN_ALLOWED_CIDRS:-127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}"
cidr_list="$(printf '%s' "${cidrs}" | awk -F, '{
  out = ""
  for (i = 1; i <= NF; i++) {
    gsub(/^[ \t]+|[ \t]+$/, "", $i)
    if ($i == "") continue
    out = out (out == "" ? "" : ", ") "\"" $i "\""
  }
  printf "[%s]", out
}')"

sed \
  -e "s|\${HTTP_PORT}|${HTTP_PORT:-8080}|g" \
  -e "s|\${HTTPS_PORT}|${HTTPS_PORT:-8443}|g" \
  -e "s|\${CONSOLE_ORIGIN}|$("${origin}" https awp.localtest.me)|g" \
  -e "s|\${TEMPORAL_ORIGIN}|$("${origin}" https temporal.awp.localtest.me)|g" \
  -e "s|\${PHOENIX_ORIGIN}|$("${origin}" https phoenix.awp.localtest.me)|g" \
  -e "s|\${ADMIN_ALLOWED_CIDRS}|${cidr_list}|g" \
  "$1"
