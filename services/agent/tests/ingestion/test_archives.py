"""Reading the documents inside a zip the assistant panel was given."""

from __future__ import annotations

import base64
import io
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from awp_agent.ingestion import archives, parsing
from awp_agent.main import app

from .test_documents import legacy_workbook


def _zip(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_every_file_in_a_zip_is_read_under_its_own_name(tmp_path: Path) -> None:
    path = tmp_path / "claims.zip"
    path.write_bytes(
        _zip(
            {
                "notes/brief.txt": b"Refund R-17",
                "order.json": b'{"id": 17}',
                "q3.xls": legacy_workbook(),
            }
        )
    )

    assert archives.read_archive(path) == (
        "## notes/brief.txt\n\nRefund R-17\n\n"
        '## order.json\n\n{"id": 17}\n\n'
        "## q3.xls\n\n## Sheet 1\n\n| Refund | 186 |\n|  | 2.5 |"
    )


def test_a_file_the_platform_cannot_read_is_named_with_the_reason(tmp_path: Path) -> None:
    path = tmp_path / "mixed.zip"
    path.write_bytes(_zip({"tool.exe": b"MZ", "inner.zip": _zip({"a.txt": b"a"})}))

    text = archives.read_archive(path)

    assert "## tool.exe\n\n(not read: .exe is not a format this platform parses)" in text
    assert "## inner.zip\n\n(not read: an archive inside an archive is not opened)" in text


def test_a_member_name_cannot_write_outside_the_temporary_directory(tmp_path: Path) -> None:
    """A member called `../x.txt` is read, and nothing lands beside the zip."""
    path = tmp_path / "travel.zip"
    path.write_bytes(_zip({"../escaped.txt": b"inside"}))

    assert archives.read_archive(path) == "## ../escaped.txt\n\ninside"
    assert not (tmp_path.parent / "escaped.txt").exists()


def test_a_zip_with_too_many_files_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(archives, "MAX_MEMBERS", 2)
    path = tmp_path / "many.zip"
    path.write_bytes(_zip({f"{index}.txt": b"x" for index in range(3)}))

    with pytest.raises(parsing.DocumentUnreadableError, match="holds 3 files; at most 2"):
        archives.read_archive(path)


def test_a_zip_bomb_stops_at_the_bytes_read_not_the_sizes_declared(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(archives, "MAX_TOTAL_BYTES", 1500)
    path = tmp_path / "bomb.zip"
    path.write_bytes(_zip({"a.txt": b"0" * 1000, "b.txt": b"0" * 1000}))

    with pytest.raises(parsing.DocumentUnreadableError, match="contents are over"):
        archives.read_archive(path)


def test_a_damaged_zip_is_unreadable(tmp_path: Path) -> None:
    path = tmp_path / "broken.zip"
    path.write_bytes(b"PK\x03\x04")

    with pytest.raises(parsing.DocumentUnreadableError, match=r"not a real \.zip"):
        archives.read_archive(path)


def test_the_endpoint_reads_a_zip_and_refuses_a_damaged_one() -> None:
    client = TestClient(app)
    content = base64.b64encode(_zip({"a.txt": b"Refund R-17"})).decode()

    read = client.post("/documents/extract", json={"filename": "a.ZIP", "content_base64": content})
    broken = client.post(
        "/documents/extract",
        json={"filename": "b.zip", "content_base64": base64.b64encode(b"PK").decode()},
    )

    assert read.json() == {"text": "## a.txt\n\nRefund R-17"}
    assert broken.status_code == 422
    assert "b.zip could not be read" in broken.json()["detail"]
