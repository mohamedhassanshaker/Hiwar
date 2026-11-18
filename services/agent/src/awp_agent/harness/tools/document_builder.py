"""Render structured content into a real Word, Excel, PowerPoint or PDF file.

`render` is a pure function: it renders bytes and returns them, base64-encoded. The runtime's
`generate_document` saves them through `artifact_create` on the run's token (D131); this
module never writes to the platform itself.

Arabic is laid out right to left (D152): a sheet, paragraph, cell or slide paragraph whose
letters are mostly Arabic is marked RTL, and the PDF shapes and reorders Arabic with
`arabic-reshaper` and `python-bidi` in a font that has the glyphs, because reportlab's
built-in fonts have none and it does no bidi layout of its own.

The libraries are lazily imported, the same way `ingestion/parsing.py` reaches for docling:
they live in the `parsers` extra, which a plain developer checkout need not install.
"""

from __future__ import annotations

import base64
import re
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

MIME_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf",
}


class DocumentFormatError(ValueError):
    """The requested format is not one this tool renders."""


class DocumentUnavailableError(RuntimeError):
    """The format needs a library that is not installed in this image."""


_ARABIC = re.compile(r"[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]")
_LATIN = re.compile(r"[A-Za-z]")

#: Fonts with Arabic glyphs, in the order they are tried: the image's, then a developer's.
_ARABIC_FONTS = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
)


def _is_rtl(*texts: str) -> bool:
    """Whether the text's letters are mostly Arabic, which is when it reads right to left."""
    joined = " ".join(texts)
    arabic = len(_ARABIC.findall(joined))
    return arabic > 0 and arabic >= len(_LATIN.findall(joined))


def _slug(title: str) -> str:
    cleaned = "".join(character if character.isalnum() else "-" for character in title.lower())
    collapsed = "-".join(part for part in cleaned.split("-") if part)
    return collapsed[:80] or "document"


def _docx_bytes(title: str, sections: list[dict[str, Any]]) -> bytes:
    """A Word document: the title, then each section's heading, paragraph, bullets and table.

    Raises `DocumentUnavailableError` when python-docx is not installed.
    """
    try:
        from docx import Document
    except ImportError as problem:
        raise DocumentUnavailableError(
            "python-docx is not installed; install the `parsers` extra to render docx"
        ) from problem

    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement

    def directed(paragraph: Any) -> Any:
        """Mark an Arabic paragraph and its runs right to left (`w:bidi`, `w:rtl`)."""
        if _is_rtl(paragraph.text):
            paragraph.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            paragraph._p.get_or_add_pPr().append(OxmlElement("w:bidi"))
            for run in paragraph.runs:
                run._r.get_or_add_rPr().append(OxmlElement("w:rtl"))
        return paragraph

    document = Document()
    directed(document.add_heading(title, level=0))
    for section in sections:
        if section.get("heading"):
            level = int(section.get("level", 1))
            directed(document.add_heading(str(section["heading"]), level=level))
        if section.get("paragraph"):
            directed(document.add_paragraph(str(section["paragraph"])))
        for bullet in section.get("bullets") or []:
            directed(document.add_paragraph(str(bullet), style="List Bullet"))
        table = section.get("table")
        if table:
            headers = [str(header) for header in table.get("headers", [])]
            grid = document.add_table(rows=1, cols=max(len(headers), 1))
            grid.style = "Light Grid Accent 1"
            for cell, header in zip(grid.rows[0].cells, headers, strict=False):
                cell.text = header
                directed(cell.paragraphs[0])
            for row in table.get("rows", []):
                cells = grid.add_row().cells
                for cell, value in zip(cells, row, strict=False):
                    cell.text = str(value)
                    directed(cell.paragraphs[0])
    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _xlsx_bytes(title: str, sheets: list[dict[str, Any]]) -> bytes:
    """A workbook with one worksheet per sheet, its headers then its rows, all as text.

    With no sheets it holds one empty sheet named after the title. Sheet names are cut to
    Excel's 31 characters. Raises `DocumentUnavailableError` when openpyxl is not installed.
    """
    try:
        from openpyxl import Workbook
    except ImportError as problem:
        raise DocumentUnavailableError(
            "openpyxl is not installed; install the `parsers` extra to render xlsx"
        ) from problem

    workbook = Workbook()
    entries = sheets or [{"name": title, "headers": [], "rows": []}]
    first = workbook.active
    for index, sheet in enumerate(entries):
        worksheet = first if index == 0 else workbook.create_sheet()
        worksheet.title = str(sheet.get("name") or f"Sheet{index + 1}")[:31]
        headers = [str(header) for header in sheet.get("headers", [])]
        rows = [[str(value) for value in row] for row in sheet.get("rows", [])]
        if headers:
            worksheet.append(headers)
        for row in rows:
            worksheet.append(row)
        # A sheet that is mostly Arabic opens right to left, column A on the right.
        worksheet.sheet_view.rightToLeft = _is_rtl(
            worksheet.title, *headers, *(value for row in rows for value in row)
        )
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _pptx_bytes(title: str, slides: list[dict[str, Any]]) -> bytes:
    """A deck: a title slide, then one title-and-bullets slide per entry, in the default theme.

    Raises `DocumentUnavailableError` when python-pptx is not installed.
    """
    try:
        from pptx import Presentation
    except ImportError as problem:
        raise DocumentUnavailableError(
            "python-pptx is not installed; install the `parsers` extra to render pptx"
        ) from problem

    from pptx.enum.text import PP_ALIGN

    def directed(frame: Any) -> None:
        """Mark each Arabic paragraph of a text frame right to left."""
        for paragraph in frame.paragraphs:
            if _is_rtl(paragraph.text):
                paragraph.alignment = PP_ALIGN.RIGHT
                paragraph._p.get_or_add_pPr().set("rtl", "1")

    presentation = Presentation()
    title_slide = presentation.slides.add_slide(presentation.slide_layouts[0])
    title_slide.shapes.title.text = title
    directed(title_slide.shapes.title.text_frame)

    bullet_layout = presentation.slide_layouts[1]
    for slide_content in slides:
        slide = presentation.slides.add_slide(bullet_layout)
        slide.shapes.title.text = str(slide_content.get("title", ""))
        directed(slide.shapes.title.text_frame)
        bullets = slide_content.get("bullets") or []
        if bullets:
            body = slide.placeholders[1].text_frame
            body.text = str(bullets[0])
            for bullet in bullets[1:]:
                body.add_paragraph().text = str(bullet)
            directed(body)
    buffer = BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def _pdf_bytes(title: str, sections: list[dict[str, Any]]) -> bytes:
    """An A4 PDF with the same section structure as the Word document.

    When any text holds Arabic the whole document is set in the first font of `_ARABIC_FONTS`
    found on disk. Raises `DocumentUnavailableError` when reportlab is not installed, or when
    the text holds Arabic and no such font exists.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import (
            ListFlowable,
            ListItem,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError as problem:
        raise DocumentUnavailableError(
            "reportlab is not installed; install the `parsers` extra to render pdf"
        ) from problem

    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    styles = getSampleStyleSheet()
    texts = [title]
    for section in sections:
        table_of = section.get("table") or {}
        texts += [str(section.get("heading") or ""), str(section.get("paragraph") or "")]
        texts += [str(value) for value in section.get("bullets") or []]
        texts += [str(value) for value in table_of.get("headers") or []]
        texts += [str(value) for row in table_of.get("rows") or [] for value in row]
    arabic = any(_ARABIC.search(value) for value in texts)
    font = "Helvetica"
    if arabic:
        # Helvetica has no Arabic glyphs: every letter would print as a box.
        path = next((found for found in _ARABIC_FONTS if Path(found).exists()), None)
        if path is None:
            raise DocumentUnavailableError("no font with Arabic glyphs is installed for this pdf")
        if "AWPArabic" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("AWPArabic", path))
        font = "AWPArabic"

    def markup(value: str) -> str:
        """Paragraph markup for one string: escaped, and shaped and reordered when Arabic."""
        if arabic and _ARABIC.search(value):
            from arabic_reshaper import reshape
            from bidi.algorithm import get_display

            value = str(get_display(reshape(value)))
        return escape(value)

    def paragraph(value: str, name: str) -> Any:
        """A `Paragraph` in style `name`, in the Arabic font and right-aligned when RTL."""
        base = styles[name]
        if not arabic:
            return Paragraph(markup(value), base)
        rtl = _is_rtl(value)
        style = ParagraphStyle(
            f"{name}-{'rtl' if rtl else 'ltr'}",
            parent=base,
            fontName=font,
            alignment=TA_RIGHT if rtl else base.alignment,
        )
        return Paragraph(markup(value), style)

    heading_style = {1: "Heading1", 2: "Heading2", 3: "Heading3"}
    buffer = BytesIO()
    story: list[Any] = [paragraph(title, "Title"), Spacer(1, 12)]

    for section in sections:
        if section.get("heading"):
            level = int(section.get("level", 1))
            story.append(paragraph(str(section["heading"]), heading_style.get(level, "Heading1")))
        if section.get("paragraph"):
            story.append(paragraph(str(section["paragraph"]), "BodyText"))
        bullets = section.get("bullets") or []
        if bullets:
            story.append(
                ListFlowable(
                    [ListItem(paragraph(str(bullet), "BodyText")) for bullet in bullets],
                    bulletType="bullet",
                )
            )
        table = section.get("table")
        if table:
            headers = [str(header) for header in table.get("headers", [])]
            rows = [[str(value) for value in row] for row in table.get("rows", [])]
            data = [
                [paragraph(value, "BodyText") for value in row]
                for row in ([headers] if headers else []) + rows
            ]
            if data:
                grid = Table(data)
                grid.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
                            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                        ]
                    )
                )
                story.append(grid)
        story.append(Spacer(1, 10))

    SimpleDocTemplate(buffer, pagesize=A4).build(story)
    return buffer.getvalue()


def render(arguments: dict[str, Any]) -> dict[str, Any]:
    """Render one document and return its file name, MIME type, size and base64 bytes."""
    fmt = str(arguments.get("format", "")).lower()
    title = str(arguments.get("title") or "Untitled")
    if fmt not in MIME_TYPES:
        allowed = sorted(MIME_TYPES)
        raise DocumentFormatError(f"{fmt!r} is not a format this tool renders: {allowed}")

    if fmt == "docx":
        data = _docx_bytes(title, arguments.get("sections") or [])
    elif fmt == "xlsx":
        data = _xlsx_bytes(title, arguments.get("sheets") or [])
    elif fmt == "pptx":
        data = _pptx_bytes(title, arguments.get("slides") or [])
    else:
        data = _pdf_bytes(title, arguments.get("sections") or [])

    return {
        "file_name": f"{_slug(title)}.{fmt}",
        "mime_type": MIME_TYPES[fmt],
        "content_base64": base64.b64encode(data).decode("ascii"),
        "size": len(data),
    }
