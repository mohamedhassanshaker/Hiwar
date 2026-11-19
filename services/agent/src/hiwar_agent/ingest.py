"""Knowledge ingestion: extract, chunk, embed, index (KNO-001 FR-007, FR-013).

The web application stores the source and calls `/ingest`; this module reports Processing,
then Ready with the chunk count or Failed with a reason, through the web's callback.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlsplit

import httpx
import structlog
from pydantic import BaseModel

from hiwar_agent.chunking import ChunkingConfig, chunk
from hiwar_agent.config import settings
from hiwar_agent.egress import EgressRefused, fetch
from hiwar_agent.embeddings import embed
from hiwar_agent.normalise import search_key
from hiwar_agent.parsing import ParseFailed, extract_file, extract_html, languages_of
from hiwar_agent.store import pool

log = structlog.get_logger()

CHUNKING = ChunkingConfig(technique="Recursive", chunk_size=1000, overlap=100)
MAX_PAGES = 60


class IngestRequest(BaseModel):
    org_id: str
    source_id: str
    type: str  # file | website | faq
    file: str | None = None
    mime: str | None = None
    url: str | None = None
    depth: int = 2
    domains: list[str] = []
    question: str | None = None
    answer: str | None = None


async def report(source_id: str, payload: dict[str, object]) -> None:
    """Sends a status change to the web application, which owns the source row."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            await client.post(
                f"{settings.web_callback_url}/api/internal/sources/{source_id}",
                json=payload,
                headers={"authorization": f"Bearer {settings.agent_service_token}"},
            )
        except httpx.HTTPError as problem:
            log.warning("source status callback failed", source_id=source_id, problem=str(problem))


async def crawl(url: str, depth: int, domains: list[str]) -> list[tuple[str, str]]:
    """Breadth-first crawl to `depth` levels, staying on `domains`; returns (url, text) pages."""
    allowed = {d.lower().removeprefix("www.") for d in domains if d} or {
        (urlsplit(url).hostname or "").lower().removeprefix("www.")
    }
    seen: set[str] = set()
    frontier = [url]
    pages: list[tuple[str, str]] = []
    for _level in range(max(1, depth)):
        next_frontier: list[str] = []
        for page_url in frontier:
            if page_url in seen or len(pages) >= MAX_PAGES:
                continue
            seen.add(page_url)
            response = await fetch("GET", page_url)
            if response.status_code in (401, 403):
                if page_url == url:
                    raise ParseFailed("Page requires sign-in")
                continue
            if response.status_code >= 400 or "html" not in response.headers.get("content-type", ""):
                continue
            text, links = extract_html(response.text)
            if text.strip():
                pages.append((page_url, text))
            for link in links:
                absolute = urldefrag(urljoin(page_url, link))[0]
                host = (urlsplit(absolute).hostname or "").lower().removeprefix("www.")
                if absolute.startswith("http") and host in allowed and absolute not in seen:
                    next_frontier.append(absolute)
        frontier = next_frontier
    if not pages:
        raise ParseFailed("No readable pages were found at this address.")
    return pages


async def ingest(request: IngestRequest) -> None:
    await report(request.source_id, {"status": "processing"})
    try:
        if request.type == "faq":
            documents = [f"Question: {request.question}\nAnswer: {request.answer}"]
            pieces = documents
        else:
            if request.type == "file":
                documents = [extract_file(Path(settings.files_dir) / (request.file or ""), request.mime)]
            else:
                pages = await crawl(request.url or "", request.depth, request.domains)
                documents = [f"{page_url}\n{text}" for page_url, text in pages]
            pieces = [c.text for doc in documents for c in chunk(doc, CHUNKING)]
        if not pieces:
            raise ParseFailed("No readable text was found.")
        vectors = await embed(pieces)
        async with pool.connection() as connection, connection.transaction():
            await connection.execute(
                "DELETE FROM kb.chunks WHERE org_id = %s AND source_id = %s", (request.org_id, request.source_id)
            )
            async with connection.cursor() as cursor:
                await cursor.executemany(
                    "INSERT INTO kb.chunks (org_id, source_id, ordinal, text, search_key, embedding)"
                    " VALUES (%s, %s, %s, %s, %s, %s)",
                    [
                        (request.org_id, request.source_id, index, text, search_key(text), vector)
                        for index, (text, vector) in enumerate(zip(pieces, vectors, strict=True))
                    ],
                )
        await report(
            request.source_id,
            {
                "status": "ready",
                "chunks": len(pieces),
                "languages": languages_of(" ".join(documents)[:20000]),
                "bytes": sum(len(p.encode()) for p in pieces) if request.type == "website" else None,
            },
        )
    except (ParseFailed, EgressRefused) as problem:
        await report(request.source_id, {"status": "failed", "reason": str(problem)})
    except httpx.HTTPError as problem:
        await report(request.source_id, {"status": "failed", "reason": f"The address could not be reached: {problem}"})
    except Exception as problem:  # noqa: BLE001 - every failure must reach the source row
        log.exception("ingestion failed", source_id=request.source_id)
        await report(request.source_id, {"status": "failed", "reason": f"Preparation failed: {type(problem).__name__}"})


async def delete_source(org_id: str, source_id: str) -> None:
    async with pool.connection() as connection:
        await connection.execute("DELETE FROM kb.chunks WHERE org_id = %s AND source_id = %s", (org_id, source_id))
