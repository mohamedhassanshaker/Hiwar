"""Access to `kb.chunks`. The agent service writes only this table."""

from __future__ import annotations

from pgvector.psycopg import register_vector_async
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from hiwar_agent.config import settings


async def _configure(connection: AsyncConnection) -> None:
    await register_vector_async(connection)


pool = AsyncConnectionPool(settings.database_url, open=False, min_size=1, max_size=8, configure=_configure)
