"""The passage index of stack specification 6.5, in the `awp_kb` database.

One table, `passage`, holds every collection's chunks; each collection gets its own partial
HNSW index built from its own settings, so the distance metric, the HNSW parameters and the
quantisation on the Knowledge screen are what the index actually uses.

The embedding column is an unconstrained `vector`, because collections differ in dimension;
each partial index and each query casts to that collection's dimension, which is what lets
one table carry them all. A partial index and a query cover only the rows of their own
dimension, so after the embedding route changes model a collection's older rows are skipped
rather than failing the cast, until a re-index replaces them (D256).

`awp_kb` is a rebuildable index, not a system of record: everything here can be produced
again from the domain database and the raw documents in object storage.
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal

import psycopg
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

from awp_agent.config import settings

Metric = Literal["Cosine", "L2", "InnerProduct"]

# The pgvector operator class and operator of each distance metric the screen offers.
_OPERATOR_CLASS: dict[str, tuple[str, str]] = {
    "Cosine": ("vector_cosine_ops", "<=>"),
    "L2": ("vector_l2_ops", "<->"),
    "InnerProduct": ("vector_ip_ops", "<#>"),
}

_pool: AsyncConnectionPool | None = None
_pool_lock = asyncio.Lock()


class IndexConfig(BaseModel):
    """The collection's index settings, as the Knowledge screen holds them."""

    dimension: int = 1536
    metric: Metric = "Cosine"
    hnsw_m: int = 16
    hnsw_ef_construction: int = 64
    # `halfvec` halves the index size at a small cost in recall.
    half_precision: bool = False


# Postgres refuses an HNSW index on plain `vector` past this many dimensions outright.
_VECTOR_HNSW_MAX_DIMENSIONS = 2000


def _storage_kind(config: IndexConfig) -> str:
    """`halfvec` or `vector` — whichever the index is actually built and queried as.

    Past `_VECTOR_HNSW_MAX_DIMENSIONS` this is not the screen's precision/size tradeoff
    anymore: `vector` cannot index the dimension at all, so an embedding route whose model
    produces more (several OpenRouter embedding models already do, at 2048) gets `halfvec`
    regardless of what the collection's own setting says.
    """
    too_big = config.dimension > _VECTOR_HNSW_MAX_DIMENSIONS
    return "halfvec" if (config.half_precision or too_big) else "vector"


class Passage(BaseModel):
    """One stored chunk and where it came from."""

    chunk_id: str
    doc_id: str
    source: str
    text: str
    heading: str = ""
    score: float = 0.0
    metadata: dict[str, str] = Field(default_factory=dict)


SCHEMA = """
CREATE TABLE IF NOT EXISTS passage (
  collection_id text   NOT NULL,
  chunk_id      text   NOT NULL,
  doc_id        text   NOT NULL,
  source        text   NOT NULL DEFAULT '',
  heading       text   NOT NULL DEFAULT '',
  text          text   NOT NULL,
  metadata      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  embedding     vector NOT NULL,
  search        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  PRIMARY KEY (collection_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS passage_search ON passage USING gin (search);
CREATE INDEX IF NOT EXISTS passage_doc ON passage (collection_id, doc_id);
"""


def _legacy_index_name(collection_id: str) -> str:
    """The one index a collection had before indexes were per dimension (D256)."""
    safe = "".join(character if character.isalnum() else "_" for character in collection_id)
    return f"passage_hnsw_{safe.lower()}"


def _index_name(collection_id: str, dimension: int) -> str:
    """A collection id is a code the user chose, so it is never interpolated raw."""
    return f"{_legacy_index_name(collection_id)}__d{dimension}"


async def pool() -> AsyncConnectionPool:
    """The connection pool for `awp_kb`, opened once per process.

    A pool is kept only once it is open and the schema is in place. psycopg_pool 3.3 closes a
    pool whose `open(wait=True)` times out, so keeping it before that would refuse every later
    call with `PoolClosed` for the life of the process; a failed open is closed and the next
    call tries again (D355).
    """
    global _pool
    async with _pool_lock:
        if _pool is None:
            candidate = AsyncConnectionPool(
                settings().kb_database_url, min_size=1, max_size=8, open=False
            )
            try:
                await candidate.open(wait=True)
                async with candidate.connection() as connection:
                    await connection.execute(SCHEMA)
            except BaseException:
                await candidate.close()
                raise
            _pool = candidate
    return _pool


async def ensure_collection(collection_id: str, config: IndexConfig) -> None:
    """Create the collection's partial HNSW index when it is not there.

    Safe to call on every ingestion; `CREATE INDEX IF NOT EXISTS` does nothing the second
    time. Changing the embedding route changes the dimension, which re-indexes the whole
    collection, and that is what the screen warns about.
    """
    operator_class, _ = _OPERATOR_CLASS[config.metric]
    kind = _storage_kind(config)
    if kind == "halfvec":
        operator_class = operator_class.replace("vector_", "halfvec_")
    statement = psycopg.sql.SQL(
        """
        CREATE INDEX IF NOT EXISTS {name} ON passage
        USING hnsw ((embedding::{kind}({dimension})) {operator_class})
        WITH (m = {m}, ef_construction = {ef})
        WHERE collection_id = {collection_id} AND vector_dims(embedding) = {dimension}
        """
    ).format(
        name=psycopg.sql.Identifier(_index_name(collection_id, config.dimension)),
        kind=psycopg.sql.SQL(kind),
        dimension=psycopg.sql.Literal(config.dimension),
        operator_class=psycopg.sql.SQL(operator_class),
        m=psycopg.sql.Literal(config.hnsw_m),
        ef=psycopg.sql.Literal(config.hnsw_ef_construction),
        collection_id=psycopg.sql.Literal(collection_id),
    )
    connections = await pool()
    async with connections.connection() as connection:
        # The index of the old scheme covers every row of the collection, so a row of another
        # dimension fails its cast on insert; it goes, and no row goes with it.
        await connection.execute(
            psycopg.sql.SQL("DROP INDEX IF EXISTS {name}").format(
                name=psycopg.sql.Identifier(_legacy_index_name(collection_id))
            )
        )
        await connection.execute(statement)


async def upsert(
    collection_id: str,
    passages: list[Passage],
    embeddings: list[list[float]],
    config: IndexConfig | None = None,
) -> int:
    """Write chunks and their vectors. The chunk id is the key, so re-ingestion replaces."""
    if not passages:
        return 0
    settings_for_index = config or IndexConfig(dimension=len(embeddings[0]))
    await ensure_collection(collection_id, settings_for_index)

    rows = [
        (
            collection_id,
            passage.chunk_id,
            passage.doc_id,
            passage.source,
            passage.heading,
            passage.text,
            json.dumps(passage.metadata),
            _as_vector(embedding),
        )
        for passage, embedding in zip(passages, embeddings, strict=True)
    ]
    connections = await pool()
    async with connections.connection() as connection, connection.cursor() as cursor:
        await cursor.executemany(
            """
                INSERT INTO passage
                  (collection_id, chunk_id, doc_id, source, heading, text, metadata, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::vector)
                ON CONFLICT (collection_id, chunk_id) DO UPDATE SET
                  doc_id = EXCLUDED.doc_id, source = EXCLUDED.source,
                  heading = EXCLUDED.heading, text = EXCLUDED.text,
                  metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding
                """,
            rows,
        )
    return len(rows)


async def search(
    collection_id: str,
    vector: list[float],
    limit: int = 8,
    config: IndexConfig | None = None,
) -> list[Passage]:
    """The nearest passages to a query vector, scored so that 1.0 is an exact match."""
    index = config or IndexConfig(dimension=len(vector))
    _, operator = _OPERATOR_CLASS[index.metric]
    # Must agree with `ensure_collection`'s own choice, or the query casts to a type the
    # partial index was never built for and never uses it.
    kind = _storage_kind(index)
    statement = psycopg.sql.SQL(
        """
        SELECT chunk_id, doc_id, source, heading, text, metadata,
               1 - (embedding::{kind}({dimension}) {operator} %s::{kind}({dimension})) AS score
        FROM passage
        WHERE collection_id = %s AND vector_dims(embedding) = {dimension}
        ORDER BY embedding::{kind}({dimension}) {operator} %s::{kind}({dimension})
        LIMIT %s
        """
    ).format(
        kind=psycopg.sql.SQL(kind),
        dimension=psycopg.sql.Literal(index.dimension),
        operator=psycopg.sql.SQL(operator),
    )
    literal = _as_vector(vector)
    connections = await pool()
    async with connections.connection() as connection, connection.cursor() as cursor:
        await cursor.execute(statement, (literal, collection_id, literal, limit))
        rows = await cursor.fetchall()

    return [
        Passage(
            chunk_id=row[0],
            doc_id=row[1],
            source=row[2],
            heading=row[3],
            text=row[4],
            metadata=row[5] or {},
            score=float(row[6]),
        )
        for row in rows
    ]


async def chunk_ids_of(collection_id: str, doc_ids: list[str]) -> list[str]:
    """The chunks a collection holds for some of its documents; each names its graph episode."""
    connections = await pool()
    async with connections.connection() as connection:
        cursor = await connection.execute(
            "SELECT chunk_id FROM passage WHERE collection_id = %s AND doc_id = ANY(%s)",
            (collection_id, doc_ids),
        )
        return [str(row[0]) for row in await cursor.fetchall()]


async def delete_documents(collection_id: str, doc_ids: list[str]) -> int:
    """Delete some documents' passages from a collection (D258)."""
    connections = await pool()
    async with connections.connection() as connection:
        cursor = await connection.execute(
            "DELETE FROM passage WHERE collection_id = %s AND doc_id = ANY(%s)",
            (collection_id, doc_ids),
        )
        return cursor.rowcount


async def drop(collection_id: str) -> None:
    """Delete a knowledge collection's passages and its indexes, one per dimension."""
    legacy = _legacy_index_name(collection_id)
    connections = await pool()
    async with connections.connection() as connection:
        await connection.execute(
            "DELETE FROM passage WHERE collection_id = %s", (collection_id,)
        )
        cursor = await connection.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'passage'"
            " AND (indexname = %s OR starts_with(indexname, %s))",
            (legacy, f"{legacy}__d"),
        )
        for (name,) in await cursor.fetchall():
            await connection.execute(
                psycopg.sql.SQL("DROP INDEX IF EXISTS {name}").format(
                    name=psycopg.sql.Identifier(name)
                )
            )


async def vectors_healthy() -> bool:
    """True when `awp_kb` answers."""
    if not settings().vectors_enabled:
        return False
    try:
        connections = await pool()
        async with connections.connection() as connection:
            await connection.execute("SELECT 1")
    except Exception:  # noqa: BLE001 - a health probe reports, it never raises
        return False
    return True


def _as_vector(values: list[float]) -> str:
    """pgvector's text input format, which psycopg casts with `::vector`."""
    return "[" + ",".join(repr(float(value)) for value in values) + "]"
