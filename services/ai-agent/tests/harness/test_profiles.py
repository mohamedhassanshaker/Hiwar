"""The seven execution profiles of specification section 5.2."""

from __future__ import annotations

import pytest

from awp_agent.harness.profiles import all_profiles, profile
from awp_agent.harness.types import ProfileName, StorylineMode, ToolTier


def test_every_profile_in_the_specification_is_on_disk() -> None:
    """The Configuration card offers exactly these seven profiles."""
    assert set(all_profiles()) == set(ProfileName)


@pytest.mark.parametrize("name", list(ProfileName))
def test_each_profile_has_limits_and_guidance(name: ProfileName) -> None:
    """Every profile carries its own limits and its own step guidance."""
    loaded = profile(name)
    assert loaded.max_steps > 0
    assert loaded.max_tool_calls > 0
    assert loaded.step_guidance.strip()


def test_scripted_is_the_strict_storyline_profile() -> None:
    """A strict storyline runs under the scripted profile."""
    assert profile(ProfileName.SCRIPTED).storyline_mode is StorylineMode.STRICT
    assert profile(ProfileName.CONVERSATIONAL).storyline_mode is StorylineMode.GUIDED


def test_conversational_may_confirm_but_never_approves_by_itself() -> None:
    """A room reply may ask for a confirmation; an approval still pauses the run."""
    conversational = profile(ProfileName.CONVERSATIONAL)
    assert conversational.allows_without_approval(ToolTier.T1)
    assert not conversational.allows_without_approval(ToolTier.T2)


def test_planner_and_reviewer_never_act_without_approval() -> None:
    """A planner plans and a reviewer reviews; neither changes anything on its own."""
    for name in (ProfileName.PLANNER, ProfileName.REVIEWER, ProfileName.ROUTINE):
        assert not profile(name).allows_without_approval(ToolTier.T1)


def test_an_unknown_profile_is_refused() -> None:
    """A profile the agent names but the platform does not have is an error, not a default."""
    with pytest.raises(KeyError):
        profile("negotiator")  # type: ignore[arg-type]
