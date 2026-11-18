#!/usr/bin/env bash
# Build the web and agent images, push them to the kind registry, run the database migrations
# with the web image, roll them out, and check that every pod runs the new digest.
# On Windows, scripts\deploy-cluster.bat runs this through Git Bash.
#
#   scripts/deploy-cluster.sh            # web and agent
#   scripts/deploy-cluster.sh web        # one of them
#   scripts/deploy-cluster.sh connectors # the connector runtime
#   ALLOW_IN_FLIGHT=1 scripts/deploy-cluster.sh   # deploy over missions still running
#
# A build here has reported success without a new image reaching the registry, so the
# registry digest is compared before and after, and the pods' own image ids are the proof
# that the rollout took. Missions in flight are refused by default: a change to the mission
# workflow's code would replay their history against code that did not write it
# (docs/10-devops-and-deployment/deployment.md, "Draining in-flight runs first").
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
registry="localhost:${REGISTRY_PORT:-5001}"
namespace="awp-app"
context="kind-${CLUSTER_NAME:-awp}"
targets="${1:-all}"

step() { printf '\n=== %s ===\n' "$1"; }
fail() { echo "deploy-cluster: $*" >&2; exit 1; }

# The registry digest of one repository at the tag the chart pins.
tag_of() {
  helm template awp "${root}/infra/charts/awp" --values "${root}/infra/charts/values/values-local.yaml" \
    | grep -oE "${registry}/$1:[A-Za-z0-9._-]+" | head -1 | sed "s#.*:##"
}
digest_of() {
  curl -fsS -o /dev/null -D - \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    -H "Accept: application/vnd.oci.image.manifest.v1+json" \
    -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    "http://${registry}/v2/$1/manifests/$2" | awk 'tolower($1) == "docker-content-digest:" {print $2}' | tr -d '\r'
}
# The node platform's image inside the index `$1@$2`. A rebuild of unchanged code pushes a new
# index (its build attestation differs) around the same image, and a node that already holds
# that image reports the index it first pulled it under, so pods are compared by the image.
node_arch=""
image_of() {
  [ -n "${node_arch}" ] || node_arch="$(kubectl --context "${context}" get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}')"
  docker buildx imagetools inspect "${registry}/$1@$2" --format \
    "{{range .Manifest.Manifests}}{{\$d := .Digest}}{{with .Platform}}{{if eq .Architecture \"${node_arch}\"}}{{\$d}}{{end}}{{end}}{{end}}"
}

# The chart's migration Job, run from the web image just pushed, before the web pods restart,
# as the pre-upgrade hook does on `helm upgrade` (stack specification 8.5).
migrate() {
  local kc=(kubectl --context "${context}" -n "${namespace}") state
  "${kc[@]}" delete job db-migrate --ignore-not-found --wait=true
  helm template awp "${root}/infra/charts/awp" --values "${root}/infra/charts/values/values-local.yaml" \
    --show-only templates/db-migrate-job.yaml | "${kc[@]}" apply -f -
  for attempt in $(seq 1 120); do
    state="$("${kc[@]}" get job db-migrate -o jsonpath='{range .status.conditions[?(@.status=="True")]}{.type}{" "}{end}')"
    case "${state}" in
      *Complete*) "${kc[@]}" logs job/db-migrate --tail=20; return 0 ;;
      *Failed*) "${kc[@]}" logs job/db-migrate --tail=50 >&2 || true; fail "the database migration failed" ;;
    esac
    [ "${attempt}" = "120" ] || sleep 5
  done
  fail "the database migration did not finish in 10 minutes"
}

# The deployments that run one image.
deployments_of() {
  case "$1" in
    awp/web) echo "deploy/web" ;;
    awp/agent) kubectl --context "${context}" -n "${namespace}" get deploy -o name | grep -E "^deployment.apps/agent-(service|worker-)" ;;
    awp/connector-runtime) echo "deploy/connector-runtime" ;;
  esac
}

case "${targets}" in
  all) repositories="awp/web awp/agent" ;;
  web) repositories="awp/web" ;;
  agent) repositories="awp/agent" ;;
  connectors) repositories="awp/connector-runtime" ;;
  *) fail "unknown target ${targets}; use web, agent, connectors or all" ;;
esac

step "cluster"
kubectl --context "${context}" get nodes >/dev/null || fail "the ${context} cluster is not reachable"
echo "deploying to ${context}"

step "missions in flight"
running="$(kubectl --context "${context}" -n awp-ai exec deploy/temporal-admintools -- \
  temporal workflow count --namespace awp --query 'ExecutionStatus="Running"' | awk '{print $2}')"
echo "running workflows: ${running}"
if [ "${running}" != "0" ] && [ "${ALLOW_IN_FLIGHT:-0}" != "1" ]; then
  fail "${running} workflows are running. Let them finish or cancel them, or set ALLOW_IN_FLIGHT=1."
fi

for repository in ${repositories}; do
  tag="$(tag_of "${repository}")"
  [ -n "${tag}" ] || fail "the chart pins no tag for ${repository}"
  reference="${registry}/${repository}:${tag}"

  step "build ${reference}"
  before="$(digest_of "${repository}" "${tag}" || true)"
  echo "before: ${before:-none}"
  REBUILD=1 ONLY="${repository}" "${root}/scripts/build-images.sh"
  after="$(digest_of "${repository}" "${tag}")"
  if [ "${after}" = "${before}" ]; then
    echo "the registry still holds the old digest; pushing ${reference} again"
    docker push --quiet "${reference}"
    after="$(digest_of "${repository}" "${tag}")"
  fi
  [ "${after}" != "${before}" ] || fail "${reference} did not reach the registry"
  echo "after:  ${after}"

  if [ "${repository}" = "awp/web" ]; then
    step "migrate the database"
    migrate
  fi

  step "roll out ${repository}"
  mapfile -t deployments < <(deployments_of "${repository}")
  kubectl --context "${context}" -n "${namespace}" rollout restart "${deployments[@]}"
  for deployment in "${deployments[@]}"; do
    kubectl --context "${context}" -n "${namespace}" rollout status "${deployment}" --timeout=10m
  done

  step "pods running ${repository}"
  # An old pod can still be terminating just after the rollout reports done, so the check
  # is repeated for a minute before it calls a pod stale.
  wanted="$(image_of "${repository}" "${after}")"
  [ -n "${wanted}" ] || fail "${repository}@${after} holds no ${node_arch} image"
  declare -A image_by_index=(["${after}"]="${wanted}")
  for attempt in $(seq 1 12); do
    stale=0
    report=""
    while read -r pod image_id; do
      case "${image_id}" in
        *"${repository}@"*) ;;
        *) continue ;;
      esac
      index="${image_id##*@}"
      [ -n "${image_by_index[${index}]+set}" ] || image_by_index["${index}"]="$(image_of "${repository}" "${index}" || true)"
      if [ "${image_by_index[${index}]}" = "${wanted}" ]; then
        report+="  ok    ${pod}"$'\n'
      else
        report+="  STALE ${pod} ${image_id}"$'\n'; stale=1
      fi
    done < <(kubectl --context "${context}" -n "${namespace}" get pods --field-selector=status.phase=Running \
      -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].imageID}{"\n"}{end}')
    [ "${stale}" = "0" ] && break
    [ "${attempt}" = "12" ] || sleep 5
  done
  printf '%s' "${report}"
  [ "${stale}" = "0" ] || fail "some pods still run an old ${repository} image"
done

printf '\n=== deployed: %s ===\n' "${repositories}"
