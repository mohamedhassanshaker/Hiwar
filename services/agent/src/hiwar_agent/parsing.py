"""Text extraction for knowledge files and web pages (KNO-001 FR-010, FR-013)."""

from __future__ import annotations

import csv
import io
from pathlib import Path

from bs4 import BeautifulSoup


class ParseFailed(Exception):
    """The file has no readable text; the message is the reason shown to the user."""


def extract_file(path: Path, mime: str | None) -> str:
    suffix = path.suffix.lower()
    data = path.read_bytes()
    if suffix == ".pdf" or mime == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
        if not text.strip():
            raise ParseFailed("The PDF is a scan with no readable text. Upload a text version.")
        return text
    if suffix == ".docx":
        from docx import Document

        document = Document(io.BytesIO(data))
        return "\n\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
    if suffix == ".csv":
        rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace"))))
        if not rows:
            raise ParseFailed("The CSV file is empty.")
        header, body = rows[0], rows[1:]
        return "\n".join("; ".join(f"{h}: {v}" for h, v in zip(header, row, strict=False)) for row in body)
    if suffix in (".txt", ".md"):
        return data.decode("utf-8-sig", errors="replace")
    raise ParseFailed("This file type is not supported. Use PDF, DOCX, TXT, MD or CSV.")


def extract_html(html: str) -> tuple[str, list[str]]:
    """The readable text of a page and its links."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "form"]):
        tag.decompose()
    links = [a["href"] for a in soup.find_all("a", href=True)]
    text = soup.get_text("\n")
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line), links


def languages_of(text: str) -> str:
    arabic = sum(1 for ch in text if "؀" <= ch <= "ۿ")
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    if arabic and latin and min(arabic, latin) / max(arabic, latin) > 0.1:
        return "English and Arabic"
    return "Arabic" if arabic > latin else "English"
