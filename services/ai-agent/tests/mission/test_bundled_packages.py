"""`packages/contracts` and `packages/skills-bundled` are read by this service, so they are
tested from here: a schema that does not compile or a skill with no frontmatter would only
show up in a cluster otherwise.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import jsonschema
import pytest

from awp_agent.harness.capabilities import skill_capabilities
from awp_agent.harness.skills.loader import discover, index, load
from awp_agent.harness.types import SkillRef
from awp_agent.mission.skills import granted_skills

REPOSITORY = Path(__file__).resolve().parents[4]
CONTRACTS = REPOSITORY / "packages" / "contracts" / "schemas"
SKILLS = REPOSITORY / "packages" / "skills-bundled"

EXPECTED_SKILLS = {
    "bilingual-writing",
    "guided-platform-creation",
    "platform-operations",
    "request-triage",
    "task-planning",
    "work-item-execution",
}


def _schemas() -> list[Path]:
    return sorted(CONTRACTS.glob("*.schema.json"))


def test_the_contracts_folder_holds_the_three_shared_schemas() -> None:
    """Dynamic attributes, the AG-UI custom events and the platform MCP tool catalogue."""
    assert {path.name for path in _schemas()} == {
        "attribute-definition.schema.json",
        "agui-custom-events.schema.json",
        "platform-mcp-tools.schema.json",
    }


@pytest.mark.parametrize("path", _schemas(), ids=lambda path: path.name)
def test_every_schema_compiles(path: Path) -> None:
    """A schema that does not compile would fail at the first request, not at build time."""
    schema = json.loads(path.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)


def test_an_enum_attribute_must_declare_its_values() -> None:
    """An Enum with no values would render an empty dropdown on the request form."""
    schema = json.loads((CONTRACTS / "attribute-definition.schema.json").read_text("utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    valid = {
        "key": "costCentre",
        "labelEn": "Cost centre",
        "labelAr": "مركز التكلفة",
        "dataType": "Enum",
        "order": 1,
        "enumValues": [{"value": "ops", "labelEn": "Operations", "labelAr": "العمليات"}],
    }
    validator.validate(valid)
    with pytest.raises(jsonschema.ValidationError):
        validator.validate({**valid, "enumValues": None})


def test_an_attribute_key_is_a_camel_case_identifier() -> None:
    """The key is suggested from the English label and goes into `AttributesJson` unchanged."""
    schema = json.loads((CONTRACTS / "attribute-definition.schema.json").read_text("utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    with pytest.raises(jsonschema.ValidationError):
        validator.validate(
            {
                "key": "Cost Centre",
                "labelEn": "Cost centre",
                "labelAr": "مركز التكلفة",
                "dataType": "Text",
                "order": 1,
            }
        )


def test_the_platform_tool_catalogue_example_validates_against_its_own_schema() -> None:
    """The example is the contract the web app's MCP route is written against."""
    schema = json.loads((CONTRACTS / "platform-mcp-tools.schema.json").read_text("utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    for example in schema["examples"]:
        validator.validate(example)


def test_an_approval_event_validates_and_a_mislabelled_tier_does_not() -> None:
    """The console switches on the event name and the tier; both have to be exact."""
    schema = json.loads((CONTRACTS / "agui-custom-events.schema.json").read_text("utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    event = {
        "name": "awp.tool.approval",
        "value": {
            "callId": "c-1",
            "approvalId": "ap-1",
            "toolName": "request_transition",
            "tier": "T2",
        },
    }
    validator.validate(event)
    event["value"]["tier"] = "T1"  # type: ignore[index]
    with pytest.raises(jsonschema.ValidationError):
        validator.validate(event)


def test_the_bundled_skills_are_all_discoverable() -> None:
    """The image mounts this folder; a skill with no frontmatter would vanish from the index."""
    skills = discover(SKILLS)
    assert {skill.id for skill in skills} == EXPECTED_SKILLS
    assert all(skill.name and skill.description for skill in skills)


def test_the_skill_index_is_one_line_per_skill() -> None:
    """The index is in every model step, so it stays small."""
    listing = index(discover(SKILLS))
    assert len(listing.splitlines()) == len(EXPECTED_SKILLS)


def test_a_bundled_skill_body_loads_without_its_frontmatter() -> None:
    """A loaded skill puts the body in the context, never the YAML header."""
    body = load("request-triage", discover(SKILLS))
    assert body.startswith("# Request triage")
    assert "description:" not in body.splitlines()[0]


def test_every_bundled_skill_becomes_a_deferred_capability() -> None:
    """Stack specification 5.4: a skill is a Pydantic AI capability that loads on demand,
    so the model sees one line per skill until it decides it needs the whole thing."""
    built = skill_capabilities(discover(SKILLS))
    assert len(built) == len(EXPECTED_SKILLS)
    assert all(capability.defer_loading for capability in built)
    assert {capability.id for capability in built} == set(EXPECTED_SKILLS)


class TestDeclaredTools:
    """`allowed-tools` in a skill's frontmatter, which the registry compares with what an
    agent may call (`UC-51.2-05`).

    A skill is prose: what it will reach for cannot be read out of it, so it has to say.
    Written either as a YAML list or as one comma-separated string, because an author
    declaring a single tool rarely reaches for a list and a skill that silently declared
    nothing would be attached to an agent that cannot run it.
    """

    def test_a_list_is_read_as_written(self) -> None:
        from awp_agent.harness.skills.loader import _declared_tools

        assert _declared_tools({"allowed-tools": ["erp/claims.read", "knowledge/search"]}) == [
            "erp/claims.read",
            "knowledge/search",
        ]

    def test_a_comma_separated_string_is_read_as_a_list(self) -> None:
        from awp_agent.harness.skills.loader import _declared_tools

        assert _declared_tools({"allowed-tools": "erp/claims.read, knowledge/search"}) == [
            "erp/claims.read",
            "knowledge/search",
        ]

    def test_a_skill_that_declares_nothing_needs_nothing(self) -> None:
        from awp_agent.harness.skills.loader import _declared_tools

        assert _declared_tools({"name": "Bilingual writing"}) == []
        assert _declared_tools({"allowed-tools": ""}) == []

    def test_every_bundled_skill_declares_tools_it_could_name(self) -> None:
        """The bundled skills are prose and call nothing, so they declare nothing."""
        from awp_agent.harness.skills.loader import discover

        for skill in discover(SKILLS):
            assert isinstance(skill.declared_tools, list)


@pytest.mark.skipif(os.name != "posix", reason="the harness's LocalWorkspaceBackend is POSIX only")
async def test_the_harness_loader_reads_every_bundled_skill() -> None:
    """Each frontmatter `name` has to match its folder, or the Agent Skills loader skips it."""
    granted = [SkillRef(id=name, name=name, description="", path=name) for name in EXPECTED_SKILLS]
    loaded = await granted_skills(granted, str(SKILLS))
    assert {skill.name for skill in loaded} == EXPECTED_SKILLS
    assert all(skill.instructions.startswith("# Skill: ") for skill in loaded)
