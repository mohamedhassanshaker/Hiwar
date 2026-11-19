"""The connector registry and the rule that a secret never leaves this service."""

from __future__ import annotations

from pathlib import Path

import pytest

from awp_connectors.config import settings
from awp_connectors.registry import ConnectorSpec, Registry
from awp_connectors.secrets import REDACTED, environment_for, redact


def _stdio(identifier: str = "c-1", enabled: bool = True) -> ConnectorSpec:
    return ConnectorSpec(
        connector_id=identifier,
        name="SAP",
        transport="stdio",
        command=["npx", "-y", "@tahseel/sap-mcp"],
        env_from_secret="sap",
        enabled=enabled,
    )


def test_a_stdio_connector_needs_a_command() -> None:
    """A connector that cannot start is a configuration error, caught on save."""
    with pytest.raises(ValueError, match="no command"):
        ConnectorSpec(connector_id="c-1", name="SAP", transport="stdio").validated()


def test_an_http_connector_needs_a_url() -> None:
    """The same, for a remote connector."""
    with pytest.raises(ValueError, match="no URL"):
        ConnectorSpec(connector_id="c-2", name="Jira", transport="http").validated()


def test_reloading_replaces_the_whole_set() -> None:
    """Hot reload on save: the new set is what the runtime serves, not a merge."""
    registry = Registry()
    assert registry.replace([_stdio("c-1"), _stdio("c-2")]) == ["c-1", "c-2"]
    assert registry.replace([_stdio("c-3")]) == ["c-3"]


def test_a_disabled_connector_is_not_served() -> None:
    """Disabling a connector in the console takes it out of the runtime."""
    registry = Registry()
    assert registry.replace([_stdio("c-1", enabled=False)]) == []


def test_an_unknown_connector_is_an_error_not_an_empty_tool_list() -> None:
    """An agent asking for a connector that is gone is told so."""
    with pytest.raises(KeyError, match="c-9"):
        Registry().get("c-9")


def test_a_secret_is_read_from_its_mounted_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Secret mounted as a volume is one file per key."""
    folder = tmp_path / "sap"
    folder.mkdir()
    (folder / "SAP_API_KEY").write_text("super-secret\n", encoding="utf-8")
    monkeypatch.setenv("CONNECTOR_SECRETS_PATH", str(tmp_path))
    settings.cache_clear()
    assert environment_for("sap") == {"SAP_API_KEY": "super-secret"}


def test_a_connector_without_a_secret_gets_an_empty_environment() -> None:
    """A connector that needs no credentials is not an error."""
    assert environment_for("") == {}


def test_redaction_keeps_the_keys_and_drops_every_value() -> None:
    """The status endpoint shows which variables are set, never what they are."""
    redacted = redact({"SAP_API_KEY": "super-secret"})
    assert redacted == {"SAP_API_KEY": REDACTED}
    assert "super-secret" not in str(redacted)


def test_an_http_connector_s_credential_is_never_serialised() -> None:
    """D296: kept for a restart and handed to a bridge as JSON, the spec carries no credential."""
    spec = ConnectorSpec(
        connector_id="erp",
        name="ERP",
        transport="http",
        url="https://erp.test/mcp",
        headers={"authorization": "Bearer s3cret"},
        query={"key": "q-s3cret"},
        needs_credential=True,
    )
    for dumped in (spec.model_dump_json(), str(spec.model_dump()), repr(spec)):
        assert "s3cret" not in dumped
    restored = ConnectorSpec.model_validate(spec.model_dump())
    assert restored.needs_credential
    assert restored.credential_missing
    assert not spec.credential_missing


def test_an_error_hides_the_credential_it_may_quote() -> None:
    """An HTTP error names the URL, which may carry an API key."""
    spec = ConnectorSpec(
        connector_id="erp",
        name="ERP",
        transport="http",
        url="https://erp.test/mcp",
        query={"key": "q-s3cret"},
    )
    quoted = "401 for url 'https://erp.test/mcp?key=q-s3cret'"
    assert spec.redact(quoted) == "401 for url 'https://erp.test/mcp?key=••••••'"
