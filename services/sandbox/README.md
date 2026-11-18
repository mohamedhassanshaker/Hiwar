# `services/sandbox`

The sandbox manager. It gives an agent run a workspace Pod in the `awp-sandbox` namespace,
executes commands in it, and destroys it. It never runs agent code itself.

## What makes a sandbox safe

Every one of these is set in `src/awp_sandbox/spec.py` and asserted by name in
`tests/test_spec.py`:

| Property | Why |
| --- | --- |
| `automountServiceAccountToken: false` | Code in a sandbox cannot reach the Kubernetes API at all. |
| `readOnlyRootFilesystem: true` | Only `/workspace` and `/tmp` are writable, and both are size-limited `emptyDir`s. |
| `capabilities: drop: [ALL]`, non-root, no privilege escalation | The least privileged process the platform can give. |
| CPU, memory, ephemeral-storage limits and `activeDeadlineSeconds` | A run that loops forever costs one sandbox, not a node. |
| `HTTP_PROXY` / `HTTPS_PROXY` to the egress proxy | The NetworkPolicy blocks everything else; the proxy holds the domain allow-list. |
| `nodeSelector: awp/pool=sandbox` | A sandbox never shares a node with the application. |
| `runtimeClassName` only when configured | Set from `SANDBOX_RUNTIME_CLASS`; the cluster defines a `gvisor` RuntimeClass (`infra/policies/runtimeclass.yaml`). No chart values set it today, so sandboxes run on plain `runc` in every environment. The sandbox technology is an open decision (SPEC-11.2-b in [stack decisions](../../docs/04-decisions/stack-decisions.md)). |

A warm pool keeps a few idle Pods ready; claiming one is a relabel, which is what makes the
claim atomic. A sandbox is never reused between runs. `POST /sandboxes` returns the run's own
Pod while it is running, so a caller keeps no sandbox id between calls; `DELETE
/sandboxes?run_id=` removes a run's Pods when it ends. The pool deletes Pods that ended and
idle ones past half their deadline, because a warm Pod's deadline runs from its start.

A file crosses `/files` as base64 and is written in chunks of command arguments, so the path
and the bytes are never part of a shell script.

## The workspace image

`workspace/` builds `awp/sandbox-workspace`, what a sandbox Pod runs: Python 3.12 with the
libraries in `workspace/pyproject.toml` and Node 24 with those in `workspace/package.json`,
for the scripts an Agent Skill ships (D209). It carries no LibreOffice. `package.json`
overrides `image-size` to 2.x: pptxgenjs 4.0.1 declares 1.x, which has advisories, and never
loads it.

## Commands

```bash
uv sync
uv run ruff check .
uv run mypy .
uv run pytest
```
