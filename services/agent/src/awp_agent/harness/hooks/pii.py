"""The old hook protocol over the guardrail chain, for the two callers still on it.

Masking itself is `harness.guardrails`, which is the library's
`InputGuardrail`/`OutputGuardrail` with the library's own detectors. This module holds
nothing but the adapter that `activities/model_step.py` and `ingestion/activities.py` call,
and goes when they call `guardrails.mask` directly.
"""

from __future__ import annotations

from typing import Literal

from awp_agent.harness import guardrails
from awp_agent.harness.types import HookOutcome


class PiiMaskHook:
    """Masks personal identifiers before the model sees them, and again after it answers."""

    name = "pii-mask"

    def __init__(self) -> None:
        self.engine = guardrails.engine()

    def _outcome(
        self, phase: Literal["pre_model", "post_model"], text: str
    ) -> tuple[str, HookOutcome | None]:
        """Mask `text` and report it; the text unchanged and no outcome when nothing matched."""
        masked, count = guardrails.mask(text)
        if count == 0:
            return text, None
        return masked, HookOutcome(
            hook=self.name,
            phase=phase,
            summary=f"{count} values masked ({self.engine})",
            changed=True,
        )

    def pre_model(self, text: str) -> tuple[str, HookOutcome | None]:
        """Mask the text sent to the model."""
        return self._outcome("pre_model", text)

    def post_model(self, text: str) -> tuple[str, HookOutcome | None]:
        """Mask the model's answer."""
        return self._outcome("post_model", text)
