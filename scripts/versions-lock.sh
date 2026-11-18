#!/usr/bin/env bash
# Refreshes the digest column of versions.lock.md from the registry. Every image listed in
# the table is resolved with `docker buildx imagetools inspect`, which needs network access
# and a logged-in Docker.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock="${root}/versions.lock.md"

while IFS= read -r reference; do
  digest="$(docker buildx imagetools inspect "${reference}" --format '{{.Manifest.Digest}}' 2>/dev/null || echo "unresolved")"
  printf '%-70s %s\n' "${reference}" "${digest}"
done < <(grep -oE '`[a-z0-9./-]+(:[A-Za-z0-9._-]+)`' "${lock}" | tr -d '`' | grep ':' | sort -u)
