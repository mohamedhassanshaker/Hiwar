"""PII masking, NFR-15, as the library guardrails that now carry it."""

from __future__ import annotations

import pytest
from pydantic_ai_harness import InputGuardrail, OutputGuardrail

from awp_agent.harness import guardrails
from awp_agent.harness.hooks.pii import PiiMaskHook


class TestUaeIdentifiers:
    """The identifiers this platform carries. Every one of them still goes."""

    @pytest.mark.parametrize(
        "number",
        [
            "+971 50 123 4567",
            "+971501234567",
            "+971-50-123-4567",
            "050 123 4567",
            "00971 55 987 6543",
        ],
    )
    def test_a_uae_mobile_is_masked_however_it_is_written(self, number: str) -> None:
        # The international forms were all missed once: a `\b` cannot hold before `+`.
        masked, count = guardrails.mask(f"Reach me on {number}")
        assert number not in masked
        assert count == 1

    def test_a_plain_long_number_is_not_mistaken_for_a_mobile(self) -> None:
        assert guardrails.mask("order 12345678901234") == ("order 12345678901234", 0)

    @pytest.mark.parametrize("value", ["784-1990-1234567-1", "784199012345671"])
    def test_an_emirates_id_is_masked_with_or_without_separators(self, value: str) -> None:
        masked, count = guardrails.mask(f"claimant {value} filed today")
        assert masked == "claimant [emirates_id] filed today"
        # One identifier in, one label out: a card pattern claiming part of the same run of
        # digits used to produce "[EMAIL][CARD]" from a single value.
        assert count == 1

    def test_a_uae_iban_is_masked(self) -> None:
        masked, _ = guardrails.mask("pay AE070331234567890123456")
        assert "AE070331234567890123456" not in masked

    def test_an_email_is_masked(self) -> None:
        masked, _ = guardrails.mask("write to mariam@tahseel.ae")
        assert "mariam@tahseel.ae" not in masked

    def test_a_card_number_is_masked(self) -> None:
        masked, _ = guardrails.mask("card 4111 1111 1111 1111")
        assert "4111" not in masked

    def test_a_clean_message_is_untouched(self) -> None:
        assert guardrails.mask("Please check the claim.") == ("Please check the claim.", 0)


class TestWhichEngineRan:
    """`patterns` is the weaker control, so which one ran has to be visible (F-06)."""

    def test_the_engine_is_named(self) -> None:
        assert guardrails.engine() in {"presidio", "patterns"}

    def test_a_name_is_masked_only_when_the_ner_engine_is_there(self) -> None:
        masked, _ = guardrails.mask("Mariam Al Suwaidi filed it")
        if guardrails.engine() == "presidio":
            assert "Mariam" not in masked
        else:
            assert masked == "Mariam Al Suwaidi filed it"

    def test_an_ip_address_is_masked_by_the_ner_engine(self) -> None:
        masked, _ = guardrails.mask("the host is 10.1.2.3")
        if guardrails.engine() == "presidio":
            assert "10.1.2.3" not in masked


def test_both_directions_are_guarded() -> None:
    """What reaches the model and what leaves it run the same chain."""
    built = guardrails.pii_guardrails()
    assert [type(capability) for capability in built] == [InputGuardrail, OutputGuardrail]


def test_a_guard_reports_a_replacement_the_library_can_apply() -> None:
    """The detectors are plain `TextDetector`s, so the library owns the rewrite."""
    verdict = guardrails.redact_identifiers("call 0501234567")
    assert verdict.action == "replace"
    assert "0501234567" not in str(verdict.replacement)


def test_the_run_viewer_still_gets_a_line_naming_the_engine() -> None:
    """`UC-52.1-02` shows the masking in the run viewer, engine included."""
    masked, outcome = PiiMaskHook().pre_model("Reach me on +971 50 123 4567")
    assert "+971 50 123 4567" not in masked
    assert outcome is not None
    assert outcome.hook == "pii-mask"
    assert guardrails.engine() in outcome.summary


def test_every_mission_runs_with_masking_and_compaction() -> None:
    """One runtime, one set of safeguards: not something an agent can be configured out of."""
    from pydantic_ai_harness.compaction import SummarizingCompaction

    from awp_agent.harness.capabilities import (
        CONVERSATION_TOKEN_BUDGET,
        KEEP_MESSAGES,
        safeguards,
    )

    built = safeguards()
    assert [type(capability) for capability in built] == [
        InputGuardrail,
        OutputGuardrail,
        SummarizingCompaction,
    ]
    compaction = built[2]
    assert compaction.max_tokens == CONVERSATION_TOKEN_BUDGET
    assert compaction.keep_messages == KEEP_MESSAGES
