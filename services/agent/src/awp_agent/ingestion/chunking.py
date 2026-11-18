"""Chunking, one technique per collection.

The Knowledge collection screen offers Fixed, Recursive, Semantic and By heading. Each is a
pure function from text to chunks, so a collection can be re-chunked from the stored raw
document without a model call where the technique does not need one.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

Technique = Literal["Fixed", "Recursive", "Semantic", "ByHeading"]

HEADING = re.compile(r"^(#{1,6})\s+(.*)$", re.MULTILINE)
PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?؟])\s+")
RECURSIVE_SEPARATORS = ("\n\n", "\n", ". ", " ")


class ChunkingConfig(BaseModel):
    """The collection's chunking configuration."""

    technique: Technique = "Recursive"
    chunk_size: int = 1200
    overlap: int = 120


class Chunk(BaseModel):
    """One chunk, with the heading path it came from."""

    index: int
    text: str
    heading: str = ""
    metadata: dict[str, str] = Field(default_factory=dict)


def _fixed(text: str, size: int, overlap: int) -> list[str]:
    step = max(1, size - overlap)
    pieces = [text[start : start + size] for start in range(0, len(text), step)]
    return [piece for piece in pieces if piece.strip()]


def _recursive(text: str, size: int, overlap: int) -> list[str]:
    """Split on the largest separator that gets the pieces under the size."""
    if len(text) <= size:
        return [text] if text.strip() else []
    for separator in RECURSIVE_SEPARATORS:
        parts = text.split(separator)
        if len(parts) == 1:
            continue
        chunks: list[str] = []
        current = ""
        for part in parts:
            candidate = f"{current}{separator}{part}" if current else part
            if len(candidate) <= size:
                current = candidate
                continue
            if current:
                chunks.append(current)
            current = part if len(part) <= size else ""
            if not current:
                chunks.extend(_recursive(part, size, overlap))
        if current:
            chunks.append(current)
        return [chunk for chunk in chunks if chunk.strip()]
    return _fixed(text, size, overlap)


def _semantic(text: str, size: int) -> list[str]:
    """Group whole sentences until the size is reached, so no sentence is ever cut."""
    chunks: list[str] = []
    current = ""
    for sentence in SENTENCE_SPLIT.split(text):
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > size:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current.strip():
        chunks.append(current)
    return chunks


def _by_heading(text: str) -> list[tuple[str, str]]:
    """One chunk per heading, each carrying its heading as metadata."""
    matches = list(HEADING.finditer(text))
    if not matches:
        return [("", text)]
    sections: list[tuple[str, str]] = []
    if matches[0].start() > 0:
        sections.append(("", text[: matches[0].start()]))
    for position, match in enumerate(matches):
        end = matches[position + 1].start() if position + 1 < len(matches) else len(text)
        sections.append((match.group(2).strip(), text[match.end() : end]))
    return [(heading, body) for heading, body in sections if body.strip()]


def chunk(text: str, config: ChunkingConfig) -> list[Chunk]:
    """Chunk one document with the collection's configuration."""
    if config.technique == "ByHeading":
        return [
            Chunk(index=index, text=body.strip(), heading=heading)
            for index, (heading, body) in enumerate(_by_heading(text))
        ]
    if config.technique == "Fixed":
        pieces = _fixed(text, config.chunk_size, config.overlap)
    elif config.technique == "Semantic":
        pieces = _semantic(text, config.chunk_size)
    else:
        pieces = _recursive(text, config.chunk_size, config.overlap)
    return [
        Chunk(index=index, text=piece.strip())
        for index, piece in enumerate(pieces)
        if piece.strip()
    ]
