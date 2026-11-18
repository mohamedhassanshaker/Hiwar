"""The ingestion activities of stack specification 6.5: fetch, parse, chunk, index, episode.

They are separate activities so that a large document resumes from the stage it reached rather
than starting again, and so the Knowledge screen's ingestion progress has real stages to show.

The chunk is written twice: as a passage row with its embedding in `awp_kb`, and as a
Graphiti episode in the collection's group. Graphiti does the entity and relation extraction
itself, so there is no extraction prompt here.
"""

from __future__ import annotations

import asyncio
import hashlib
import tempfile
from pathlib import Path

from pydantic import BaseModel, Field
from temporalio import activity

from awp_agent.clients import gateway_client, object_store
from awp_agent.config import settings
from awp_agent.harness.hooks.pii import PiiMaskHook
from awp_agent.ingestion import graph, parsing, vectors
from awp_agent.ingestion.chunking import ChunkingConfig, chunk
from awp_agent.ingestion.normalise import normalise_arabic

EMBED_BATCH = 64


class DocumentRef(BaseModel):
    """One raw document in object storage."""

    doc_id: str
    bucket: str = ""
    key: str
    source: str = ""
    filename: str = ""


class IngestionConfig(BaseModel):
    """The collection's ingestion configuration."""

    collection_id: str
    chunking: ChunkingConfig = Field(default_factory=ChunkingConfig)
    ocr: bool = False
    mask_pii: bool = True
    extract_graph: bool = True
    embedding_route: str = ""


class ParsedDocument(BaseModel):
    """The text of one parsed document."""

    doc_id: str
    source: str
    text: str


class IndexedDocument(BaseModel):
    """What one document contributed to the collection."""

    doc_id: str
    chunks: int = 0
    episodes: int = 0


def _download_and_parse(document: DocumentRef, config: IngestionConfig) -> str:
    """Fetch and parse one document. Blocking, so the activity runs it in a thread."""
    bucket = document.bucket or settings().s3_bucket_documents
    suffix = Path(document.filename or document.key).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        local = Path(handle.name)
    try:
        object_store.client().download_file(bucket, document.key, str(local))
        return parsing.parse(local, ocr=config.ocr)
    finally:
        local.unlink(missing_ok=True)


@activity.defn(name="parse_document")
async def parse_document(request: tuple[DocumentRef, IngestionConfig]) -> ParsedDocument:
    """Read a raw document from object storage, parse it, normalise it and mask it."""
    document, config = request
    text = await asyncio.to_thread(_download_and_parse, document, config)
    text = normalise_arabic(text)
    if config.mask_pii:
        text, _ = PiiMaskHook().pre_model(text)
    return ParsedDocument(
        doc_id=document.doc_id, source=document.source or document.key, text=text
    )


@activity.defn(name="index_document")
async def index_document(request: tuple[ParsedDocument, IngestionConfig]) -> IndexedDocument:
    """Chunk, embed and write one document's passages to `awp_kb`."""
    document, config = request
    pieces = chunk(document.text, config.chunking)
    if not pieces:
        return IndexedDocument(doc_id=document.doc_id)

    passages = [
        vectors.Passage(
            chunk_id=_chunk_id(document.doc_id, piece.index),
            doc_id=document.doc_id,
            source=document.source,
            text=piece.text,
            heading=piece.heading,
        )
        for piece in pieces
    ]

    route = config.embedding_route or settings().embedding_route
    written = 0
    for start in range(0, len(passages), EMBED_BATCH):
        batch = passages[start : start + EMBED_BATCH]
        embedded = await gateway_client.embed([passage.text for passage in batch], route=route)
        written += await vectors.upsert(config.collection_id, batch, embedded)

    return IndexedDocument(doc_id=document.doc_id, chunks=written)


@activity.defn(name="extract_graph")
async def extract_graph(
    request: tuple[ParsedDocument, IngestionConfig, str],
) -> IndexedDocument:
    """Hand the document's chunks to Graphiti as episodes in the collection's group.

    Graphiti extracts the entities and the relations, dates every fact and invalidates the
    ones a later episode contradicts. The third element of the request is the collection's
    entity-extraction route, which the extraction runs on (D260).

    Each chunk takes several model calls, so the activity heartbeats the number of chunks
    done and a retry resumes from there rather than from the first chunk (D276).
    """
    document, config, route = request
    if not config.extract_graph:
        return IndexedDocument(doc_id=document.doc_id)

    group = graph.collection_group(config.collection_id)
    pieces = chunk(document.text, config.chunking)
    details = activity.info().heartbeat_details
    done = int(details[0]) if details else 0
    for position, piece in enumerate(pieces[done:], start=done):
        await graph.add_chunk(
            group_id=group,
            chunk_id=_chunk_id(document.doc_id, piece.index),
            text=piece.text,
            source=document.source,
            extraction_route=route,
        )
        activity.heartbeat(position + 1)
    return IndexedDocument(doc_id=document.doc_id, episodes=len(pieces))


@activity.defn(name="count_entities")
async def count_entities(collection_id: str) -> int:
    """How many entities Graphiti holds for one collection, for the Knowledge KPIs."""
    return await graph.count_entities(collection_id)


def _chunk_id(doc_id: str, index: int) -> str:
    """A stable chunk id, so re-ingesting a document replaces its rows instead of adding."""
    digest = hashlib.sha1(f"{doc_id}:{index}".encode(), usedforsecurity=False).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"
