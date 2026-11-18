"""The tool list the Connectors screen reads, and the annotations its tiers depend on."""

from __future__ import annotations

from mcp.types import Tool, ToolAnnotations

from awp_connectors.main import _hint


def _tool(annotations: ToolAnnotations | None) -> Tool:
    return Tool(
        name="claims.close",
        description="",
        inputSchema={"type": "object"},
        annotations=annotations,
    )


def test_an_annotated_tool_reports_its_hints() -> None:
    """The console turns these two into a starting tier, so dropping them loses the tier."""
    tool = _tool(ToolAnnotations(readOnlyHint=False, destructiveHint=True))
    assert _hint(tool, "readOnlyHint") is False
    assert _hint(tool, "destructiveHint") is True


def test_an_unannotated_tool_reports_nothing_rather_than_safe() -> None:
    """A server that said nothing has not said "safe"; the connector's default applies."""
    assert _hint(_tool(None), "readOnlyHint") is None
    assert _hint(_tool(ToolAnnotations()), "destructiveHint") is None
