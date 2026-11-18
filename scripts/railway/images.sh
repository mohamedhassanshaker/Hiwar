#!/usr/bin/env bash
# The images Railway pulls (D390), built and pushed to Docker Hub as
# `${DOCKERHUB_NAMESPACE}/awp-<name>:<git short sha>`. Needs `docker login` as that account.
#
# FROM_LOCAL=1 tags the images `scripts/build-images.sh` already built for kind
# (`localhost:5001/awp/<name>:0.1.0`) instead of building again; only right when those were
# built from the commit being deployed. `ONLY=web` handles one image.
set -euo pipefail
# shellcheck source=scripts/railway/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

from_local="${FROM_LOCAL:-0}"
only="${ONLY:-}"

# name -> dockerfile, build context, kind repository
build_of() {
  case "$1" in
    web) echo "apps/web/Dockerfile . awp/web" ;;
    agent) echo "services/agent/Dockerfile . awp/agent" ;;
    connector-runtime) echo "services/connectors/Dockerfile services/connectors awp/connector-runtime" ;;
    model-engine) echo "services/modelstub/Dockerfile services/modelstub awp/model-engine" ;;
    sandbox-manager) echo "services/sandbox/Dockerfile services/sandbox awp/sandbox-manager" ;;
    sandbox-workspace) echo "services/sandbox/workspace/Dockerfile services/sandbox/workspace awp/sandbox-workspace" ;;
    agentgateway) echo "infra/railway/agentgateway/Dockerfile infra/railway/agentgateway -" ;;
    railway-init) echo "infra/railway/init/Dockerfile . -" ;;
    *) fail "no image is known as $1" ;;
  esac
}

names=(web agent connector-runtime model-engine sandbox-manager agentgateway railway-init)

step "images -> docker.io/${registry} (tag ${tag})"
for name in "${names[@]}"; do
  [ -n "${only}" ] && [ "${name}" != "${only}" ] && continue
  read -r dockerfile context kind_repository <<<"$(build_of "${name}")"
  reference="$(image_of "${name}")"
  if [ "${from_local}" = "1" ] && [ "${kind_repository}" != "-" ] \
    && docker image inspect "localhost:5001/${kind_repository}:0.1.0" >/dev/null 2>&1; then
    echo "  ${reference} (from the kind image)"
    docker tag "localhost:5001/${kind_repository}:0.1.0" "${reference}"
  else
    echo "  ${reference} (build)"
    # The two Railway-only images have no `runtime` stage; every other Dockerfile names one.
    target=(--target runtime)
    [ "${name}" = "agentgateway" ] || [ "${name}" = "railway-init" ] && target=()
    docker build "${target[@]}" --tag "${reference}" --file "${root}/${dockerfile}" "${root}/${context}"
  fi
  # A Railway-only layer on top of the kind image, so the kind Dockerfile stays as it is.
  overlay="${root}/infra/railway/${name}/Dockerfile"
  if [ -f "${overlay}" ] && [ "${kind_repository}" != "-" ]; then
    echo "  ${reference} (+ infra/railway/${name})"
    docker build --build-arg "BASE=${reference}" --tag "${reference}" --file "${overlay}" "${root}/${context}"
  fi
  docker push --quiet "${reference}"
done
