"""A worker refuses to start against an unregistered namespace, so Kubernetes restarts it."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from temporalio.service import RPCError, RPCStatusCode

from awp_agent.worker import require_namespace


def client_answering(error: RPCError | None) -> Any:
    """A Temporal client whose namespace lookup succeeds, or fails with `error`."""

    async def describe_namespace(request: Any) -> object:
        if error is not None:
            raise error
        return SimpleNamespace(namespace_info=SimpleNamespace(name=request.namespace))

    return SimpleNamespace(workflow_service=SimpleNamespace(describe_namespace=describe_namespace))


async def test_should_start_when_the_namespace_is_registered() -> None:
    await require_namespace(client_answering(None), "awp")


async def test_should_exit_when_the_namespace_is_not_registered_yet() -> None:
    missing = RPCError("namespace awp is not found", RPCStatusCode.NOT_FOUND, b"")
    with pytest.raises(SystemExit, match="awp is not registered yet"):
        await require_namespace(client_answering(missing), "awp")


async def test_should_pass_on_any_other_failure_of_the_lookup() -> None:
    unavailable = RPCError("frontend unavailable", RPCStatusCode.UNAVAILABLE, b"")
    with pytest.raises(RPCError):
        await require_namespace(client_answering(unavailable), "awp")
