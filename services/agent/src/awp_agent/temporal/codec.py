"""Encryption of everything the service puts into Temporal (D81).

A workflow's arguments, its activity inputs and its results are all stored in Temporal's
event history, in the clear, for as long as the retention window. The run payload carries
the run's own credentials — `actor.mcp_token` and `actor.harness_token` — so until now a
read of the history was a read of two bearer tokens, and the history outlives the tokens'
own 30-minute life only in the sense that it keeps them readable afterwards.

The fix is a payload codec rather than anything token-shaped. A codec sits under the data
converter and encrypts *every* payload, so there is one mechanism and nothing to remember:
a field added to `RunInput` next year is covered because it is a payload, not because
somebody noticed it was sensitive. Redacting the token fields instead would have left the
history readable for everything else and would have needed a second decision every time
the payload grew.

AES-GCM. `TEMPORAL_CODEC_KEY` encrypts; `TEMPORAL_CODEC_PREVIOUS_KEYS` (comma-separated) only
decrypts, so a rotated key still opens the history it wrote until that history has aged out of
the retention window (D204). Each payload names its key by fingerprint in its metadata.

**Operational consequence:** the Temporal Web UI shows ciphertext for this namespace's
payloads. Reading them back needs this codec — `temporal workflow show --codec-endpoint`
against a codec server, or the service's own tooling. That is the trade the encryption
buys, and it is the reason the decision is recorded rather than assumed.
"""

from __future__ import annotations

import hashlib
import os
from base64 import b64decode
from collections.abc import Sequence
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from temporalio.api.common.v1 import Payload
from temporalio.converter import PayloadCodec

#: What an encrypted payload's own encoding is called, so a decode can tell ours apart
#: from a payload written before the codec existed.
ENCODING = b"binary/encrypted"

#: AES-GCM's nonce, 96 bits, generated per payload. Never reused under one key.
NONCE_BYTES = 12

KEY_ENV = "TEMPORAL_CODEC_KEY"
PREVIOUS_KEYS_ENV = "TEMPORAL_CODEC_PREVIOUS_KEYS"


class CodecKeyError(RuntimeError):
    """Raised when encryption is on and no key is configured.

    Fail closed: a missing key must not quietly fall back to writing plaintext into a
    history that is retained for days.
    """


def key_id(key: bytes) -> bytes:
    """The id a payload carries for the key that sealed it: a fingerprint, not the key."""
    return b"awp-temporal-" + hashlib.sha256(key).hexdigest()[:16].encode()


def _decode_key(name: str, configured: str) -> bytes:
    """The AES key in a base64 setting; `CodecKeyError` unless it is 16, 24 or 32 bytes."""
    try:
        key = b64decode(configured, validate=True)
    except Exception as problem:
        raise CodecKeyError(f"{name} is not valid base64") from problem
    if len(key) not in (16, 24, 32):
        raise CodecKeyError(f"{name} decodes to {len(key)} bytes; AES needs 16, 24 or 32")
    return key


@lru_cache(maxsize=1)
def _key() -> bytes | None:
    """The AES key that encrypts, or None when the codec is off.

    Off is a deliberate state, not an accident: the `core` profile and the test suite run
    without Temporal secrets, and a codec that refused to load there would stop the
    service rather than protect anything. Encryption is on exactly when the key is set.
    """
    configured = os.environ.get(KEY_ENV, "").strip()
    return _decode_key(KEY_ENV, configured) if configured else None


@lru_cache(maxsize=1)
def _previous_keys() -> tuple[bytes, ...]:
    """Rotated keys, kept to decrypt what they wrote and never used to encrypt."""
    configured = os.environ.get(PREVIOUS_KEYS_ENV, "")
    return tuple(
        _decode_key(PREVIOUS_KEYS_ENV, part.strip())
        for part in configured.split(",")
        if part.strip()
    )


def enabled() -> bool:
    """True when payloads are encrypted. Reads the rotated keys too, so a mistyped one stops
    the service at start rather than at the first replay that needs it."""
    _previous_keys()
    return _key() is not None


class AesGcmCodec(PayloadCodec):
    """Encrypts every payload on the way out and decrypts ours on the way back."""

    async def encode(self, payloads: Sequence[Payload]) -> list[Payload]:
        """Seal each payload under the current key with a fresh nonce, tagged with its key id.

        With the codec off the payloads pass through unchanged.
        """
        key = _key()
        if key is None:
            return list(payloads)
        cipher = AESGCM(key)
        encoded: list[Payload] = []
        for payload in payloads:
            nonce = os.urandom(NONCE_BYTES)
            sealed = cipher.encrypt(nonce, payload.SerializeToString(), None)
            encoded.append(
                Payload(
                    metadata={"encoding": ENCODING, "key-id": key_id(key)},
                    data=nonce + sealed,
                )
            )
        return encoded

    async def decode(self, payloads: Sequence[Payload]) -> list[Payload]:
        """Open each encrypted payload with the current or a previous key; pass others through.

        Raises `CodecKeyError` for an encrypted payload when no key is configured or none
        opens it.
        """
        current = _key()
        keys = ((current,) if current is not None else ()) + _previous_keys()
        decoded: list[Payload] = []
        for payload in payloads:
            # A payload written before the codec was turned on carries its own encoding
            # and is passed through. Without this, enabling encryption would make every
            # workflow already in flight undecodable.
            if payload.metadata.get("encoding") != ENCODING:
                decoded.append(payload)
                continue
            if not keys:
                raise CodecKeyError(f"an encrypted payload needs {KEY_ENV}, which is not set")
            decoded.append(_open(payload, keys))
        return decoded


def _open(payload: Payload, keys: tuple[bytes, ...]) -> Payload:
    """Decrypt with the key the payload names, or, for a payload whose id names no configured
    key (one written before ids were fingerprints), with whichever key authenticates it."""
    named = payload.metadata.get("key-id")
    candidates = [key for key in keys if key_id(key) == named] or list(keys)
    nonce, sealed = payload.data[:NONCE_BYTES], payload.data[NONCE_BYTES:]
    for key in candidates:
        try:
            plain = AESGCM(key).decrypt(nonce, sealed, None)
        except InvalidTag:
            continue
        inner = Payload()
        inner.ParseFromString(plain)
        return inner
    raise CodecKeyError(
        f"no key in {KEY_ENV} or {PREVIOUS_KEYS_ENV} opens a payload sealed by {named!r}"
    )
