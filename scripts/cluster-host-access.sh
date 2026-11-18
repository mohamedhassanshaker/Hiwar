#!/usr/bin/env bash
# Local kind cluster only (D222): lets the connector runtime reach a server running on this
# machine, as http://host.docker.internal:<port> or by this machine's own name (D297), so a
# custom MCP server under development can be registered as a connector. Inside a Pod,
# 127.0.0.1 is the Pod itself.
#
# Two pieces, both scoped to that one address: CoreDNS answers host.docker.internal with the
# host's address, and a CiliumNetworkPolicy lets the connector runtime, and nothing else,
# reach it. Every other egress stays as infra/policies/ sets it. Re-running changes nothing.
set -euo pipefail

begin="# host.docker.internal begin"
end="# host.docker.internal end"

# Docker Desktop names the host for containers; the registry container sees it as one.
host_ip="${HOST_GATEWAY_IP:-$(docker exec kind-registry getent hosts host.docker.internal 2>/dev/null | awk '{print $1; exit}' || true)}"
[ -n "${host_ip}" ] || {
  echo "  host.docker.internal does not resolve here; set HOST_GATEWAY_IP to reach the host." >&2
  exit 0
}
# This machine's own name, which cluster DNS cannot otherwise resolve.
machine="$(printf '%s' "${HOST_NAME:-$(hostname)}" | tr '[:upper:]' '[:lower:]')"

current="$(kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}')"
rendered="$(printf '%s\n' "${current}" | awk -v ip="${host_ip}" -v machine="${machine}" -v begin="${begin}" -v end="${end}" '
  index($0, begin) { skip = 1; next }
  index($0, end) { skip = 0; next }
  skip { next }
  { print }
  /^\.:53 \{/ {
    print "    " begin
    print "    hosts {"
    print "       " ip " host.docker.internal " machine
    print "       fallthrough"
    print "    }"
    print "    " end
  }
')"

if [ "${rendered}" != "${current}" ]; then
  patch="$(kubectl create configmap coredns --from-literal=Corefile="${rendered}" --dry-run=client -o json \
    | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(JSON.stringify({ data: JSON.parse(s).data })))')"
  kubectl -n kube-system patch configmap coredns --type merge -p "${patch}" >/dev/null
  kubectl -n kube-system rollout restart deployment coredns >/dev/null
  kubectl -n kube-system rollout status deployment coredns --timeout=5m >/dev/null
fi

kubectl apply -f - >/dev/null <<YAML
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: connector-runtime-to-host
  namespace: awp-app
spec:
  endpointSelector:
    matchLabels:
      app.kubernetes.io/name: connector-runtime
  egress:
    - toCIDR:
        - ${host_ip}/32
YAML
echo "  The connector runtime reaches this machine as host.docker.internal or ${machine} (${host_ip})"
