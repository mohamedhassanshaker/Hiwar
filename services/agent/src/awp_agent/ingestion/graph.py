"""The graph side of retrieval: Graphiti on Neo4j (stack specification 6.5).

Graphiti is the temporal knowledge graph engine the platform uses. It extracts the entities
and relations itself from each **episode**, records every fact with a validity window, and
invalidates a contradicted fact instead of overwriting it — which is why a superseded rule
stops being recalled without anyone deleting it.

One group per knowledge collection (`kc_<id>`) and one per memory scope (`mem_org`,
`mem_unit_<id>`, `mem_agent_<id>`, `mem_session_<id>`), so the harness can pass an agent
exactly the groups it is allowed to use.

Every model call Graphiti makes goes through agentgateway, like every other model call in
the service: the LLM client, the embedder and the re-ranker are all pointed at the gateway's
OpenAI-compatible endpoint with a route alias as the model name.
"""

from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache

from graphiti_core import Graphiti
from graphiti_core.cross_encoder import OpenAIRerankerClient
from graphiti_core.edges import EntityEdge
from graphiti_core.embedder import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.errors import NodeNotFoundError
from graphiti_core.llm_client import LLMConfig, OpenAIClient
from graphiti_core.nodes import EntityNode, EpisodeType, EpisodicNode
from pydantic import BaseModel, Field

from awp_agent.clients import gateway_client
from awp_agent.config import settings

# The route aliases Graphiti uses. Extraction runs on the collection's own entity-extraction
# route (D260); this one serves the calls that extract nothing, which never reach the model.
EXTRACTION_ROUTE = "extraction-default"
RERANKER_ROUTE = "reranker-default"


class GraphFact(BaseModel):
    """A fact the retriever found in the graph, with the chunks that support it."""

    source: str
    relation: str
    target: str
    fact: str = ""
    chunk_ids: list[str] = Field(default_factory=list)
    valid_at: datetime | None = None
    invalid_at: datetime | None = None


def collection_group(collection_id: str) -> str:
    """The Graphiti group of one knowledge collection."""
    return f"kc_{collection_id}"


@lru_cache(maxsize=8)
def client(extraction_route: str = EXTRACTION_ROUTE) -> Graphiti:
    """The Graphiti client for one extraction route, built once per process and pointed at
    agentgateway."""
    config = settings()
    api_key = config.run_token or "anonymous"
    # The gateway's OpenAI-compatible API, not the listener: every Graphiti call appends
    # its own path to this, and without the version segment the gateway answers
    # `404 route not found` — which is what Graph and Hybrid retrieval came back as.
    base_url = gateway_client.openai_base_url()
    # Graphiti sends its simpler prompts to `small_model`, which otherwise defaults to an
    # OpenAI model name the gateway does not route (D260).
    llm_config = LLMConfig(
        api_key=api_key, base_url=base_url, model=extraction_route, small_model=extraction_route
    )
    return Graphiti(
        uri=config.neo4j_url,
        user=config.neo4j_user,
        password=config.neo4j_password,
        llm_client=OpenAIClient(config=llm_config),
        embedder=OpenAIEmbedder(
            config=OpenAIEmbedderConfig(
                api_key=api_key,
                base_url=base_url,
                embedding_model=config.embedding_route,
            )
        ),
        cross_encoder=OpenAIRerankerClient(
            config=LLMConfig(
                api_key=api_key, base_url=base_url, model=RERANKER_ROUTE
            )
        ),
    )


async def prepare() -> None:
    """Create Graphiti's own indexes and constraints. Idempotent."""
    await client().build_indices_and_constraints()


async def add_chunk(
    group_id: str,
    chunk_id: str,
    text: str,
    source: str,
    reference_time: datetime | None = None,
    extraction_route: str = EXTRACTION_ROUTE,
) -> None:
    """Hand one chunk to Graphiti as an episode, extracted on the collection's route.

    The episode uuid is the chunk id, so re-ingesting a document updates the episode
    instead of adding a second one, a fact's `episodes` are the chunks that support it,
    which is what the retrieval test cites, and removing a source finds its episodes (D258).
    `add_episode` with a uuid loads that episode rather than creating it, so a new chunk's
    episode is saved first under its chunk id (D259).
    """
    graphiti = client(extraction_route)
    name = f"{source}#{chunk_id}"
    valid_at = reference_time or datetime.now(UTC)
    try:
        await EpisodicNode.get_by_uuid(graphiti.driver, chunk_id)
    except NodeNotFoundError:
        await EpisodicNode(
            uuid=chunk_id,
            name=name,
            group_id=group_id,
            source=EpisodeType.text,
            source_description=source,
            content=text,
            valid_at=valid_at,
        ).save(graphiti.driver)
    await graphiti.add_episode(
        name=name,
        episode_body=text,
        source=EpisodeType.text,
        source_description=source,
        reference_time=valid_at,
        group_id=group_id,
        uuid=chunk_id,
    )


async def neighbours(collection_id: str, query: str, limit: int = 20) -> list[GraphFact]:
    """The facts around the entities a query names, in one collection's group."""
    return await search_groups(query, [collection_group(collection_id)], limit=limit)


async def search_groups(query: str, groups: list[str], limit: int = 20) -> list[GraphFact]:
    """Graphiti's hybrid search over the groups the caller is allowed to read."""
    if not groups:
        return []
    graphiti = client()
    edges: list[EntityEdge] = await graphiti.search(
        query, group_ids=groups, num_results=limit
    )
    if not edges:
        return []

    uuids = {edge.source_node_uuid for edge in edges} | {
        edge.target_node_uuid for edge in edges
    }
    nodes = await EntityNode.get_by_uuids(graphiti.driver, list(uuids))
    name_of = {node.uuid: node.name for node in nodes}

    return [
        GraphFact(
            source=name_of.get(edge.source_node_uuid, ""),
            relation=edge.name,
            target=name_of.get(edge.target_node_uuid, ""),
            fact=edge.fact,
            chunk_ids=list(edge.episodes or []),
            valid_at=edge.valid_at,
            invalid_at=edge.invalid_at,
        )
        for edge in edges
        # A fact Graphiti has invalidated was contradicted by a later episode, so it is
        # history, not knowledge, and never goes into a run's context.
        if edge.invalid_at is None
    ]


async def count_entities(collection_id: str) -> int:
    """How many entities a collection's group holds."""
    nodes = await EntityNode.get_by_group_ids(
        client().driver, [collection_group(collection_id)]
    )
    return len(nodes)


async def drop(collection_id: str) -> None:
    """Remove everything a collection put in the graph: its entities, episodes and communities."""
    await EntityNode.delete_by_group_id(client().driver, collection_group(collection_id))


async def remove_chunks(chunk_ids: list[str]) -> None:
    """Remove some chunks' episodes and the facts and entities only they asserted (D258).

    Graphiti's own removal: an edge another episode first asserted, or an entity another
    episode also mentions, stays.
    """
    graphiti = client()
    for chunk_id in chunk_ids:
        try:
            await graphiti.remove_episode(chunk_id)
        except NodeNotFoundError:
            # A Vector collection's chunks, or a chunk whose extraction never ran, have none.
            continue


async def graph_healthy() -> bool:
    """True when Neo4j answers."""
    try:
        async with client().driver.session() as session:
            await session.run("RETURN 1")
    except Exception:  # noqa: BLE001 - a health probe reports, it never raises
        return False
    return True
