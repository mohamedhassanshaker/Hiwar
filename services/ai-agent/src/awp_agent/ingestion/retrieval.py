"""Retrieval in Vector, Graph and Hybrid modes, with re-ranking and cited passages.

Hybrid is not a simple concatenation: the graph facts tell the ranker which passages carry the
entities the question is about, so a passage that supports a graph fact is pulled up. That is
the whole point of combining passages with graph facts, and it is what the retrieval
test on S-58 shows.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from awp_agent.clients import gateway_client
from awp_agent.ingestion import graph, vectors
from awp_agent.ingestion.normalise import search_key

Mode = Literal["Vector", "Graph", "Hybrid"]

GRAPH_SUPPORT_BOOST = 0.15
NAME_MATCH_BOOST = 0.05


class RetrievalResult(BaseModel):
    """What one retrieval returned: the passages, the facts and the mode that was used."""

    mode: Mode = "Hybrid"
    passages: list[vectors.Passage] = Field(default_factory=list)
    facts: list[graph.GraphFact] = Field(default_factory=list)

    def as_context(self) -> str:
        """The retrieved knowledge block, with a citation on every passage."""
        lines: list[str] = []
        for passage in self.passages:
            lines.append(f"[{passage.source}#{passage.chunk_id}] {passage.text}")
        for fact in self.facts:
            lines.append(f"[graph] {fact.source} —{fact.relation}→ {fact.target}")
        return "\n\n".join(lines)


def rerank(
    passages: list[vectors.Passage],
    facts: list[graph.GraphFact],
    query: str,
) -> list[vectors.Passage]:
    """Boost the passages a graph fact rests on, and those that name the query's words."""
    supporting = {chunk_id for fact in facts for chunk_id in fact.chunk_ids}
    key = search_key(query)
    words = {word for word in key.split() if len(word) > 2}

    def score(passage: vectors.Passage) -> float:
        """The passage's own score plus the graph-support and query-word boosts it earns."""
        boosted = passage.score
        if passage.chunk_id in supporting:
            boosted += GRAPH_SUPPORT_BOOST
        text_key = search_key(passage.text)
        if words and any(word in text_key for word in words):
            boosted += NAME_MATCH_BOOST
        return boosted

    ranked = sorted(passages, key=score, reverse=True)
    for passage in ranked:
        passage.score = score(passage)
    return ranked


async def search(
    query: str,
    collection_id: str,
    mode: str = "Hybrid",
    limit: int = 8,
    embedding_route: str = "",
) -> RetrievalResult:
    """Retrieve from one collection in the mode the collection or the caller asked for.

    `embedding_route` is the collection's own route (Models & routes), the same one
    ingestion embedded its passages with — a passage embedded by one model is not
    comparable to a query vector from another, so this has to be the same route or the
    scores returned mean nothing. Empty falls back to the platform default.
    """
    chosen: Mode = mode if mode in ("Vector", "Graph", "Hybrid") else "Hybrid"  # type: ignore[assignment]
    if not collection_id:
        return RetrievalResult(mode=chosen)

    facts: list[graph.GraphFact] = []
    passages: list[vectors.Passage] = []

    if chosen in ("Graph", "Hybrid"):
        facts = await graph.neighbours(collection_id, query, limit=limit * 2)

    if chosen in ("Vector", "Hybrid"):
        [vector] = await gateway_client.embed([query], route=embedding_route or None)
        passages = await vectors.search(collection_id, vector, limit=limit)

    if chosen == "Hybrid":
        passages = rerank(passages, facts, query)[:limit]

    return RetrievalResult(mode=chosen, passages=passages, facts=facts[:limit])
