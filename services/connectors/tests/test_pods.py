"""One Pod per stdio connector: the manifests, and what they do and do not carry."""

from __future__ import annotations

import json

import pytest

from awp_connectors.config import settings
from awp_connectors.pods import (
    BRIDGE_PORT,
    LABEL_CONNECTOR,
    STATE_KEY,
    deployment_manifest,
    service_manifest,
    service_url,
    workload_name,
)
from awp_connectors.registry import ConnectorSpec

IMAGE = "localhost:5001/awp/connector-runtime:dev"


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONNECTOR_NAMESPACE", "awp-app")
    monkeypatch.setenv("EGRESS_PROXY_URL", "http://egress-proxy.awp-app.svc:3128")
    monkeypatch.setenv("CONNECTOR_SECRETS_PATH", "/run/secrets/connectors")
    settings.cache_clear()


def _connector(secret: str = "sap") -> ConnectorSpec:
    return ConnectorSpec(
        connector_id="c-1",
        name="SAP",
        transport="stdio",
        command=["npx", "-y", "@tahseel/sap-mcp"],
        env_from_secret=secret,
    )


def test_each_connector_gets_its_own_workload() -> None:
    """A connector that misbehaves can affect nothing but itself."""
    assert workload_name("c-1") == "connector-c-1"
    assert deployment_manifest(_connector(), IMAGE)["metadata"]["name"] == "connector-c-1"
    assert service_manifest(_connector())["metadata"]["name"] == "connector-c-1"


def test_the_pod_runs_the_bridge_mode_of_this_same_image() -> None:
    """The bridge starts exactly one stdio server and exposes it over Streamable HTTP."""
    spec = deployment_manifest(_connector(), IMAGE)["spec"]["template"]["spec"]
    container = spec["containers"][0]
    env = {item["name"]: item["value"] for item in container["env"]}
    assert container["image"] == IMAGE
    assert env["CONNECTOR_MODE"] == "bridge"
    assert env["CONNECTOR_ID"] == "c-1"


def test_the_pod_gets_no_service_account_token() -> None:
    """A connector is third-party code; it never talks to the Kubernetes API."""
    spec = deployment_manifest(_connector(), IMAGE)["spec"]["template"]["spec"]
    assert spec["automountServiceAccountToken"] is False
    assert spec["securityContext"]["runAsNonRoot"] is True


def test_egress_goes_through_the_proxy_but_cluster_traffic_does_not() -> None:
    """A connector reaches the internet only through the allow-list; the Service mesh is local."""
    spec = deployment_manifest(_connector(), IMAGE)["spec"]["template"]["spec"]
    container = spec["containers"][0]
    env = {item["name"]: item["value"] for item in container["env"]}
    assert env["HTTPS_PROXY"] == "http://egress-proxy.awp-app.svc:3128"
    assert ".svc" in env["NO_PROXY"]


def test_the_secret_is_mounted_read_only_and_never_put_in_the_environment() -> None:
    """The value reaches the connector as a mounted file, not as a visible variable."""
    spec = deployment_manifest(_connector(), IMAGE)["spec"]["template"]["spec"]
    mounts = {mount["name"]: mount for mount in spec["containers"][0]["volumeMounts"]}
    assert mounts["connector-secret"]["readOnly"] is True
    assert mounts["connector-secret"]["mountPath"] == "/run/secrets/connectors/sap"
    volume = next(item for item in spec["volumes"] if item["name"] == "connector-secret")
    assert volume["secret"]["secretName"] == "connector-sap"
    env_names = {item["name"] for item in spec["containers"][0]["env"]}
    assert "SAP_API_KEY" not in env_names


def test_a_connector_without_a_secret_mounts_nothing_extra() -> None:
    """Not every connector needs credentials."""
    spec = deployment_manifest(_connector(secret=""), IMAGE)["spec"]["template"]["spec"]
    assert {volume["name"] for volume in spec["volumes"]} == {"tmp"}


def test_the_service_url_is_what_the_control_process_proxies_to() -> None:
    """The harness always sees one Streamable HTTP endpoint per connector."""
    assert service_url("c-1") == f"http://connector-c-1.awp-app.svc:{BRIDGE_PORT}/mcp"


def test_the_workload_is_labelled_with_its_connector() -> None:
    """Removing a connector has to find everything it created."""
    labels = deployment_manifest(_connector(), IMAGE)["metadata"]["labels"]
    assert labels[LABEL_CONNECTOR] == "c-1"


def test_the_pod_is_told_what_to_start() -> None:
    """Without the spec the bridge comes up serving nothing, and only a 404 says so."""
    pod = deployment_manifest(_connector(), IMAGE)["spec"]["template"]["spec"]
    env = {item["name"]: item["value"] for item in pod["containers"][0]["env"]}
    spec = ConnectorSpec.model_validate_json(env["CONNECTOR_SPEC"])
    assert spec.command == ["npx", "-y", "@tahseel/sap-mcp"]
    # The secret's name travels with the spec; its value arrives as a mounted Secret.
    assert spec.env_from_secret == "sap"


def test_the_bridge_follows_the_platform_pull_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    """Local development rebuilds one tag, so IfNotPresent would freeze every bridge."""
    monkeypatch.setenv("CONNECTOR_IMAGE_PULL_POLICY", "Always")
    settings.cache_clear()
    pod = deployment_manifest(_connector(), IMAGE)["spec"]["template"]["spec"]
    assert pod["containers"][0]["imagePullPolicy"] == "Always"
    settings.cache_clear()


def test_the_kept_configuration_names_a_secret_and_never_its_value() -> None:
    """The restart cache is a ConfigMap, so it must hold no credential."""
    kept = json.dumps([_connector().model_dump()])
    assert "sap" in kept
    assert STATE_KEY == "connectors.json"
    # The spec has no field for a secret value, which is what makes a ConfigMap safe here.
    assert "secret" not in set(ConnectorSpec.model_fields) - {"env_from_secret"}


def test_should_reach_the_api_server_without_the_egress_proxy_when_no_proxy_names_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The runtime must start while the egress proxy is down: its own API server is in NO_PROXY."""
    from kubernetes import client
    from kubernetes import config as kube_config
    from kubernetes.client import rest

    from awp_connectors import pods

    monkeypatch.setenv("HTTPS_PROXY", "http://egress-proxy.awp-app.svc:3128")
    monkeypatch.setenv("NO_PROXY", "localhost,.svc,10.96.0.1")

    def load_incluster_config() -> None:
        client.Configuration.set_default(client.Configuration(host="https://10.96.0.1:443"))

    monkeypatch.setattr(kube_config, "load_incluster_config", load_incluster_config)
    try:
        pods._load_kube_config()
        pool = rest.RESTClientObject(client.Configuration.get_default_copy()).pool_manager
        assert not isinstance(pool, rest.urllib3.ProxyManager)
    finally:
        client.Configuration.set_default(None)
