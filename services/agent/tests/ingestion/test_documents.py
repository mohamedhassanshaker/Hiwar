"""Reading one document, which is what lets an agent read an attached receipt."""

from __future__ import annotations

import base64
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from awp_agent.ingestion import parsing
from awp_agent.main import app


def test_a_plain_document_is_read_as_it_was_written(tmp_path: Path) -> None:
    document = tmp_path / "note.txt"
    document.write_text("Taxi fare 186.00 AED on 3 October", encoding="utf-8")

    assert parsing.parse(document) == "Taxi fare 186.00 AED on 3 October"


def test_an_image_goes_straight_to_recognition(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """UC-28.2-08: a photographed receipt has no text layer, so only OCR can read it."""
    seen: list[Path] = []

    def recognise(path: Path) -> str:
        seen.append(path)
        return "AED 186.00"

    monkeypatch.setattr(parsing, "_ocr", recognise)

    document = tmp_path / "receipt.jpg"
    document.write_bytes(b"not really a photograph")

    assert parsing.parse(document) == "AED 186.00"
    assert seen == [document]


def test_the_pdf_pipeline_reads_the_prefetched_models_with_docling_s_own_ocr_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """docling's RapidOCR needs weights the image does not prefetch; with it on, docling
    2.137 refused to build the pipeline and every PDF failed (owner, 2026-11-03)."""
    from docling.datamodel.base_models import InputFormat

    monkeypatch.setattr(parsing, "DOCLING_ARTIFACTS_PATH", str(tmp_path))

    options = parsing._converter().format_to_options[InputFormat.PDF].pipeline_options

    assert str(options.artifacts_path) == str(tmp_path)
    assert options.do_ocr is False


def test_a_format_the_image_cannot_parse_says_so(tmp_path: Path) -> None:
    document = tmp_path / "archive.zip"
    document.write_bytes(b"PK\x03\x04")

    with pytest.raises(parsing.ParserUnavailableError):
        parsing.parse(document)


def _record(opcode: int, data: bytes) -> bytes:
    return struct.pack("<HH", opcode, len(data)) + data


def legacy_workbook() -> bytes:
    """The smallest Office 97–2003 workbook xlrd reads: a BIFF2 sheet of a label and numbers."""
    label = b"Refund"
    return (
        _record(0x0009, struct.pack("<HH", 2, 0x10))
        + _record(0x0000, struct.pack("<HHHH", 0, 2, 0, 2))
        + _record(0x0004, struct.pack("<HH3sB", 0, 0, b"\0\0\0", len(label)) + label)
        + _record(0x0003, struct.pack("<HH3sd", 0, 1, b"\0\0\0", 186.0))
        + _record(0x0003, struct.pack("<HH3sd", 1, 1, b"\0\0\0", 2.5))
        + _record(0x000A, b"")
    )


def test_a_legacy_excel_workbook_is_read_row_by_row(tmp_path: Path) -> None:
    """ADR-0002: an .xls attachment is read, whole numbers without a trailing `.0`."""
    document = tmp_path / "claims.xls"
    document.write_bytes(legacy_workbook())

    assert parsing.parse(document) == "## Sheet 1\n\n| Refund | 186 |\n|  | 2.5 |"


def test_a_legacy_workbook_date_reads_as_a_date_and_a_bar_does_not_split_the_row() -> None:
    import xlrd

    assert (
        parsing._xls_cell(xlrd.sheet.Cell(xlrd.XL_CELL_DATE, 45000.0), 0) == "2023-03-15T00:00:00"
    )
    assert parsing._xls_cell(xlrd.sheet.Cell(xlrd.XL_CELL_TEXT, "A|B"), 0) == "A\\|B"


def test_a_damaged_legacy_workbook_is_unreadable(tmp_path: Path) -> None:
    document = tmp_path / "claims.xls"
    document.write_bytes(b"this is not a spreadsheet")

    with pytest.raises(parsing.DocumentUnreadableError, match=r"not a real \.xls"):
        parsing.parse(document)


def test_a_legacy_presentation_is_refused_with_the_format_to_save_it_as(tmp_path: Path) -> None:
    document = tmp_path / "deck.ppt"
    document.write_bytes(b"\xd0\xcf\x11\xe0")

    with pytest.raises(parsing.ParserUnavailableError, match=r"save it as \.pptx"):
        parsing.parse(document)


def test_the_endpoint_returns_the_text_of_what_was_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parsing, "_ocr", lambda path: "Taxi  AED 186.00  3 Oct 2026")

    answer = TestClient(app).post(
        "/documents/extract",
        json={
            "filename": "receipt.jpg",
            "content_base64": base64.b64encode(b"bytes of a photograph").decode(),
        },
    )

    assert answer.status_code == 200
    assert answer.json() == {"text": "Taxi  AED 186.00  3 Oct 2026"}


def test_a_format_nothing_can_read_is_refused_rather_than_returned_empty() -> None:
    answer = TestClient(app).post(
        "/documents/extract",
        json={"filename": "song.mp3", "content_base64": base64.b64encode(b"ID3").decode()},
    )

    assert answer.status_code == 422
    assert "parses" in answer.json()["detail"]


def test_a_damaged_document_is_unreadable_rather_than_a_server_error(tmp_path: Path) -> None:
    """UC-28.2-08: a file that is not what its name says is refused, not a server error."""
    document = tmp_path / "claims.xlsx"
    document.write_bytes(b"this is not a spreadsheet")

    with pytest.raises(parsing.DocumentUnreadableError, match=r"damaged or is not a real \.xlsx"):
        parsing.parse(document)


def test_the_endpoint_refuses_a_damaged_document_as_unprocessable() -> None:
    answer = TestClient(app).post(
        "/documents/extract",
        json={
            "filename": "Q3 claims.docx",
            "content_base64": base64.b64encode(b"this is not a document").decode(),
        },
    )

    assert answer.status_code == 422
    assert "Q3 claims.docx" in answer.json()["detail"]


def test_content_that_is_not_base64_is_refused() -> None:
    answer = TestClient(app).post(
        "/documents/extract",
        json={"filename": "receipt.jpg", "content_base64": "not base64 at all!!"},
    )

    assert answer.status_code == 400
