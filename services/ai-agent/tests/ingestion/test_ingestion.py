"""Chunking, Arabic normalisation and hybrid re-ranking."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from awp_agent.ingestion import graph, vectors
from awp_agent.ingestion.chunking import ChunkingConfig, chunk
from awp_agent.ingestion.normalise import normalise_arabic, search_key
from awp_agent.ingestion.retrieval import rerank
from awp_agent.ingestion.vectors import IndexConfig, _storage_kind
from awp_agent.ingestion.workflow import _reason

DOCUMENT = """\
# Expense policy

Claims are paid within ten working days.

## Limits

Claims over 5,000 AED need a manager's approval.
"""


def test_by_heading_keeps_the_heading_with_its_section() -> None:
    """A passage cited back to a reader has to carry the heading it came from."""
    chunks = chunk(DOCUMENT, ChunkingConfig(technique="ByHeading"))
    assert [piece.heading for piece in chunks] == ["Expense policy", "Limits"]
    assert "ten working days" in chunks[0].text


def test_fixed_chunking_overlaps() -> None:
    """Fixed chunks overlap so a sentence cut in two is still retrievable."""
    text = "a" * 250
    chunks = chunk(text, ChunkingConfig(technique="Fixed", chunk_size=100, overlap=20))
    assert len(chunks) == 4
    assert all(len(piece.text) <= 100 for piece in chunks)


def test_semantic_chunking_never_cuts_a_sentence() -> None:
    """Semantic chunks group whole sentences."""
    text = "First sentence. Second sentence. Third sentence."
    chunks = chunk(text, ChunkingConfig(technique="Semantic", chunk_size=20))
    assert all(piece.text.endswith(".") for piece in chunks)


def test_recursive_chunking_respects_the_size() -> None:
    """Recursive chunking splits on the largest separator that fits."""
    text = "\n\n".join(f"Paragraph {n} with some words in it." for n in range(10))
    chunks = chunk(text, ChunkingConfig(technique="Recursive", chunk_size=80, overlap=0))
    assert len(chunks) > 1
    assert all(len(piece.text) <= 80 for piece in chunks)


def test_arabic_forms_normalise_to_one_key() -> None:
    """The same name written three ways has to match in search."""
    assert search_key("إدارة") == search_key("ادارة") == search_key("أدارة")
    assert search_key("مصطفى") == search_key("مصطفي")


def test_diacritics_and_tatweel_are_removed() -> None:
    """Diacritics and the elongation mark are decoration, not meaning."""
    assert normalise_arabic("مُحَمَّد") == "محمد"
    assert normalise_arabic("محـــمد") == "محمد"


def test_arabic_digits_become_latin_digits() -> None:
    """A claim number typed in Arabic digits still matches the record."""
    assert normalise_arabic("١٠٤٢") == "1042"


def test_hybrid_reranking_lifts_the_passages_a_graph_fact_rests_on() -> None:
    """That is what makes Hybrid different from running Vector and Graph side by side."""
    passages = [
        vectors.Passage(
            chunk_id="c1", doc_id="d", source="policy.pdf", text="Unrelated", score=0.9
        ),
        vectors.Passage(
            chunk_id="c2", doc_id="d", source="policy.pdf", text="Approval limits", score=0.8
        ),
    ]
    facts = [
        graph.GraphFact(source="Claim", relation="needs", target="Approval", chunk_ids=["c2"])
    ]
    ranked = rerank(passages, facts, "approval limit")
    assert ranked[0].chunk_id == "c2"


def test_each_collection_has_its_own_graph_group() -> None:
    """The harness passes an agent the groups it may read, so two collections never
    answer each other's queries."""
    assert graph.collection_group("hr-policies") == "kc_hr-policies"
    assert graph.collection_group("hr-policies") != graph.collection_group("finance")


def test_a_dimension_past_2000_is_halfvec_even_when_not_asked_for() -> None:
    """`nemotron-3-embed-1b` already produces 2048 dimensions. Postgres refuses an HNSW
    index on plain `vector` past 2000 outright, so there is no correct index to build at
    that size except `halfvec` — the collection's own toggle does not get a vote."""
    assert _storage_kind(IndexConfig(dimension=2048, half_precision=False)) == "halfvec"


def test_a_dimension_within_range_honours_the_collections_own_setting() -> None:
    assert _storage_kind(IndexConfig(dimension=1536, half_precision=False)) == "vector"
    assert _storage_kind(IndexConfig(dimension=1536, half_precision=True)) == "halfvec"


def test_an_invalidated_fact_is_never_recalled() -> None:
    """Graphiti invalidates a fact a later episode contradicts instead of deleting it.
    History stays in the graph; only the facts still valid go into a run's context."""
    live = graph.GraphFact(source="Claim", relation="needs", target="Approval")
    superseded = graph.GraphFact(
        source="Claim",
        relation="needs",
        target="Two approvals",
        invalid_at=datetime(2026, 10, 1, tzinfo=UTC),
    )
    assert live.invalid_at is None
    assert superseded.invalid_at is not None


def test_a_failed_document_carries_the_cause_rather_than_the_wrapper() -> None:
    """A Temporal activity that raises reaches the workflow as `Activity task failed`.

    The Knowledge screen shows what a run could not read, so the reason has to be the
    gateway's or the parser's own words, not the name of the wrapper around them.
    """
    cause = RuntimeError("404 - this model is only available through the Batch API")
    wrapper = RuntimeError("Activity task failed")
    wrapper.__cause__ = cause
    assert _reason(wrapper) == (
        "Activity task failed: 404 - this model is only available through the Batch API"
    )


def test_a_failure_with_no_message_is_named_by_its_type() -> None:
    assert _reason(TimeoutError()) == "TimeoutError"


class _Recorder:
    """A connection pool that records each statement as text and answers no rows."""

    def __init__(self) -> None:
        self.statements: list[str] = []

    def connection(self) -> _Recorder:
        return self

    async def __aenter__(self) -> _Recorder:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def execute(self, statement: object, _params: object = None) -> _Recorder:
        text = statement.as_string(None) if hasattr(statement, "as_string") else str(statement)
        self.statements.append(" ".join(text.split()))
        return self

    def cursor(self) -> _Recorder:
        return self

    async def fetchall(self) -> list[tuple[object, ...]]:
        return []


async def test_a_collection_is_indexed_per_dimension_and_searched_in_its_own(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D256: after the embedding route changes model, a collection holds rows of two
    dimensions. The index and the search each cover only their own, so a new row inserts and
    a search answers, where one index over the whole collection failed both casts."""
    recorder = _Recorder()

    async def pool() -> _Recorder:
        return recorder

    monkeypatch.setattr(vectors, "pool", pool)

    await vectors.ensure_collection("default-kb", IndexConfig(dimension=3072))
    await vectors.search("default-kb", [0.1] * 3072)

    drop, create, query = recorder.statements
    assert drop == 'DROP INDEX IF EXISTS "passage_hnsw_default_kb"'
    assert '"passage_hnsw_default_kb__d3072"' in create
    assert "embedding::halfvec(3072)" in create
    assert create.endswith("WHERE collection_id = 'default-kb' AND vector_dims(embedding) = 3072")
    assert "WHERE collection_id = %s AND vector_dims(embedding) = 3072" in query


async def test_a_chunk_the_graph_never_received_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    """D258: a Vector collection's chunks have no episode, and removing its source must not fail."""
    from graphiti_core.errors import NodeNotFoundError

    removed: list[str] = []

    class Graphiti:
        async def remove_episode(self, uuid: str) -> None:
            if uuid == "missing":
                raise NodeNotFoundError(uuid)
            removed.append(uuid)

    monkeypatch.setattr(graph, "client", lambda: Graphiti())
    await graph.remove_chunks(["c-1", "missing", "c-2"])
    assert removed == ["c-1", "c-2"]


async def test_a_new_chunk_gets_its_episode_under_its_own_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D259: `add_episode` with a uuid loads an episode rather than creating one, so a new
    chunk's episode is saved first; one that exists is updated in place."""
    from graphiti_core.errors import NodeNotFoundError
    from graphiti_core.nodes import EpisodicNode

    saved: list[str] = []
    added: list[str] = []
    existing = {"old-chunk"}

    async def get_by_uuid(_driver: object, uuid: str) -> object:
        if uuid not in existing:
            raise NodeNotFoundError(uuid)
        return object()

    async def save(self: EpisodicNode, _driver: object) -> None:
        saved.append(self.uuid)

    class Graphiti:
        driver = object()

        async def add_episode(self, **episode: object) -> None:
            added.append(str(episode["uuid"]))

    monkeypatch.setattr(EpisodicNode, "get_by_uuid", get_by_uuid)
    monkeypatch.setattr(EpisodicNode, "save", save)
    routes: list[str] = []

    def client(route: str) -> Graphiti:
        routes.append(route)
        return Graphiti()

    monkeypatch.setattr(graph, "client", client)

    await graph.add_chunk(
        group_id="kb-g",
        chunk_id="new-chunk",
        text="t",
        source="s",
        extraction_route="reasoning-default",
    )
    await graph.add_chunk(
        group_id="kb-g",
        chunk_id="old-chunk",
        text="t",
        source="s",
        extraction_route="reasoning-default",
    )

    assert saved == ["new-chunk"]
    assert added == ["new-chunk", "old-chunk"]
    # D260: the collection's own extraction route, not a default no install defines.
    assert routes == ["reasoning-default", "reasoning-default"]


async def test_graph_extraction_resumes_from_the_last_chunk_a_heartbeat_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D276: a document's graph extraction takes minutes per handful of chunks, so a retry
    picks up after the chunks the previous attempt finished instead of starting over."""
    from dataclasses import replace

    from temporalio.testing import ActivityEnvironment

    from awp_agent.ingestion.activities import IngestionConfig, ParsedDocument, extract_graph

    config = IngestionConfig(collection_id="kb", chunking=ChunkingConfig(technique="ByHeading"))
    text = "".join(f"# Part {n}\n\nSection {n} of the document.\n\n" for n in range(4))
    pieces = chunk(text, config.chunking)
    assert len(pieces) == 4

    extracted: list[str] = []

    async def add_chunk(**episode: object) -> None:
        extracted.append(str(episode["text"]))

    monkeypatch.setattr(graph, "add_chunk", add_chunk)
    environment = ActivityEnvironment()
    environment.info = replace(environment.info, heartbeat_details=[2])
    beats: list[object] = []
    environment.on_heartbeat = lambda *details: beats.append(details[0])

    document = ParsedDocument(doc_id="doc-1", source="policy.docx", text=text)
    result = await environment.run(extract_graph, (document, config, "reasoning-default"))

    assert extracted == [pieces[2].text, pieces[3].text]
    assert beats == [3, 4]
    assert result.episodes == 4


async def test_a_failed_pool_open_is_not_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    """D355: psycopg_pool closes a pool whose open times out. Kept, it answered every later
    call with `PoolClosed` until the process restarted; now each call tries to open again."""
    from psycopg_pool import AsyncConnectionPool, PoolTimeout

    class QuickPool(AsyncConnectionPool):
        async def open(self, wait: bool = False, timeout: float = 30.0) -> None:  # noqa: ASYNC109 - the library's signature
            await super().open(wait=wait, timeout=0.5)

    monkeypatch.setenv("KB_DATABASE_URL", "postgresql://awp@127.0.0.1:1/awp_kb?connect_timeout=1")
    from awp_agent.config import settings

    settings.cache_clear()
    monkeypatch.setattr(vectors, "AsyncConnectionPool", QuickPool)
    monkeypatch.setattr(vectors, "_pool", None)

    for _ in range(2):
        with pytest.raises(PoolTimeout):
            await vectors.pool()
    assert vectors._pool is None
