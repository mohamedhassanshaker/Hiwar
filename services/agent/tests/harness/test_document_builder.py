"""Rendering structured content into a real docx, xlsx, pptx or pdf file."""

from __future__ import annotations

import base64
from io import BytesIO

import pytest

from awp_agent.harness.tools.document_builder import DocumentFormatError, render

SECTIONS = [
    {"heading": "Policy", "level": 1, "paragraph": "Claims are paid within ten days."},
    {"bullets": ["First point", "Second point"]},
    {"table": {"headers": ["Item", "Amount"], "rows": [["Taxi", "45"], ["Hotel", "900"]]}},
]


def _bytes_of(result: dict[str, object]) -> bytes:
    return base64.b64decode(str(result["content_base64"]))


def test_an_unknown_format_is_refused() -> None:
    with pytest.raises(DocumentFormatError):
        render({"format": "txt", "title": "Nope"})


def test_a_docx_carries_the_heading_paragraph_bullets_and_table() -> None:
    result = render({"format": "docx", "title": "Expense Policy", "sections": SECTIONS})

    assert result["mime_type"].endswith("wordprocessingml.document")
    assert result["file_name"] == "expense-policy.docx"
    assert result["size"] > 0

    from docx import Document

    document = Document(BytesIO(_bytes_of(result)))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "Expense Policy" in text
    assert "Claims are paid within ten days." in text
    assert "First point" in text
    assert len(document.tables) == 1
    assert document.tables[0].cell(0, 0).text == "Item"
    assert document.tables[0].cell(1, 1).text == "45"


def test_an_xlsx_carries_its_sheets_headers_and_rows() -> None:
    result = render(
        {
            "format": "xlsx",
            "title": "Expense report",
            "sheets": [
                {
                    "name": "Q1",
                    "headers": ["Item", "Amount"],
                    "rows": [["Taxi", 45], ["Hotel", 900]],
                },
                {"name": "Q2", "headers": ["Item", "Amount"], "rows": [["Flight", 1200]]},
            ],
        }
    )

    assert result["mime_type"].endswith("spreadsheetml.sheet")

    from openpyxl import load_workbook

    workbook = load_workbook(BytesIO(_bytes_of(result)))
    assert workbook.sheetnames == ["Q1", "Q2"]
    assert [cell.value for cell in workbook["Q1"][1]] == ["Item", "Amount"]
    assert [cell.value for cell in workbook["Q1"][2]] == ["Taxi", "45"]
    assert [cell.value for cell in workbook["Q2"][2]] == ["Flight", "1200"]


def test_a_pptx_carries_a_title_slide_and_one_slide_per_entry() -> None:
    result = render(
        {
            "format": "pptx",
            "title": "Q1 Review",
            "slides": [
                {"title": "Highlights", "bullets": ["Revenue up", "Costs flat"]},
                {"title": "Risks", "bullets": ["Supplier delay"]},
            ],
        }
    )

    assert result["mime_type"].endswith("presentationml.presentation")

    from pptx import Presentation

    presentation = Presentation(BytesIO(_bytes_of(result)))
    assert len(presentation.slides) == 3
    assert presentation.slides[0].shapes.title.text == "Q1 Review"
    assert presentation.slides[1].shapes.title.text == "Highlights"


def test_a_pdf_is_a_real_pdf_with_the_title_and_table_text() -> None:
    result = render({"format": "pdf", "title": "Expense Policy", "sections": SECTIONS})

    assert result["mime_type"] == "application/pdf"
    data = _bytes_of(result)
    assert data.startswith(b"%PDF-")

    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "Expense Policy" in text
    assert "Claims are paid within ten days" in text
    assert "Item" in text


def test_a_title_with_no_safe_characters_still_gets_a_file_name() -> None:
    result = render({"format": "pdf", "title": "!!!"})
    assert result["file_name"] == "document.pdf"
