"""Payload encryption into Temporal's history (D81).

The run payload carries the run's own bearer tokens, and Temporal keeps workflow
arguments in its event history for the whole retention window. These cases go at the
codec directly: what it writes, what it refuses, and what a reader of the history would
actually see.
"""

from __future__ import annotations

from base64 import b64encode
from collections.abc import Iterator

import pytest
from temporalio.api.common.v1 import Payload

from awp_agent.temporal import codec as temporal_codec
from awp_agent.temporal.codec import AesGcmCodec, CodecKeyError

OLD_KEY = b"0123456789abcdef0123456789abcdef"
NEW_KEY = b"fedcba9876543210fedcba9876543210"


def _clear() -> None:
    temporal_codec._key.cache_clear()
    temporal_codec._previous_keys.cache_clear()


def _configure(
    monkeypatch: pytest.MonkeyPatch, current: bytes | None, previous: list[bytes] | None = None
) -> None:
    if current is None:
        monkeypatch.delenv(temporal_codec.KEY_ENV, raising=False)
    else:
        monkeypatch.setenv(temporal_codec.KEY_ENV, b64encode(current).decode())
    if previous is None:
        monkeypatch.delenv(temporal_codec.PREVIOUS_KEYS_ENV, raising=False)
    else:
        monkeypatch.setenv(
            temporal_codec.PREVIOUS_KEYS_ENV, ",".join(b64encode(k).decode() for k in previous)
        )
    _clear()


@pytest.fixture
def key(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """Turn the codec on with a known key, and clear the cached one afterwards."""
    _configure(monkeypatch, OLD_KEY)
    yield b64encode(OLD_KEY).decode()
    _clear()


@pytest.fixture
def no_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    _configure(monkeypatch, None)
    yield
    _clear()


def _payload(body: bytes) -> Payload:
    return Payload(metadata={"encoding": b"json/plain"}, data=body)


async def test_a_payload_comes_back_exactly_as_it_went_in(key: str) -> None:
    codec = AesGcmCodec()
    original = _payload(b'{"actor":{"mcp_token":"eyJhbGciOi"}}')

    [sealed] = await codec.encode([original])
    [opened] = await codec.decode([sealed])

    assert opened.data == original.data
    assert opened.metadata["encoding"] == b"json/plain"


async def test_the_token_is_not_readable_in_what_temporal_stores(key: str) -> None:
    """The point of the whole exercise: a read of the history is not a read of the token."""
    codec = AesGcmCodec()
    token = b"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-run-token"

    [sealed] = await codec.encode([_payload(b'{"mcp_token":"' + token + b'"}')])

    assert token not in sealed.data
    assert b"mcp_token" not in sealed.data
    assert sealed.metadata["encoding"] == temporal_codec.ENCODING
    assert sealed.metadata["key-id"] == temporal_codec.key_id(OLD_KEY)
    assert OLD_KEY not in sealed.metadata["key-id"]


async def test_two_encryptions_of_one_payload_differ(key: str) -> None:
    """A fresh nonce each time. Identical ciphertext would leak that two runs carried the
    same payload, and reusing a nonce under one key breaks AES-GCM outright."""
    codec = AesGcmCodec()
    original = _payload(b'{"same":"payload"}')

    [first] = await codec.encode([original])
    [second] = await codec.encode([original])

    assert first.data != second.data
    assert (await codec.decode([first]))[0].data == (await codec.decode([second]))[0].data


async def test_a_payload_written_before_encryption_still_opens(key: str) -> None:
    """Turning the codec on must not make the workflows already in flight undecodable."""
    codec = AesGcmCodec()
    plain = _payload(b'{"written":"before"}')

    [opened] = await codec.decode([plain])

    assert opened.data == plain.data


async def test_without_a_key_nothing_is_encrypted_and_nothing_breaks(no_key: None) -> None:
    """The `core` profile and the test suite run without Temporal secrets. A codec that
    refused to load there would stop the service rather than protect anything."""
    codec = AesGcmCodec()
    plain = _payload(b'{"plain":"text"}')

    [passed] = await codec.encode([plain])

    assert passed.data == plain.data
    assert temporal_codec.enabled() is False


async def test_an_encrypted_payload_without_the_key_is_refused_not_skipped(
    key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fail closed. Returning the ciphertext as if it were the payload would hand the
    workflow bytes it cannot parse, and the failure would surface somewhere unrelated."""
    codec = AesGcmCodec()
    [sealed] = await codec.encode([_payload(b'{"a":1}')])

    _configure(monkeypatch, None)

    with pytest.raises(CodecKeyError):
        await codec.decode([sealed])


async def test_a_key_that_is_not_a_key_is_rejected_at_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A mistyped key must stop the service, not silently disable encryption."""
    monkeypatch.setenv(temporal_codec.KEY_ENV, "not base64 at all!!")
    _clear()
    with pytest.raises(CodecKeyError):
        temporal_codec.enabled()

    # Valid base64, wrong length: AES takes 16, 24 or 32 bytes and nothing else.
    monkeypatch.setenv(temporal_codec.KEY_ENV, b64encode(b"too short").decode())
    _clear()
    with pytest.raises(CodecKeyError):
        temporal_codec.enabled()

    # A mistyped rotated key stops the service too, rather than the first replay needing it.
    _configure(monkeypatch, NEW_KEY)
    monkeypatch.setenv(temporal_codec.PREVIOUS_KEYS_ENV, "not base64 at all!!")
    with pytest.raises(CodecKeyError):
        temporal_codec.enabled()

    _clear()


async def test_after_a_rotation_the_old_history_opens_and_new_payloads_use_the_new_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D204: a mission in flight across the rotation replays history the old key sealed."""
    codec = AesGcmCodec()
    _configure(monkeypatch, OLD_KEY)
    [before] = await codec.encode([_payload(b'{"written":"before"}')])

    _configure(monkeypatch, NEW_KEY, [OLD_KEY])
    [after] = await codec.encode([_payload(b'{"written":"after"}')])

    assert (await codec.decode([before]))[0].data == b'{"written":"before"}'
    assert (await codec.decode([after]))[0].data == b'{"written":"after"}'
    assert after.metadata["key-id"] == temporal_codec.key_id(NEW_KEY)

    # Once the old key is dropped, what it sealed no longer opens, and says why.
    _configure(monkeypatch, NEW_KEY)
    with pytest.raises(CodecKeyError, match="opens a payload"):
        await codec.decode([before])
    _clear()


async def test_a_payload_sealed_under_the_fixed_v1_id_opens_with_the_key_that_wrote_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """History written before ids were fingerprints carries `awp-temporal-v1`."""
    codec = AesGcmCodec()
    _configure(monkeypatch, OLD_KEY)
    [sealed] = await codec.encode([_payload(b'{"legacy":1}')])
    legacy = Payload(
        metadata={"encoding": temporal_codec.ENCODING, "key-id": b"awp-temporal-v1"},
        data=sealed.data,
    )

    _configure(monkeypatch, NEW_KEY, [OLD_KEY])
    assert (await codec.decode([legacy]))[0].data == b'{"legacy":1}'
    _clear()
