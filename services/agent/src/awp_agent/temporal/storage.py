"""Large Temporal payloads kept in the object store, with a reference in the history (D287).

Every model request a mission makes is an activity whose input is the whole conversation so
far, the instructions and the tool list, so a mission's history grows with the square of its
steps. Temporal terminates a workflow whose history passes 50 MB, and a terminated workflow
runs no more code: RUN-88182 reached 53 MB after 53 model requests, its panel stream ended in
an error and its run row was never finished.

The SDK's own external storage (`temporalio` 1.34, experimental) stores a payload above the
threshold in S3 and writes a reference into the history instead. It runs after the codec
(D81), so what reaches the bucket is the encrypted payload. The S3 driver needs a client; the
SDK's `aioboto3` one would pull botocore two minor lines back, so this implements its
three-method interface over the boto3 client the service already uses.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from functools import partial
from typing import Any

from botocore.exceptions import ClientError
from temporalio.contrib.aws.s3driver import S3StorageDriver, S3StorageDriverClient
from temporalio.converter import ExternalStorage

from awp_agent.clients import object_store
from awp_agent.config import settings

#: Payloads at or above this size go to the bucket. Measured on RUN-88182: 32 KiB keeps
#: 9.4 MB of its 52.6 MB inline, in 125 stored objects.
THRESHOLD_BYTES = 32 * 1024


class Boto3StorageClient(S3StorageDriverClient):
    """The driver's S3 calls, on a blocking boto3 client run off the event loop."""

    def __init__(self, client: Any) -> None:
        self._client = client

    async def put_object(self, *, bucket: str, key: str, data: bytes) -> None:
        """Store `data` under `key` in `bucket`."""
        await asyncio.to_thread(partial(self._client.put_object, Bucket=bucket, Key=key, Body=data))

    async def object_exists(self, *, bucket: str, key: str) -> bool:
        """Whether `key` is in `bucket`, by `head_object`; any error but not-found is raised."""
        try:
            await asyncio.to_thread(partial(self._client.head_object, Bucket=bucket, Key=key))
        except ClientError as problem:
            if problem.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    async def get_object(self, *, bucket: str, key: str) -> bytes:
        """The bytes stored under `key` in `bucket`, read off the event loop."""
        response = await asyncio.to_thread(partial(self._client.get_object, Bucket=bucket, Key=key))
        body: bytes = await asyncio.to_thread(response["Body"].read)
        return body

    def describe(self) -> Mapping[str, str]:
        """The object store's endpoint, which the driver appends to its error messages."""
        return {"endpoint": settings().s3_endpoint}


def external_storage() -> ExternalStorage | None:
    """The storage every client and worker uses, or `None` with no object store configured.

    Without one, payloads stay inline as before; a deployment always configures one.
    """
    config = settings()
    if not config.s3_access_key:
        return None
    driver = S3StorageDriver(
        client=Boto3StorageClient(object_store.client()),
        bucket=config.s3_bucket_run_payloads,
    )
    return ExternalStorage(drivers=[driver], payload_size_threshold=THRESHOLD_BYTES)
