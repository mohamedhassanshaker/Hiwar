"""The Pod spec is the platform's isolation boundary; each property is asserted by name."""

from __future__ import annotations

import pytest

from awp_sandbox.config import settings
from awp_sandbox.spec import LABEL_POOL, LABEL_STATE, pod_manifest, pod_name


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SANDBOX_NAMESPACE", "awp-sandbox")
    monkeypatch.setenv("EGRESS_PROXY_URL", "http://egress-proxy.awp-app.svc:3128")
    monkeypatch.setenv("SANDBOX_MAX_SECONDS", "900")
    settings.cache_clear()


def test_a_sandbox_lives_only_in_the_sandbox_namespace() -> None:
    """The manager's RBAC is namespaced; a Pod anywhere else would be refused anyway."""
    assert pod_manifest("s1")["metadata"]["namespace"] == "awp-sandbox"


def test_a_sandbox_gets_no_service_account_token() -> None:
    """Without a token, code in a sandbox cannot talk to the Kubernetes API at all."""
    assert pod_manifest("s1")["spec"]["automountServiceAccountToken"] is False


def test_the_root_filesystem_is_read_only() -> None:
    """Only the workspace and /tmp are writable, and both are size-limited emptyDirs."""
    container = pod_manifest("s1")["spec"]["containers"][0]
    assert container["securityContext"]["readOnlyRootFilesystem"] is True
    mounts = {mount["name"] for mount in container["volumeMounts"]}
    assert mounts == {"workspace", "tmp"}


def test_every_capability_is_dropped_and_the_user_is_not_root() -> None:
    """A sandbox runs the least privileged process the platform can give it."""
    pod = pod_manifest("s1")
    container = pod["spec"]["containers"][0]
    assert container["securityContext"]["capabilities"]["drop"] == ["ALL"]
    assert container["securityContext"]["allowPrivilegeEscalation"] is False
    assert pod["spec"]["securityContext"]["runAsNonRoot"] is True


def test_cpu_memory_storage_and_time_are_all_limited() -> None:
    """A run that loops forever costs one sandbox, not a node."""
    pod = pod_manifest("s1")
    limits = pod["spec"]["containers"][0]["resources"]["limits"]
    assert set(limits) == {"cpu", "memory", "ephemeral-storage"}
    assert pod["spec"]["activeDeadlineSeconds"] == 900


def test_egress_goes_only_through_the_proxy() -> None:
    """The NetworkPolicy blocks everything else; the proxy enforces the domain allow-list."""
    container = pod_manifest("s1")["spec"]["containers"][0]
    env = {item["name"]: item["value"] for item in container["env"]}
    assert env["HTTPS_PROXY"] == "http://egress-proxy.awp-app.svc:3128"
    assert env["HTTP_PROXY"] == env["HTTPS_PROXY"]


def test_a_sandbox_is_pinned_to_the_sandbox_node_pool() -> None:
    """Stack specification section 8.2: sandboxes never share a node with the app."""
    assert pod_manifest("s1")["spec"]["nodeSelector"] == {"awp/pool": "sandbox"}


def test_a_warm_pod_is_labelled_idle_until_it_is_claimed() -> None:
    """Claiming a warm Pod is a relabel, which is what makes the claim atomic."""
    warm = pod_manifest("s1", warm=True)["metadata"]["labels"]
    assigned = pod_manifest("s2", run_id="r-1")["metadata"]["labels"]
    assert warm[LABEL_POOL] == "warm"
    assert warm[LABEL_STATE] == "idle"
    assert assigned[LABEL_STATE] == "busy"


def test_a_runtime_class_is_set_only_when_one_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SD-5: gVisor in Test and Live, plain runc locally."""
    assert "runtimeClassName" not in pod_manifest("s1")["spec"]
    monkeypatch.setenv("SANDBOX_RUNTIME_CLASS", "gvisor")
    settings.cache_clear()
    assert pod_manifest("s1")["spec"]["runtimeClassName"] == "gvisor"


def test_the_pod_name_is_derived_from_the_sandbox_id() -> None:
    """The manager addresses a sandbox by id alone, with no lookup."""
    assert pod_name("abc123") == "sandbox-abc123"
