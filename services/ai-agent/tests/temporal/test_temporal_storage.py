"""Large Temporal payloads in the object store (D287).

A mission's model requests carry the whole conversation, so its history passed Temporal's
50 MB limit and the server terminated it (RUN-88182). These cases run a workflow on the
Temporal test server with the platform's converter: a large activity input round-trips,
stays out of the history, and reaches the bucket only encrypted.
"""

from __future__ import annotations

import uuid
from base64 import b64encode
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from botocore.exceptions import ClientError
from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import UnsandboxedWorkflowRunner, Worker

from awp_agent.clients import object_store
from awp_agent.temporal import codec as temporal_codec
from awp_agent.temporal import storage as temporal_storage
from awp_agent.worker import data_converter

SECRET = "harness-token-that-must-never-be-stored-in-clear"


class FakeS3:
    """The three boto3 calls the storage client makes, against a dict."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes) -> None:  # noqa: N803
        self.objects[(Bucket, Key)] = Body

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        data = self.objects[(Bucket, Key)]

        class Body:
            def read(self) -> bytes:
                return data

        return {"Body": Body()}


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeS3]:
    """Storage and encryption on, against an in-memory bucket."""
    from awp_agent.config import settings

    fake = FakeS3()
    monkeypatch.setenv("S3_ACCESS_KEY", "test-access")
    monkeypatch.setenv(
        temporal_codec.KEY_ENV, b64encode(b"0123456789abcdef0123456789abcdef").decode()
    )
    monkeypatch.delenv(temporal_codec.PREVIOUS_KEYS_ENV, raising=False)
    monkeypatch.setattr(object_store, "client", lambda: fake)
    settings.cache_clear()
    temporal_codec._key.cache_clear()
    temporal_codec._previous_keys.cache_clear()
    yield fake
    temporal_codec._key.cache_clear()
    temporal_codec._previous_keys.cache_clear()


@activity.defn(name="echo_length")
async def echo_length(text: str) -> int:
    return len(text)


@workflow.defn(name="LargeInput")
class LargeInput:
    @workflow.run
    async def run(self, text: str) -> int:
        return await workflow.execute_activity(
            echo_length, text, start_to_close_timeout=timedelta(seconds=10)
        )


async def test_a_large_payload_is_stored_encrypted_and_kept_out_of_the_history(
    temporal_env: WorkflowEnvironment, bucket: FakeS3
) -> None:
    client = Client(
        temporal_env.client.service_client,
        namespace=temporal_env.client.namespace,
        data_converter=data_converter(),
    )
    text = SECRET + "x" * (200 * 1024)
    queue = f"storage-{uuid.uuid4()}"
    async with Worker(
        client,
        task_queue=queue,
        workflows=[LargeInput],
        activities=[echo_length],
        workflow_runner=UnsandboxedWorkflowRunner(),
    ):
        handle = await client.start_workflow(
            LargeInput.run, text, id=f"storage-{uuid.uuid4()}", task_queue=queue
        )
        assert await handle.result() == len(text)

    # The input went to the bucket, and only as ciphertext.
    assert bucket.objects
    assert all(SECRET.encode() not in data for data in bucket.objects.values())
    # The history holds a reference, not the 200 KiB.
    history = await handle.fetch_history()
    assert history.to_json().count("x" * 1024) == 0
    assert len(history.to_json()) < 50 * 1024


def test_small_payloads_stay_inline_and_no_store_without_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from awp_agent.config import settings

    monkeypatch.delenv("S3_ACCESS_KEY", raising=False)
    settings.cache_clear()
    assert temporal_storage.external_storage() is None

    monkeypatch.setenv("S3_ACCESS_KEY", "test-access")
    settings.cache_clear()
    storage = temporal_storage.external_storage()
    assert storage is not None
    assert storage.payload_size_threshold == temporal_storage.THRESHOLD_BYTES


async def test_a_missing_object_is_absent_and_any_other_failure_is_raised() -> None:
    class Refusing(FakeS3):
        def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
            raise ClientError({"Error": {"Code": "403"}}, "HeadObject")

    assert not await temporal_storage.Boto3StorageClient(FakeS3()).object_exists(
        bucket="b", key="k"
    )
    with pytest.raises(ClientError):
        await temporal_storage.Boto3StorageClient(Refusing()).object_exists(bucket="b", key="k")
