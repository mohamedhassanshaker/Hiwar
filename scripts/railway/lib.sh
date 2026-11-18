#!/usr/bin/env bash
# Shared settings and helpers of the Railway deployment (D390). Sourced by the other
# scripts in this folder; touches nothing the kind scripts use.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The Railway project, its environment, and where the images this repository builds go.
project="${RAILWAY_PROJECT:-tawp}"
environment="${RAILWAY_ENVIRONMENT:-production}"
registry="${DOCKERHUB_NAMESPACE:-mhassanshaker31}"
tag="${IMAGE_TAG:-$(git -C "${root}" rev-parse --short HEAD)}"

step() { printf '\n=== %s ===\n' "$1"; }
fail() { echo "error: $*" >&2; exit 1; }

# The image reference of one application, e.g. `image_of web`.
image_of() { echo "docker.io/${registry}/awp-$1:${tag}"; }

# One GraphQL call through the logged-in CLI; the document comes on stdin.
gql() { railway api --file - "$@"; }

# The linked project's and environment's ids, read once.
ids() {
  railway status --json | python -I -c '
import json, sys
d = json.load(sys.stdin)
env = d["environments"]["edges"][0]["node"]
for e in d["environments"]["edges"]:
    if e["node"]["name"] == sys.argv[1]:
        env = e["node"]
print(d["id"], env["id"])
' "${environment}"
}

# The names of the services in the project, one per line.
service_names() {
  railway status --json | python -I -c '
import json, sys
for e in json.load(sys.stdin)["services"]["edges"]:
    print(e["node"]["name"])
'
}

has_service() { service_names | grep -qxF "$1"; }

# The id of one service by name.
service_id() {
  railway status --json | python -I -c '
import json, sys
for e in json.load(sys.stdin)["services"]["edges"]:
    if e["node"]["name"] == sys.argv[1]:
        print(e["node"]["id"])
' "$1"
}

# A random secret: base64 of N bytes (default 32), or hex with `hex`.
random_secret() {
  if [ "${2:-}" = "hex" ]; then openssl rand -hex "${1:-32}"; else openssl rand -base64 "${1:-32}"; fi
}

# A private temporary directory, spelt so the Windows Python and Railway executables can
# open it under Git Bash. The caller removes it.
scratch_dir() {
  local dir
  dir="$(mktemp -d)"
  command -v cygpath >/dev/null && dir="$(cygpath -m "${dir}")"
  echo "${dir}"
}

# Upserts variables, read as KEY=VALUE lines on stdin, on one service ("" for shared),
# without deploying. Needs `project_id`, `environment_id` (from `ids`) and a `tmp` directory.
upsert() {
  python -I -c '
import json, sys
service, project, environment, path = sys.argv[1:5]
variables = dict(line.split("=", 1) for line in sys.stdin.read().splitlines() if line.strip())
data = {"projectId": project, "environmentId": environment, "variables": variables, "skipDeploys": True}
if service:
    data["serviceId"] = service
open(path, "w").write(json.dumps({"input": data}))
print("mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }")
' "$1" "${project_id}" "${environment_id}" "${tmp}/vars.json" \
    | railway api --file - --variables "@${tmp}/vars.json" >/dev/null
}
