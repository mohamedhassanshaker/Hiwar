"""Reading the text of one attached document."""

from __future__ import annotations

import base64
import binascii
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from awp_agent.ingestion import archives, parsing

router = APIRouter()


class ExtractDocumentRequest(BaseModel):
    """One document to read, as the console sends it."""

    filename: str
    content_base64: str


@router.post("/documents/extract")
async def extract_document(request: ExtractDocumentRequest) -> dict[str, Any]:
    """`UC-28.2-08`: the text of one document, so an agent can read what was attached.

    The same parser the ingestion workflow uses, on one file rather than a collection: a
    photographed receipt is recognised, a PDF is exported, and a format this image cannot
    parse says so rather than returning an empty string that reads like an empty receipt.
    A `.zip` is read file by file (the assistant panel's attachments); ingestion does not
    open archives.
    """
    suffix = Path(request.filename).suffix or ""
    read = archives.read_archive if suffix.lower() == ".zip" else _parse
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"document{suffix}"
        try:
            path.write_bytes(base64.b64decode(request.content_base64, validate=True))
        except (binascii.Error, ValueError) as problem:
            raise HTTPException(status_code=400, detail="the content is not base64") from problem
        try:
            text = read(path)
        except parsing.ParserUnavailableError as problem:
            raise HTTPException(status_code=422, detail=str(problem)) from problem
        except parsing.DocumentUnreadableError as problem:
            detail = f"{request.filename} could not be read: {problem}"
            raise HTTPException(status_code=422, detail=detail) from problem
    return {"text": text}


def _parse(path: Path) -> str:
    """One document, recognised by OCR when it has no text layer."""
    return parsing.parse(path, ocr=True)
