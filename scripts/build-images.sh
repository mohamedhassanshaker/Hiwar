#!/usr/bin/env bash
# The images this repository builds, pushed to the local registry at the tags
# `infra/charts/awp/values.yaml` pins. The references come from rendering the chart, so
# there is one place a tag is written. A tag the registry already holds is left alone;
# REBUILD=1 builds it again.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
registry_port="${REGISTRY_PORT:-5001}"
rebuild="${REBUILD:-0}"
# `ONLY=awp/web` builds one repository and leaves the rest alone, which is what
# `make deploy-web` and `make deploy-agent` need.
only="${ONLY:-}"

# repository -> dockerfile, build context
dockerfile_of() {
  case "$1" in
    awp/web) echo "apps/web/Dockerfile ." ;;
    awp/agent) echo "services/agent/Dockerfile ." ;;
    awp/sandbox-manager) echo "services/sandbox/Dockerfile services/sandbox" ;;
    awp/sandbox-workspace) echo "services/sandbox/workspace/Dockerfile services/sandbox/workspace" ;;
    awp/connector-runtime) echo "services/connectors/Dockerfile services/connectors" ;;
    awp/model-engine) echo "services/modelstub/Dockerfile services/modelstub" ;;
    *) echo "No Dockerfile is known for $1." >&2; exit 1 ;;
  esac
}

in_registry() {
  curl -fsS -o /dev/null \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    -H "Accept: application/vnd.oci.image.manifest.v1+json" \
    -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    "http://localhost:${registry_port}/v2/$1/manifests/$2" 2>/dev/null
}

references="$(
  helm template awp "${root}/infra/charts/awp" \
    --values "${root}/infra/charts/values/values-local.yaml" \
    | grep -oE "localhost:${registry_port}/[a-z0-9./-]+:[A-Za-z0-9._-]+" | sort -u
)"
[ -n "${references}" ] || { echo "The chart renders no image in the local registry." >&2; exit 1; }

echo "Application images:"
for reference in ${references}; do
  repository="${reference#localhost:${registry_port}/}"
  tag="${repository##*:}"
  repository="${repository%:*}"
  if [ -n "${only}" ] && [ "${repository}" != "${only}" ]; then
    continue
  fi
  if [ "${rebuild}" != "1" ] && in_registry "${repository}" "${tag}"; then
    echo "  ${reference} is already in the registry"
    continue
  fi
  read -r dockerfile context <<<"$(dockerfile_of "${repository}")"
  echo "  ${reference}"
  docker build --target runtime --tag "${reference}" \
    --file "${root}/${dockerfile}" "${root}/${context}"
  docker push --quiet "${reference}"
done

# BuildKit's own garbage collection runs on a timer, so back-to-back multi-gigabyte builds
# outrun it: the agent image carries torch, spaCy and Tesseract, and three of them in a row
# filled this machine's disk and stopped the Docker daemon from starting at all. The ceiling
# is enforced here, right after the builds that would breach it, rather than hoping the timer
# wins the race. CACHE_CEILING_GB=0 turns it off.
over_ceiling() {
  local size unit whole
  size="$(docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | awk -F'|' -v t="$1" '$1 == t {print $2}')"
  unit="${size##*[0-9.]}"
  whole="${size%%[A-Za-z]*}"
  whole="${whole%%.*}"
  [ "${unit}" = "TB" ] || { [ "${unit}" = "GB" ] && [ "${whole:-0}" -ge "$2" ]; }
}

ceiling="${CACHE_CEILING_GB:-20}"
if [ "${ceiling}" != "0" ] && over_ceiling "Build Cache" "${ceiling}"; then
  echo "Build cache is at or above the ${ceiling}GB ceiling: pruning."
  docker builder prune --force --all >/dev/null
fi

# A superseded tag (REBUILD=1, or a tag whose digest changed) leaves its old layers behind
# as dangling images; pushed images also sit in the host's store even though the registry
# and the kind nodes already hold them. Same ceiling, same reasoning, the other place this
# machine's disk fills up. IMAGE_CEILING_GB=0 turns it off.
image_ceiling="${IMAGE_CEILING_GB:-20}"
if [ "${image_ceiling}" != "0" ] && over_ceiling "Images" "${image_ceiling}"; then
  echo "Image store is at or above the ${image_ceiling}GB ceiling: pruning unused images."
  docker image prune --force --all >/dev/null
fi

# A pushed tag's superseded digest also stays on every kind node: the CRI image store has
# no timer of its own the way BuildKit's cache does, so the overlayfs snapshot behind it
# sits there until something asks for it back. One node alone has filled 58GB this way.
# PRUNE_NODES=0 turns this off.
cluster_name="${CLUSTER_NAME:-awp}"
if [ "${PRUNE_NODES:-1}" != "0" ] && kind get clusters 2>/dev/null | grep -qx "${cluster_name}"; then
  for node in $(kind get nodes --name "${cluster_name}" 2>/dev/null); do
    docker exec "${node}" crictl --timeout 120s rmi --prune >/dev/null 2>&1 || true
  done
fi
