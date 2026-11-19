"""Arabic in a generated document reads right to left and keeps its letters (D152)."""

from __future__ import annotations

import base64
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any, cast

import pytest

from awp_agent.harness.tools.document_builder import _ARABIC_FONTS, render

TITLE = "قائمة مزايا منصة تحصيل"
SECTION = {
    "heading": "الطلبات",
    "paragraph": "يقدّم الموظفون الطلبات ويتابعونها حتى الإغلاق.",
    "table": {"headers": ["الميزة", "الوصف"], "rows": [["الغرف", "نقاش مع الوكلاء"]]},
}


def _bytes_of(result: dict[str, object]) -> bytes:
    return base64.b64decode(str(result["content_base64"]))


def test_an_arabic_sheet_opens_right_to_left_and_an_english_one_does_not() -> None:
    from openpyxl import load_workbook

    result = render(
        {
            "format": "xlsx",
            "title": TITLE,
            "sheets": [
                {"name": "المزايا", "headers": ["الميزة", "الوصف"], "rows": [["الغرف", "نقاش"]]},
                {
                    "name": "Features",
                    "headers": ["Feature", "Description"],
                    "rows": [["Rooms", "Talk"]],
                },
            ],
        }
    )
    workbook = load_workbook(BytesIO(_bytes_of(result)))
    arabic, english = workbook["المزايا"], workbook["Features"]
    assert arabic.sheet_view.rightToLeft is True
    assert not english.sheet_view.rightToLeft
    assert [cell.value for cell in arabic[2]] == ["الغرف", "نقاش"]


def test_an_arabic_docx_paragraph_and_table_cell_are_bidi() -> None:
    result = render({"format": "docx", "title": TITLE, "sections": [SECTION]})
    xml = zipfile.ZipFile(BytesIO(_bytes_of(result))).read("word/document.xml").decode("utf8")
    assert TITLE in xml
    assert "الغرف" in xml
    # Title, heading, paragraph and three table cells: every Arabic paragraph is marked.
    assert xml.count("<w:bidi/>") >= 6
    assert "<w:rtl/>" in xml


def test_an_arabic_pptx_paragraph_is_rtl() -> None:
    result = render(
        {"format": "pptx", "title": TITLE, "slides": [{"title": "الغرف", "bullets": ["نقاش"]}]}
    )
    archive = zipfile.ZipFile(BytesIO(_bytes_of(result)))
    slide = archive.read("ppt/slides/slide2.xml").decode("utf8")
    assert 'rtl="1"' in slide
    assert "الغرف" in slide


@pytest.mark.skipif(
    not any(Path(path).exists() for path in _ARABIC_FONTS),
    reason="no font with Arabic glyphs on this host",
)
def test_an_arabic_pdf_embeds_a_font_with_arabic_glyphs() -> None:
    from pypdf import PdfReader

    result = render({"format": "pdf", "title": TITLE, "sections": [SECTION]})
    reader = PdfReader(BytesIO(_bytes_of(result)))
    fonts = {
        str(cast(dict[str, object], font.get_object())["/BaseFont"])
        for page in reader.pages
        for font in cast(dict[str, Any], cast(dict[str, Any], page["/Resources"])["/Font"]).values()
    }
    # Helvetica alone would draw every Arabic letter as a box.
    assert any("Helvetica" not in font for font in fonts), fonts
    assert len(reader.pages[0].extract_text().strip()) > 0
