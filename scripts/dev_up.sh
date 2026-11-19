#!/usr/bin/env bash
# One command from a clean machine to a running console, as docs/12-user-and-developer-guides/local-platform.md describes.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${1:-full}"

[ -f "${root}/.env" ] || cp "${root}/.env.example" "${root}/.env"

make -C "${root}" kind-up PROFILE="${profile}"
make -C "${root}" seed

origin() { "${root}/scripts/public-origin.sh" https "$1"; }

echo
echo "Console:  $(origin hiwar.localtest.me)"
echo "Temporal: $(origin temporal.hiwar.localtest.me)"
echo "Phoenix:  $(origin phoenix.hiwar.localtest.me)"
