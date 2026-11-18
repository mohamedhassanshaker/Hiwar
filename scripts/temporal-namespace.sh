#!/usr/bin/env bash
# Registers the Temporal namespace the agent service and its three workers connect to.
# The Temporal chart creates none, so without this every worker fails its first call.
# Registering a namespace that already exists is reported and left alone.
set -euo pipefail

namespace="${AI_NAMESPACE:-awp-ai}"
temporal_namespace="${TEMPORAL_NAMESPACE:-awp}"
retention="${TEMPORAL_RETENTION:-7d}"
# The full service name: inside the admin tools pod the short `temporal-frontend:7233` timed out
# (2026-10-31), while the name the workers use answers at once.
address="${TEMPORAL_ADMIN_ADDRESS:-temporal-frontend.${namespace}.svc.cluster.local:7233}"

kubectl -n "${namespace}" rollout status deployment temporal-admintools --timeout=10m >/dev/null

if kubectl -n "${namespace}" exec deployment/temporal-admintools -- \
  temporal operator namespace describe --address "${address}" "${temporal_namespace}" >/dev/null 2>&1; then
  echo "  ${temporal_namespace} is already registered"
  exit 0
fi

kubectl -n "${namespace}" exec deployment/temporal-admintools -- \
  temporal operator namespace create --address "${address}" --retention "${retention}" "${temporal_namespace}" >/dev/null
echo "  ${temporal_namespace} registered with a ${retention} retention"
