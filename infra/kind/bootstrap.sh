#!/usr/bin/env bash
# From nothing to a complete platform: the bootstrap steps of stack specification 8.2,
# then the gateway, the local identity provider, the policies and the application release.
# Every step is idempotent, so running `make kind-up` again succeeds without recreating
# anything. Prerequisites and their minimum versions are in docs/12-user-and-developer-guides/local-platform.md.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "${here}/../.." && pwd)"

CLUSTER_NAME="${CLUSTER_NAME:-awp}"
REGISTRY_NAME="${REGISTRY_NAME:-kind-registry}"
REGISTRY_PORT="${REGISTRY_PORT:-5001}"
REGISTRY_UI_PORT="${REGISTRY_UI_PORT:-5080}"
PROFILE="${PROFILE:-full}"
HTTP_PORT="${HTTP_PORT:-8080}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
# Rook needs a raw block device on the node, which a kind node on Windows or macOS has
# not got. Stack specification 7.3 names this escape; the development object store takes
# its place and speaks the same S3 API.
NO_ROOK="${NO_ROOK:-1}"
export HTTP_PORT HTTPS_PORT REGISTRY_PORT NO_ROOK

source "${here}/versions.env"

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { echo "$1 See docs/12-user-and-developer-guides/local-platform.md." >&2; exit 1; }
render() { "${root}/scripts/render-infra.sh" "$1"; }

# 0 ------------------------------------------------------------------ prerequisites
# The minimum of each tool, and what the chosen profile asks of the Docker daemon.
MINIMUM_docker=24.0.0
MINIMUM_kind=0.23.0
MINIMUM_kubectl=1.30.0
MINIMUM_helm=3.14.0
MINIMUM_helmfile=1.0.0

version_of() {
  case "$1" in
    docker) docker version --format '{{.Client.Version}}' 2>/dev/null ;;
    kind) kind version 2>/dev/null ;;
    kubectl) kubectl version --client 2>/dev/null ;;
    helm) helm version --short 2>/dev/null ;;
    helmfile) helmfile version 2>/dev/null ;;
  esac | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

# True when $1 is at least $2, comparing the three parts numerically.
at_least() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}

for tool in docker kind kubectl helm helmfile; do
  command -v "${tool}" >/dev/null 2>&1 || fail "Missing required tool: ${tool}."
  minimum="$(eval "echo \${MINIMUM_${tool}}")"
  found="$(version_of "${tool}")"
  [ -n "${found}" ] || fail "Cannot read the version of ${tool}; ${minimum} or newer is required."
  at_least "${found}" "${minimum}" || fail "${tool} ${found} is older than the required ${minimum}."
done

docker info >/dev/null 2>&1 || fail "The Docker daemon is not reachable."

case "${PROFILE}" in
  full) need_cpu=8; need_memory=20; need_disk=60 ;;
  core) need_cpu=4; need_memory=12; need_disk=30 ;;
  *) fail "PROFILE must be full or core, not ${PROFILE}." ;;
esac

have_cpu="$(docker info --format '{{.NCPU}}')"
have_memory="$(docker info --format '{{.MemTotal}}')"
have_disk="$(df -P -k "${root}" | awk 'NR == 2 { print int($4 / 1024 / 1024) }')"
[ "${have_cpu}" -ge "${need_cpu}" ] \
  || fail "Docker has ${have_cpu} CPUs; the ${PROFILE} profile needs ${need_cpu}."
[ "${have_memory}" -ge $((need_memory * 1000 * 1000 * 1000)) ] \
  || fail "Docker has ${have_memory} bytes of memory; the ${PROFILE} profile needs ${need_memory} GB."
[ "${have_disk}" -ge "${need_disk}" ] \
  || fail "${have_disk} GB is free on this disk; the ${PROFILE} profile needs ${need_disk} GB."

# 1 ---------------------------------------------------------------- local registry
log "Local image registry on localhost:${REGISTRY_PORT}"
if [ "$(docker inspect -f '{{.State.Running}}' "${REGISTRY_NAME}" 2>/dev/null || echo false)" != "true" ]; then
  docker run -d --restart=always -p "127.0.0.1:${REGISTRY_PORT}:5000" --name "${REGISTRY_NAME}" "${IMAGE_REGISTRY}"
fi

log "kind cluster ${CLUSTER_NAME} on host ports ${HTTP_PORT} and ${HTTPS_PORT}"
if ! kind get clusters | grep -qx "${CLUSTER_NAME}"; then
  render "${here}/kind-config.yaml" | kind create cluster --name "${CLUSTER_NAME}" --config -
fi
kubectl config use-context "kind-${CLUSTER_NAME}"

# Every node is told where the registry lives, the way the kind local-registry pattern does.
for node in $(kind get nodes --name "${CLUSTER_NAME}"); do
  docker exec "${node}" mkdir -p "/etc/containerd/certs.d/localhost:${REGISTRY_PORT}"
  docker exec -i "${node}" cp /dev/stdin "/etc/containerd/certs.d/localhost:${REGISTRY_PORT}/hosts.toml" <<EOF
[host."http://${REGISTRY_NAME}:5000"]
EOF
done
if [ "$(docker inspect -f '{{json .NetworkSettings.Networks.kind}}' "${REGISTRY_NAME}")" = 'null' ]; then
  docker network connect kind "${REGISTRY_NAME}"
fi
kubectl apply -f "${here}/local-registry-configmap.yaml"

# A browser for the registry's repositories, tags and digests. Its nginx proxies to the
# registry over the kind network, so the registry needs no CORS configuration.
log "Registry browser on localhost:${REGISTRY_UI_PORT}"
if [ "$(docker inspect -f '{{.State.Running}}' "${REGISTRY_NAME}-ui" 2>/dev/null || echo false)" != "true" ]; then
  docker run -d --restart=always -p "127.0.0.1:${REGISTRY_UI_PORT}:80" --network kind \
    --name "${REGISTRY_NAME}-ui" \
    -e SINGLE_REGISTRY=true -e REGISTRY_TITLE="AWP local registry" \
    -e NGINX_PROXY_PASS_URL="http://${REGISTRY_NAME}:5000" \
    -e DELETE_IMAGES=true -e SHOW_CONTENT_DIGEST=true -e SHOW_CATALOG_NB_TAGS=true \
    "${IMAGE_REGISTRY_UI}"
fi

# 2 ------------------------------------------------------------------------ Cilium
# Stack specification 3.3 asks only for a CNI that enforces NetworkPolicy, and leaves the
# choice to the cluster platform. Cilium is what enforces it on the Docker Desktop WSL2
# kernel here.
log "Cilium ${CILIUM_VERSION}"
helm repo add cilium https://helm.cilium.io >/dev/null
helm repo update >/dev/null
# Cilium's L7 proxy needs `iptables -m socket --transparent`, and the Docker Desktop WSL2
# kernel registers no `socket` match and has no loadable modules, so its iptables
# reconciliation never completes and the datapath is left without its rules. The platform
# enforces plain NetworkPolicy, which is L3 and L4, so the L7 proxy is turned off.
helm upgrade --install cilium cilium/cilium \
  --version "${CILIUM_VERSION}" \
  --namespace kube-system \
  --set kubeProxyReplacement=false \
  --set image.pullPolicy=IfNotPresent \
  --set operator.replicas=1 \
  --set l7Proxy=false \
  --wait
kubectl -n kube-system rollout status deploy/cilium-operator --timeout=5m

# 3 ------------------------------------------------------ Gateway API and Traefik
log "Gateway API ${GATEWAY_API_VERSION} (experimental channel) and Traefik ${TRAEFIK_VERSION}"
kubectl apply --server-side --force-conflicts \
  -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/experimental-install.yaml"
helm repo add traefik https://traefik.github.io/charts >/dev/null
helm repo update >/dev/null
# The values carry the host ports, so they go through the renderer like the manifests.
render "${here}/traefik-values.yaml" | helm upgrade --install traefik traefik/traefik   --version "${TRAEFIK_VERSION}"   --namespace awp-system --create-namespace   --values -   --wait
kubectl -n awp-system rollout status deploy/traefik --timeout=5m

# 4 ------------------------------------------------------------------ cert-manager
# Stack specification 3.3 asks for a TLS Secret for the public hosts. cert-manager with a
# local certificate authority produces one, without asking for mkcert on the host.
log "cert-manager ${CERT_MANAGER_VERSION}"
helm repo add jetstack https://charts.jetstack.io >/dev/null
helm repo update >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --version "${CERT_MANAGER_VERSION}" \
  --namespace awp-system --create-namespace \
  --set crds.enabled=true \
  --wait
kubectl apply -f "${here}/local-ca.yaml"

# 5 --------------------------------------------------------------------- operators
log "CloudNativePG ${CNPG_VERSION} and the agentgateway CRDs ${AGENTGATEWAY_VERSION}"
helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null
helm repo update >/dev/null
helm upgrade --install cloudnative-pg cnpg/cloudnative-pg \
  --version "${CNPG_VERSION}" --namespace awp-system --create-namespace --wait
helm upgrade --install agentgateway-crds oci://ghcr.io/agentgateway/charts/agentgateway-crds \
  --version "${AGENTGATEWAY_VERSION}" --namespace awp-ai --create-namespace --wait

# 6 --------------------------------------------------------- namespaces and secrets
log "Namespaces and secrets"
kubectl apply -f "${here}/namespaces.yaml"
"${root}/scripts/secrets-from-env.sh"

# 7 ----------------------------------------------------------- the platform charts
log "Platform charts (helmfile -e local, profile ${PROFILE}, NO_ROOK=${NO_ROOK})"
# `sync`, not `apply`: `apply` needs the helm-diff plugin, and `helm upgrade --install`
# for every release is idempotent on its own.
PROFILE="${PROFILE}" NO_ROOK="${NO_ROOK}" helmfile -f "${root}/infra/platform/helmfile.yaml" -e local sync

# 7b -------------------------------------------- data-tier admin consoles (local dev)
log "Data-tier admin consoles (Adminer, RedisInsight)"
kubectl apply -f "${root}/infra/platform/admin-tools.yaml"

# 8 ------------------------------------------------ gateway, hostnames and policies
log "Gateway, hostnames and policies"
render "${root}/infra/gateway/gateway.yaml" | kubectl apply -f -
render "${root}/infra/gateway/middlewares.yaml" | kubectl apply -f -
render "${root}/infra/gateway/httproutes.yaml" | kubectl apply -f -
if [ "${NO_ROOK}" != "0" ]; then
  render "${root}/infra/gateway/object-store-routes.yaml" | kubectl apply -f -
fi

"${root}/scripts/cluster-dns.sh"
"${root}/scripts/cluster-host-access.sh"

kubectl apply -f "${root}/infra/policies/"

# 9 -------------------------------------------------- the Temporal namespace `awp`
log "Temporal namespace"
"${root}/scripts/temporal-namespace.sh"

# 10 ------------------------------------------------------ the application release
log "Application images"
"${root}/scripts/build-images.sh"

log "charts/awp"
helm upgrade --install awp "${root}/infra/charts/awp" \
  --namespace awp-app \
  --values "${root}/infra/charts/values/values-local.yaml" \
  --set config.appUrl="$("${root}/scripts/public-origin.sh" https awp.localtest.me)" \
  --wait --timeout 15m

log "Ready at $("${root}/scripts/public-origin.sh" https awp.localtest.me). Next: make seed."
