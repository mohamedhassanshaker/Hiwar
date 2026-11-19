"""Hybrid retrieval over one organization's allowed sources: vector similarity plus keyword overlap."""

from __future__ import annotations

import re

from pydantic import BaseModel

from hiwar_agent.config import settings
from hiwar_agent.embeddings import embed
from hiwar_agent.normalise import search_key
from hiwar_agent.store import pool

STOP = {
    "the", "a", "an", "is", "are", "do", "does", "you", "your", "i", "me", "to", "of", "and", "in", "on",
    "for", "my", "can", "what", "how", "it", "be", "with", "at", "or", "from", "this", "that", "have",
    "في", "من", "على", "هل", "ما", "عن", "الى", "إلى", "او", "أو", "مع",
}


class Passage(BaseModel):
    source_id: str
    ordinal: int
    text: str
    score: float


def terms_of(text: str) -> list[str]:
    return [t for t in re.findall(r"\w+", search_key(text)) if len(t) > 1 and t not in STOP]


async def retrieve(org_id: str, source_ids: list[str], query: str, limit: int = 4) -> list[Passage]:
    """The best passages for a query; the score is 0 to 1 (half vector, half keyword overlap)."""
    if not source_ids or not query.strip():
        return []
    [vector] = await embed([query])
    terms = terms_of(query)
    async with pool.connection() as connection:
        rows = await (
            await connection.execute(
                "SELECT source_id::text, ordinal, text, search_key, 1 - (embedding <=> %s::vector) AS similarity"
                " FROM kb.chunks WHERE org_id = %s AND source_id = ANY(%s::uuid[])"
                " ORDER BY embedding <=> %s::vector LIMIT 40",
                (vector, org_id, source_ids, vector),
            )
        ).fetchall()
        if terms:
            pattern = "|".join(re.escape(t) for t in terms)
            keyword_rows = await (
                await connection.execute(
                    "SELECT source_id::text, ordinal, text, search_key, 0.0 AS similarity FROM kb.chunks"
                    " WHERE org_id = %s AND source_id = ANY(%s::uuid[]) AND search_key ~ %s LIMIT 40",
                    (org_id, source_ids, pattern),
                )
            ).fetchall()
            merged: dict[tuple[str, int], tuple] = {(r[0], r[1]): r for r in keyword_rows}
            for r in rows:
                merged[(r[0], r[1])] = r
            rows = list(merged.values())
    scored: list[Passage] = []
    for source_id, ordinal, text, key, similarity in rows:
        overlap = sum(1 for t in terms if t in key) / len(terms) if terms else 0.0
        score = 0.5 * max(0.0, float(similarity)) + 0.5 * overlap
        scored.append(Passage(source_id=source_id, ordinal=ordinal, text=text, score=round(score, 3)))
    scored.sort(key=lambda p: p.score, reverse=True)
    return scored[:limit]


def confidence(score: float) -> str:
    """high, medium or low, shown with each citation (INB-001 FR-022)."""
    if score >= 0.5:
        return "high"
    if score >= settings.low_confidence_below:
        return "medium"
    return "low"
