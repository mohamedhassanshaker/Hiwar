"""Embeddings through the OpenAI-compatible provider."""

from __future__ import annotations

from openai import AsyncOpenAI

from hiwar_agent.config import settings

client = AsyncOpenAI(base_url=settings.model_base_url, api_key=settings.model_api_key)


async def embed(texts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), 64):
        batch = texts[start : start + 64]
        response = await client.embeddings.create(
            model=settings.embed_model, input=batch, dimensions=settings.embed_dimensions
        )
        vectors.extend(item.embedding for item in sorted(response.data, key=lambda d: d.index))
    return vectors
