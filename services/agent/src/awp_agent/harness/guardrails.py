"""What reaches the model and what leaves it, as library guardrails (NFR-15).

The mechanism is `pydantic_ai_harness.guardrails`: `InputGuardrail` and `OutputGuardrail`
own the chaining, the replacement and the spans. Detection is the library's too —
`personal_data` carries the patterns, the Luhn check on a card and the mod-97 check on an
IBAN — and the two identifiers it has no pattern for arrive through its own `extra`
argument rather than through a chain of ours.

Only name and IP detection is local, because the library ships no NER detector and a regex
cannot find a person's name. It is a `TextDetector`, the library's own extension point, so
it composes into the same guard chain as everything else.

A guardrail is not an authorisation control (rule 4). It decides what text the model sees
and publishes; what an agent may *do* is decided at the resource, by the platform MCP
server, whatever a guardrail allows.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import lru_cache
from typing import Any

import structlog
from pydantic_ai_harness import InputGuardrail, OutputGuardrail
from pydantic_ai_harness.guardrails import GuardrailResult
from pydantic_ai_harness.guardrails.detectors import (
    DEFAULT_PII_PATTERNS,
    TextDetector,
    personal_data,
)

log = structlog.get_logger(__name__)

#: The spaCy pipeline baked into the image. Named so Presidio never tries to download one:
#: a sandboxed pod has no egress, and its default is a model it fetches on first use.
SPACY_PIPELINE = "en_core_web_sm"

#: The identifiers this platform carries that `DEFAULT_PII_PATTERNS` has no pattern for.
#: E-mail addresses, cards and AE IBANs are already in it, and its versions validate the
#: card's Luhn digit and the IBAN's mod-97 check, which the platform's own patterns did not.
UAE_IDENTIFIERS: Mapping[str, str] = {
    "emirates_id": r"\b784-?\d{4}-?\d{7}-?\d\b",
    # No leading `\b`: a word boundary cannot hold before `+`, so it would reject every
    # number written in international form. A separator may follow the country code as
    # well as sit between the groups.
    "uae_mobile": r"(?:\+971|00971|0)[\s-]?5\d[\s-]?\d{3}[\s-]?\d{4}\b",
}

#: What the NER detector takes. Presidio's recogniser set reaches well past identifiers —
#: it labels every date, quantity and place name too — and masking those would cost the
#: model the context a request is decided on ("filed today", "Dubai branch") to hide
#: nothing personal.
NER_ENTITIES: tuple[str, ...] = ("PERSON", "IP_ADDRESS")

#: Every identifier the library can find by shape, replaced with a label that says which.
redact_identifiers: TextDetector = personal_data(
    extra=dict(UAE_IDENTIFIERS), placeholder="[{name}]"
)


@lru_cache(maxsize=1)
def _ner_analyzer() -> Any | None:
    """Presidio restricted to the entities a pattern cannot find, or None when absent.

    Built once for the process: loading a spaCy pipeline takes seconds, and a guard is
    evaluated per run.

    The registry is built by hand rather than with `load_predefined_recognizers`, whose
    default set downloads the public suffix list on first use — which a pod with no egress
    cannot do. Returning None is what makes the pattern-only path reachable and honest.
    """
    try:
        from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        from presidio_analyzer.predefined_recognizers import IpRecognizer, SpacyRecognizer
    except ImportError:
        return None

    try:
        nlp_engine = NlpEngineProvider(
            nlp_configuration={
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": "en", "model_name": SPACY_PIPELINE}],
            }
        ).create_engine()
        registry = RecognizerRegistry()
        registry.add_recognizer(SpacyRecognizer(supported_language="en"))
        registry.add_recognizer(IpRecognizer(supported_language="en"))
        return AnalyzerEngine(
            nlp_engine=nlp_engine, registry=registry, supported_languages=["en"]
        )
    except Exception as problem:  # noqa: BLE001 - any failure here has to reach the fallback
        # Never silent: without the pipeline the identifiers still go, but names stay, and
        # a missing model and a model that will not load look identical from the outside.
        log.warning(
            "guardrails.ner_unavailable", pipeline=SPACY_PIPELINE, problem=str(problem)[:200]
        )
        return None


def redact_names(text: object) -> GuardrailResult:
    """Replace the names and addresses no pattern can describe.

    Runs after `redact_identifiers` in the chain, so it reads text whose identifiers are
    already labels: two recognisers cannot claim the same characters and produce a value
    masked twice into nonsense.
    """
    analyzer = _ner_analyzer()
    if analyzer is None or not isinstance(text, str):
        return GuardrailResult.allow()
    found = analyzer.analyze(text=text, language="en", entities=list(NER_ENTITIES))
    if not found:
        return GuardrailResult.allow()
    masked = text
    # Right to left, so an earlier span's offsets still refer to the original text.
    for span in sorted(found, key=lambda item: item.start, reverse=True):
        masked = f"{masked[: span.start]}[{span.entity_type.lower()}]{masked[span.end :]}"
    return GuardrailResult.replace(masked) if masked != text else GuardrailResult.allow()


#: The chain both directions run, in order: shapes first, then what needs a model.
PII_DETECTORS: tuple[TextDetector, ...] = (redact_identifiers, redact_names)


def engine() -> str:
    """Which detection ran: `presidio` also finds names, `patterns` only shapes.

    Named wherever a masking is reported. The two read identically as "2 values masked",
    and the pattern-only chain is the weaker control (security report F-06).
    """
    return "presidio" if _ner_analyzer() is not None else "patterns"


def pii_guardrails() -> list[Any]:
    """Mask personal identifiers in the prompt and again in the answer (NFR-15)."""
    # `list[Any]`: a detector reads text, while a guard is handed whatever the agent
    # produced. The library's own alias narrows to `str`, so the two do not line up until
    # one of them widens.
    guards: list[Any] = list(PII_DETECTORS)
    return [
        InputGuardrail(guard=guards, id="awp-pii-input"),
        OutputGuardrail(guard=guards, id="awp-pii-output"),
    ]


#: Every label the chain can emit, which is how a caller counts what went.
_LABELS: tuple[str, ...] = tuple(
    f"[{name}]"
    for name in (
        *DEFAULT_PII_PATTERNS,
        *UAE_IDENTIFIERS,
        *(entity.lower() for entity in NER_ENTITIES),
    )
)


def mask(text: str) -> tuple[str, int]:
    """Run the same chain outside an agent run, and say how many values it replaced.

    Knowledge ingestion has no model call, so it has no guardrail either, but a document
    still has to be masked before it is indexed (NFR-15). One detector chain, both paths.
    """
    masked = text
    for detector in PII_DETECTORS:
        verdict = detector(masked)
        if verdict.action == "replace":
            masked = str(verdict.replacement)
    added = sum(masked.count(label) - text.count(label) for label in _LABELS)
    return masked, max(added, 0)
