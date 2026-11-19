"""The Pod a sandbox runs in.

Everything that makes a sandbox safe is in this one function, so it can be read in one go and
tested without a cluster: no service-account token, a read-only root filesystem, every
capability dropped, a non-root user, hard CPU, memory, storage and time limits, and egress only
through the proxy. A change here is a change to the platform's isolation, and the tests in
`tests/test_spec.py` assert each of these properties by name.
"""

from __future__ import annotations

from typing import Any

from awp_sandbox.config import settings

WORKSPACE_MOUNT = "/workspace"
LABEL_MANAGED = "awp.tahseel.ae/managed-by"
LABEL_POOL = "awp.tahseel.ae/pool"
LABEL_RUN = "awp.tahseel.ae/run-id"
LABEL_STATE = "awp.tahseel.ae/state"


def pod_name(sandbox_id: str) -> str:
    """The Pod name of one sandbox."""
    return f"sandbox-{sandbox_id}"


def pod_manifest(sandbox_id: str, run_id: str = "", warm: bool = False) -> dict[str, Any]:
    """The Pod manifest for one workspace sandbox."""
    config = settings()
    pod: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {
            "name": pod_name(sandbox_id),
            "namespace": config.namespace,
            "labels": {
                LABEL_MANAGED: "sandbox-manager",
                LABEL_POOL: "warm" if warm else "assigned",
                LABEL_STATE: "idle" if warm else "busy",
                LABEL_RUN: run_id or "none",
            },
        },
        "spec": {
            "restartPolicy": "Never",
            "automountServiceAccountToken": False,
            "serviceAccountName": config.service_account,
            "enableServiceLinks": False,
            "activeDeadlineSeconds": config.max_seconds,
            "terminationGracePeriodSeconds": 5,
            "nodeSelector": config.node_selector,
            "securityContext": {
                "runAsNonRoot": True,
                "runAsUser": 10001,
                "runAsGroup": 10001,
                "fsGroup": 10001,
                "seccompProfile": {"type": "RuntimeDefault"},
            },
            "containers": [
                {
                    "name": "workspace",
                    "image": config.image,
                    "command": ["sleep", str(config.max_seconds)],
                    "workingDir": WORKSPACE_MOUNT,
                    "env": [
                        {"name": "HTTP_PROXY", "value": config.egress_proxy},
                        {"name": "HTTPS_PROXY", "value": config.egress_proxy},
                        {"name": "NO_PROXY", "value": "localhost,127.0.0.1"},
                        {"name": "HOME", "value": WORKSPACE_MOUNT},
                    ],
                    "resources": {
                        "limits": {
                            "cpu": config.cpu_limit,
                            "memory": config.memory_limit,
                            "ephemeral-storage": config.ephemeral_storage_limit,
                        },
                        "requests": {
                            "cpu": "100m",
                            "memory": "128Mi",
                            "ephemeral-storage": "256Mi",
                        },
                    },
                    "securityContext": {
                        "allowPrivilegeEscalation": False,
                        "readOnlyRootFilesystem": True,
                        "privileged": False,
                        "capabilities": {"drop": ["ALL"]},
                    },
                    "volumeMounts": [
                        {"name": "workspace", "mountPath": WORKSPACE_MOUNT},
                        {"name": "tmp", "mountPath": "/tmp"},
                    ],
                }
            ],
            "volumes": [
                {"name": "workspace", "emptyDir": {"sizeLimit": config.ephemeral_storage_limit}},
                {"name": "tmp", "emptyDir": {"sizeLimit": "64Mi"}},
            ],
        },
    }
    if config.runtime_class:
        pod["spec"]["runtimeClassName"] = config.runtime_class
    return pod
