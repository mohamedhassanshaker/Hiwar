"""Document parsing.

SD-7 chooses docling. It pulls a large native stack, so it is imported lazily and only when a
document actually needs it; plain text and Markdown never load it at all. A format that needs
docling and has no docling installed raises, rather than silently indexing nothing.
"""

from __future__ import annotations

import io
import os
from datetime import datetime
from pathlib import Path
from typing import Any

# A pod has no egress. Docling fetches its layout-detection weights from HuggingFace the
# first time a PDF, DOCX, XLSX, PPTX or HTML document is parsed — without this, that connect
# does not fail, it hangs until the activity's own timeout, on every first conversion. Built
# by `docling-tools models download` where there is a network (the agent image's Dockerfile),
# and read from here instead of fetched remotely.
DOCLING_ARTIFACTS_PATH = os.environ.get("DOCLING_ARTIFACTS_PATH")

PLAIN_SUFFIXES = frozenset({".txt", ".md", ".markdown", ".csv", ".json"})
DOCLING_SUFFIXES = frozenset({".pdf", ".docx", ".xlsx", ".pptx", ".html", ".htm"})
# A photograph carries no text layer at all, so there is nothing for docling to export: the
# only way to read a receipt somebody snapped is to recognise the characters in it.
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp"})
# Office 97–2003 formats nothing in the image reads, with the format to save them as instead.
# `.xls` is read by xlrd (ADR-0002); `.ppt` would need LibreOffice in the image.
SAVE_AS = {".ppt": ".pptx"}


class ParserUnavailableError(RuntimeError):
    """The document needs a parser that is not installed in this image."""


class DocumentUnreadableError(ValueError):
    """The document is damaged, or is not the format its name says."""


def _converter() -> Any:
    """A docling `DocumentConverter`, reading PDF layout weights from `DOCLING_ARTIFACTS_PATH`.

    Without that path docling's defaults apply, which fetch the weights on first use. Raises
    `ParserUnavailableError` when docling is not installed.
    """
    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption
    except ImportError as problem:  # pragma: no cover - exercised only without the extra
        raise ParserUnavailableError(
            "docling is not installed; install the `parsers` extra to ingest this format"
        ) from problem
    if not DOCLING_ARTIFACTS_PATH:
        return DocumentConverter()
    # docling's own OCR stays off: a scanned document is read by `_ocr` (Tesseract, with the
    # Arabic pack). On, it is RapidOCR, whose weights the image does not prefetch, and docling
    # 2.137 refuses to build the PDF pipeline without them, so every PDF failed to ingest.
    pdf_options = PdfPipelineOptions(artifacts_path=DOCLING_ARTIFACTS_PATH, do_ocr=False)
    pdf_format = PdfFormatOption(pipeline_options=pdf_options)
    return DocumentConverter(format_options={InputFormat.PDF: pdf_format})


def parse(path: Path, ocr: bool = False) -> str:
    """Parse one document into the Markdown the chunker works on.

    Raises `ParserUnavailableError` for a format this image cannot parse, and
    `DocumentUnreadableError` for a file docling cannot open as the format its suffix names.
    """
    suffix = path.suffix.lower()
    if suffix in PLAIN_SUFFIXES:
        return path.read_text(encoding="utf-8", errors="replace")
    if suffix in IMAGE_SUFFIXES:
        return _ocr(path)
    if suffix == ".xls":
        return _xls(path)
    if suffix in SAVE_AS:
        raise ParserUnavailableError(
            f"{suffix} files cannot be read; save it as {SAVE_AS[suffix]} and attach it again"
        )
    if suffix not in DOCLING_SUFFIXES:
        raise ParserUnavailableError(f"{suffix or path.name} is not a format this platform parses")
    from docling.exceptions import ConversionError

    try:
        result = _converter().convert(str(path))
    except ConversionError as problem:
        raise DocumentUnreadableError(
            f"the file is damaged or is not a real {suffix} file"
        ) from problem
    markdown: str = result.document.export_to_markdown()
    if markdown.strip() or not ocr:
        return markdown
    return _ocr(path)


def _xls(path: Path) -> str:
    """An Office 97–2003 workbook as Markdown: a heading per sheet, a table row per row."""
    try:
        import xlrd
    except ImportError as problem:  # pragma: no cover - exercised only without the extra
        raise ParserUnavailableError(
            "reading .xls needs the `parsers` extra; install it to read this format"
        ) from problem
    try:
        # xlrd prints format warnings to stdout unless given a log of its own.
        book = xlrd.open_workbook(str(path), logfile=io.StringIO())
    except xlrd.XLRDError as problem:
        raise DocumentUnreadableError("the file is damaged or is not a real .xls file") from problem
    sections = []
    for sheet in book.sheets():
        rows = [
            "| " + " | ".join(_xls_cell(cell, book.datemode) for cell in sheet.row(index)) + " |"
            for index in range(sheet.nrows)
        ]
        sections.append(f"## {sheet.name}\n\n" + "\n".join(rows))
    return "\n\n".join(sections)


def _xls_cell(cell: Any, datemode: int) -> str:
    """One cell as a person reads it: whole numbers without `.0`, dates as ISO dates."""
    import xlrd

    if cell.ctype == xlrd.XL_CELL_DATE:
        moment: datetime = xlrd.xldate_as_datetime(cell.value, datemode)
        return moment.isoformat()
    if cell.ctype == xlrd.XL_CELL_NUMBER and float(cell.value).is_integer():
        return str(int(cell.value))
    return str(cell.value).replace("|", "\\|")


def _ocr(path: Path) -> str:
    """OCR a scanned document when the collection asks for it."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError as problem:  # pragma: no cover - exercised only without the extra
        raise ParserUnavailableError(
            "OCR needs the `parsers` extra and a Tesseract install with the ara and eng packs"
        ) from problem
    text: str = pytesseract.image_to_string(Image.open(path), lang="ara+eng")
    return text
