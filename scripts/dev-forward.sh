#!/usr/bin/env bash
# Host mode of stack specification 8.7: the platform keeps running in kind and the
# application code runs on the host with hot reload. This opens one port-forward per
# dependency and stays in the foreground; Ctrl-C closes all of them.
#
# With these up:
#   cd apps/web      && npm run dev
#   cd services/agent && uv run uvicorn awp_agent.main:app --reload
set -euo pipefail

declare -a forwards=(
  "awp-data svc/awp-pg-pooler 5432:5432"
  "awp-data svc/valkey-primary 6379:6379"
  "awp-data svc/neo4j 7687:7687"
  "awp-data svc/minio 9000:9000"
  "awp-ai svc/temporal-frontend 7233:7233"
  "awp-ai svc/ai-gateway 8080:8080"
  "awp-ai svc/phoenix 6006:6006"
)

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    [ -n "${pid}" ] && kill "${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "Port-forwards (Ctrl-C to stop):"
for forward in "${forwards[@]}"; do
  read -r namespace target ports <<<"${forward}"
  if ! kubectl -n "${namespace}" get "${target}" >/dev/null 2>&1; then
    echo "  ${namespace}/${target} is not in the cluster, skipped"
    continue
  fi
  kubectl -n "${namespace}" port-forward "${target}" "${ports}" >/dev/null 2>&1 &
  pids+=("$!")
  echo "  ${namespace}/${target} on ${ports%%:*}"
done

[ "${#pids[@]}" -gt 0 ] || { echo "Nothing to forward. Is the cluster up?" >&2; exit 1; }
wait
