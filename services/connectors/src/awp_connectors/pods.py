"""One Pod per stdio connector.

A stdio MCP server is somebody else's program: it is usually an `npx` package, it may be
chatty, it may leak memory, and it holds that connector's credentials. Running them all as
child processes of one service would put them in one blast radius and one memory limit, so each
one gets its own Deployment and Service in `awp-app`, running this same image in **bridge**
mode: the bridge starts that one stdio server and exposes it over Streamable HTTP.

The control-plane process then only proxies. It never runs a connector's code.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from kubernetes import client
from kubernetes import config as kube_config
from kubernetes.client.rest import ApiException

from awp_connectors.config import settings
from awp_connectors.logging import logger
from awp_connectors.registry import ConnectorSpec

log = logger("awp_connectors.pods")

BRIDGE_PORT = 8080
#: Where the control process keeps the set it was last given, so a restart is not a loss.
STATE_CONFIGMAP = "connector-runtime-state"
STATE_KEY = "connectors.json"
#: How long a save waits for a connector's bridge to be ready before calling it failed.
READY_TIMEOUT_SECONDS = 90.0
READY_POLL_SECONDS = 1.0
LABEL_MANAGED = "awp.tahseel.ae/managed-by"
LABEL_CONNECTOR = "awp.tahseel.ae/connector-id"


class PodError(RuntimeError):
    """The connector's Pod could not be created or removed."""


def workload_name(connector_id: str) -> str:
    """The Deployment, Service and DNS name of one connector."""
    return f"connector-{connector_id}"


def service_url(connector_id: str) -> str:
    """The Streamable HTTP endpoint of one connector's bridge."""
    return (
        f"http://{workload_name(connector_id)}.{settings().namespace}.svc:{BRIDGE_PORT}/mcp"
    )


def deployment_manifest(connector: ConnectorSpec, image: str) -> dict[str, Any]:
    """The Deployment that runs one connector's bridge."""
    config = settings()
    name = workload_name(connector.connector_id)
    labels = {LABEL_MANAGED: "connector-runtime", LABEL_CONNECTOR: connector.connector_id}
    container: dict[str, Any] = {
        "name": "bridge",
        "image": image,
        "imagePullPolicy": config.image_pull_policy,
        "command": [
            "uvicorn",
            "awp_connectors.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(BRIDGE_PORT),
        ],
        "ports": [{"containerPort": BRIDGE_PORT, "name": "http"}],
        "env": [
            {"name": "CONNECTOR_MODE", "value": "bridge"},
            {"name": "CONNECTOR_ID", "value": connector.connector_id},
            # What to start. Without it the bridge comes up serving nothing, which the
            # control process can only see as a connection that goes nowhere.
            {"name": "CONNECTOR_SPEC", "value": connector.model_dump_json()},
            {"name": "HTTP_PROXY", "value": config.egress_proxy},
            {"name": "HTTPS_PROXY", "value": config.egress_proxy},
            {"name": "NO_PROXY", "value": "localhost,127.0.0.1,.svc,.cluster.local"},
        ],
        "resources": {
            "limits": {"cpu": "500m", "memory": "512Mi"},
            "requests": {"cpu": "50m", "memory": "128Mi"},
        },
        "securityContext": {
            "allowPrivilegeEscalation": False,
            "readOnlyRootFilesystem": True,
            "capabilities": {"drop": ["ALL"]},
        },
        "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}],
        "readinessProbe": {
            "httpGet": {"path": "/healthz", "port": BRIDGE_PORT},
            "initialDelaySeconds": 3,
            "periodSeconds": 5,
        },
    }
    volumes: list[dict[str, Any]] = [{"name": "tmp", "emptyDir": {"sizeLimit": "64Mi"}}]

    if connector.env_from_secret:
        container["volumeMounts"].append(
            {
                "name": "connector-secret",
                "mountPath": f"{config.secrets_path}/{connector.env_from_secret}",
                "readOnly": True,
            }
        )
        volumes.append(
            {
                "name": "connector-secret",
                "secret": {"secretName": f"connector-{connector.env_from_secret}"},
            }
        )

    return {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {"name": name, "namespace": config.namespace, "labels": labels},
        "spec": {
            "replicas": 1,
            "selector": {"matchLabels": labels},
            "template": {
                "metadata": {"labels": labels},
                "spec": {
                    "automountServiceAccountToken": False,
                    "securityContext": {
                        "runAsNonRoot": True,
                        "runAsUser": 10001,
                        "seccompProfile": {"type": "RuntimeDefault"},
                    },
                    "containers": [container],
                    "volumes": volumes,
                },
            },
        },
    }


def service_manifest(connector: ConnectorSpec) -> dict[str, Any]:
    """The Service in front of one connector's bridge."""
    name = workload_name(connector.connector_id)
    labels = {LABEL_MANAGED: "connector-runtime", LABEL_CONNECTOR: connector.connector_id}
    return {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": {"name": name, "namespace": settings().namespace, "labels": labels},
        "spec": {
            "selector": labels,
            "ports": [{"name": "http", "port": BRIDGE_PORT, "targetPort": BRIDGE_PORT}],
        },
    }


def _unavailable_reason(status: Any) -> str:
    """What the Deployment itself says is wrong, when it says anything."""
    for condition in status.status.conditions or []:
        if condition.type in {"Available", "Progressing"} and condition.status != "True":
            return str(condition.message or condition.reason or "")
    return ""


def _load_kube_config() -> None:
    try:
        kube_config.load_incluster_config()
    except kube_config.ConfigException:
        kube_config.load_kube_config()
    # kubernetes 35.0.0's Configuration reads NO_PROXY and then resets it to None, so every API
    # call went through the egress proxy and the runtime could not start while the proxy was down.
    no_proxy = os.environ.get("NO_PROXY") or os.environ.get("no_proxy")
    if no_proxy:
        configuration = client.Configuration.get_default_copy()
        configuration.no_proxy = no_proxy
        client.Configuration.set_default(configuration)


class PodManager:
    """Creates and removes the Deployment and Service of each stdio connector."""

    def __init__(self, image: str) -> None:
        """Load the in-cluster Kubernetes config, or the local kubeconfig outside a cluster.

        Raises when neither can be loaded; the caller then runs without a pod manager.
        """
        _load_kube_config()
        self.image = image
        self.apps = client.AppsV1Api()
        self.core = client.CoreV1Api()
        self.namespace = settings().namespace

    async def ensure(self, connector: ConnectorSpec) -> str:
        """Create or update one connector's workload. Returns its Streamable HTTP endpoint."""
        deployment = deployment_manifest(connector, self.image)
        service = service_manifest(connector)
        name = workload_name(connector.connector_id)
        await self._apply(
            self.apps.create_namespaced_deployment,
            self.apps.patch_namespaced_deployment,
            name,
            deployment,
        )
        await self._apply(
            self.core.create_namespaced_service,
            self.core.patch_namespaced_service,
            name,
            service,
        )
        # The save is what the admin clicks Test connection after, so it returns when the
        # bridge can answer rather than when the API accepted the manifest. Otherwise the
        # first handshake of every stdio connector fails on a Pod that is still starting.
        await self._wait_until_available(name)
        return service_url(connector.connector_id)

    async def _wait_until_available(self, name: str) -> None:
        """Wait for the bridge to have a ready replica.

        :raises PodError: when it does not become available in time, naming what the
            Deployment last said so the reason reaches the Connectors screen.
        """
        deadline = asyncio.get_running_loop().time() + READY_TIMEOUT_SECONDS
        reason = "it did not become ready"
        while asyncio.get_running_loop().time() < deadline:
            try:
                status = await asyncio.to_thread(
                    self.apps.read_namespaced_deployment_status, name=name, namespace=self.namespace
                )
            except ApiException as problem:
                raise PodError(f"could not read {name}: {problem.reason}") from problem
            if (status.status.available_replicas or 0) >= 1:
                return
            reason = _unavailable_reason(status) or reason
            await asyncio.sleep(READY_POLL_SECONDS)
        raise PodError(f"{name} did not start: {reason}")

    async def save_configuration(self, connectors: list[ConnectorSpec]) -> None:
        """Keep the set the web app pushed, so a restart does not lose every connector.

        The web app owns this configuration and this is only its cache, but without it a
        restarted runtime serves nothing and every agent tool call answers 404 until
        somebody happens to save a connector again. A spec carries a secret's name and
        never its value, so a ConfigMap is the right shape for it.
        """
        body = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": STATE_CONFIGMAP, "namespace": self.namespace},
            "data": {
                STATE_KEY: json.dumps([connector.model_dump() for connector in connectors])
            },
        }
        await self._apply(
            self.core.create_namespaced_config_map,
            self.core.patch_namespaced_config_map,
            STATE_CONFIGMAP,
            body,
        )

    async def load_configuration(self) -> list[ConnectorSpec]:
        """The set this runtime was last given. Empty when it has never been given one."""
        try:
            stored = await asyncio.to_thread(
                self.core.read_namespaced_config_map,
                name=STATE_CONFIGMAP,
                namespace=self.namespace,
            )
        except ApiException as problem:
            if problem.status == 404:
                return []
            raise PodError(f"could not read {STATE_CONFIGMAP}: {problem.reason}") from problem
        raw = (stored.data or {}).get(STATE_KEY, "[]")
        return [ConnectorSpec.model_validate(item) for item in json.loads(raw)]

    async def remove(self, connector_id: str) -> None:
        """Delete one connector's workload. A connector that is gone leaves no process behind."""
        name = workload_name(connector_id)
        deletes = (
            self.apps.delete_namespaced_deployment,
            self.core.delete_namespaced_service,
        )
        for delete in deletes:
            try:
                await asyncio.to_thread(delete, name=name, namespace=self.namespace)
            except ApiException as problem:
                if problem.status != 404:
                    raise PodError(f"could not remove {name}: {problem.reason}") from problem

    async def _apply(
        self,
        create: Any,
        patch: Any,
        name: str,
        body: dict[str, Any],
    ) -> None:
        """Create the object, or patch it in place when it already exists (409).

        Any other create failure raises `PodError`; a failed patch raises the API's error.
        """
        try:
            await asyncio.to_thread(create, namespace=self.namespace, body=body)
        except ApiException as problem:
            if problem.status != 409:
                raise PodError(f"could not create {name}: {problem.reason}") from problem
            await asyncio.to_thread(patch, name=name, namespace=self.namespace, body=body)
