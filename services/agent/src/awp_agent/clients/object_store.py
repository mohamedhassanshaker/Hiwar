"""The S3 client for the platform's object store (stack specification 7.3)."""

from __future__ import annotations

from typing import Any

import boto3

from awp_agent.config import settings


def client() -> Any:
    """The S3 client. boto3 builds its clients dynamically, so the type is Any."""
    config = settings()
    return boto3.client(
        "s3",
        endpoint_url=config.s3_endpoint,
        region_name=config.s3_region,
        aws_access_key_id=config.s3_access_key,
        aws_secret_access_key=config.s3_secret_key,
    )
