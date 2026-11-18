#!/usr/bin/env bash
# `make railway-deploy`: TAWP on Railway end to end (D390), separate from every kind script.
#
#   1. provision.sh   project and backing services from Railway templates
#   2. images.sh      build and push the TAWP images to Docker Hub
#   3. apps.sh        the TAWP services from those images, wired to the backing services
#
# The `init` service then creates the databases and buckets, migrates and seeds; `web`
# migrates again before each of its deploys. Needs `railway login` and `docker login`.
# Docs: docs/12-user-and-developer-guides/railway-deployment.md
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"

bash "${here}/provision.sh"
bash "${here}/images.sh"
bash "${here}/apps.sh"

# shellcheck source=scripts/railway/lib.sh
. "${here}/lib.sh"
step "next"
echo "  railway service list            deployment status of every service"
echo "  railway logs --service init     databases, buckets, migrations and seed"
