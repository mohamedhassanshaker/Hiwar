#!/usr/bin/env bash
# `*.awp.localtest.me` resolves to 127.0.0.1, which inside a Pod is the Pod itself. This
# teaches CoreDNS to answer those names with the gateway's Service instead, so the console
# and the admin hosts are the same origin in the browser and in the cluster — which an OIDC issuer string requires.
#
# Traefik serves every Gateway from its own Service rather than generating one per gateway,
# so the Service is found by Traefik's chart labels. The block is replaced rather than
# appended, so re-running changes nothing.
set -euo pipefail

gateway_namespace="${GATEWAY_NAMESPACE:-awp-system}"
begin="# awp.localtest.me begin"
end="# awp.localtest.me end"

service="$(kubectl -n "${gateway_namespace}" get service \
  -l "app.kubernetes.io/name=traefik" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
[ -n "${service}" ] || {
  echo "No Traefik Service in ${gateway_namespace}; is the gateway installed?" >&2
  exit 1
}
target="${service}.${gateway_namespace}.svc.cluster.local"

current="$(kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}')"
rendered="$(printf '%s\n' "${current}" | awk -v target="${target}" -v begin="${begin}" -v end="${end}" '
  index($0, begin) { skip = 1; next }
  index($0, end) { skip = 0; next }
  skip { next }
  { print }
  /^\.:53 \{/ {
    print "    " begin
    print "    rewrite name exact awp.localtest.me " target
    # `answer auto` rewrites the response name back to the one asked for; without it a
    # resolver discards the answer as a mismatch.
    print "    rewrite name regex [^.]+\\.awp\\.localtest\\.me " target " answer auto"
    print "    " end
  }
')"

if [ "${rendered}" = "${current}" ]; then
  echo "  CoreDNS already answers *.awp.localtest.me with ${target}"
  exit 0
fi

patch="$(kubectl create configmap coredns --from-literal=Corefile="${rendered}" --dry-run=client -o json \
  | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(JSON.stringify({ data: JSON.parse(s).data })))')"
kubectl -n kube-system patch configmap coredns --type merge -p "${patch}" >/dev/null
kubectl -n kube-system rollout restart deployment coredns >/dev/null
kubectl -n kube-system rollout status deployment coredns --timeout=5m >/dev/null
echo "  CoreDNS answers *.awp.localtest.me with ${target}"
