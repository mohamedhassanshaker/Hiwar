"""The seven execution profiles of specification section 5.2, loaded from YAML."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from awp_agent.harness.types import ProfileName, StorylineMode, ToolTier

PROFILE_DIR = Path(__file__).parent

TIER_ORDER: tuple[ToolTier, ...] = (ToolTier.T0, ToolTier.T1, ToolTier.T2, ToolTier.T3)


class ExecutionProfile(BaseModel):
    """How one kind of run behaves: its limits, its tiers and its step guidance."""

    name: ProfileName
    description: str
    max_steps: int
    max_tool_calls: int
    agent_hop_limit: int
    highest_tier_without_approval: ToolTier
    verify: bool
    stream: bool
    storyline_mode: StorylineMode = StorylineMode.GUIDED
    step_guidance: str = Field(default="")

    def allows_without_approval(self, tier: ToolTier) -> bool:
        """True when a tool of this tier may run without pausing for the Inbox."""
        return TIER_ORDER.index(tier) <= TIER_ORDER.index(self.highest_tier_without_approval)


@lru_cache(maxsize=1)
def all_profiles() -> dict[ProfileName, ExecutionProfile]:
    """Every profile on disk, keyed by name."""
    loaded: dict[ProfileName, ExecutionProfile] = {}
    for path in sorted(PROFILE_DIR.glob("*.yaml")):
        profile = ExecutionProfile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        loaded[profile.name] = profile
    return loaded


def profile(name: ProfileName) -> ExecutionProfile:
    """The named profile, or a KeyError naming what is missing."""
    profiles = all_profiles()
    if name not in profiles:
        raise KeyError(f"no execution profile named {name}")
    return profiles[name]
