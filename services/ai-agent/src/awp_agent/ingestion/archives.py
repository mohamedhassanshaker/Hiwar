"""Reading the documents inside a `.zip` attachment, one section per file.

The archive is never unpacked by its own member names: each member's bytes go to a fresh file
named only by its index and suffix, so a member called `../../x` writes nowhere but the
temporary directory. The limits count the bytes actually read, not the sizes the archive
declares, which a zip bomb can fake.
"""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from awp_agent.ingestion import parsing

MAX_MEMBERS = 50
MAX_MEMBER_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024


def read_archive(path: Path) -> str:
    """The text of every file in a zip, each under its own heading.

    A file that cannot be read gets its heading and the reason, so the reader knows it was
    there. Raises `parsing.DocumentUnreadableError` when the zip itself is damaged, holds more
    than `MAX_MEMBERS` files, or its contents read past `MAX_TOTAL_BYTES`.
    """
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as problem:
        raise parsing.DocumentUnreadableError(
            "the file is damaged or is not a real .zip file"
        ) from problem
    with archive, tempfile.TemporaryDirectory() as directory:
        members = [info for info in archive.infolist() if not info.is_dir()]
        if len(members) > MAX_MEMBERS:
            raise parsing.DocumentUnreadableError(
                f"it holds {len(members)} files; at most {MAX_MEMBERS} are read"
            )
        budget = [MAX_TOTAL_BYTES]
        texts = [
            _member_text(archive, info, Path(directory) / str(index), budget)
            for index, info in enumerate(members)
        ]
    sections = [f"## {info.filename}\n\n{text}" for info, text in zip(members, texts, strict=True)]
    return "\n\n".join(sections)


def _member_text(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo, stem: Path, budget: list[int]
) -> str:
    """One member's text, or why it was not read. `budget` holds the bytes still allowed."""
    suffix = PurePosixPath(info.filename).suffix.lower()
    if suffix == ".zip":
        return "(not read: an archive inside an archive is not opened)"
    try:
        with archive.open(info) as member:
            content = member.read(MAX_MEMBER_BYTES + 1)
    except RuntimeError:
        return "(not read: it is encrypted)"
    except (zipfile.BadZipFile, OSError):
        return "(not read: it is damaged)"
    if len(content) > MAX_MEMBER_BYTES:
        return f"(not read: it is over {MAX_MEMBER_BYTES // (1024 * 1024)} MB)"
    budget[0] -= len(content)
    if budget[0] < 0:
        raise parsing.DocumentUnreadableError(
            f"its contents are over {MAX_TOTAL_BYTES // (1024 * 1024)} MB"
        )
    document = stem.with_suffix(suffix)
    document.write_bytes(content)
    try:
        return parsing.parse(document, ocr=True)
    except (parsing.ParserUnavailableError, parsing.DocumentUnreadableError) as problem:
        return f"(not read: {problem})"
