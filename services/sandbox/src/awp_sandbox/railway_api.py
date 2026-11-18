"""Railway's public GraphQL API, the calls the Railway sandbox backend makes (D390)."""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from awp_sandbox.manager import SandboxError


@dataclass
class RailwayApi:
    """The few GraphQL calls the manager makes, with the deployment's token."""

    url: str
    token: str
    environment_id: str
    timeout_seconds: float = 60.0
    headers: dict[str, str] = field(init=False)

    def __post_init__(self) -> None:
        self.headers = {"Content-Type": "application/json", "User-Agent": "awp-sandbox-manager"}
        self.headers["Authorization"] = f"Bearer {self.token}"

    async def call(self, query: str, variables: dict[str, Any], wait_seconds: float = 0) -> Any:
        """One GraphQL request. Raises `SandboxError` on a transport or GraphQL error."""
        body = json.dumps({"query": query, "variables": variables}).encode()
        request = urllib.request.Request(self.url, data=body, headers=self.headers)
        try:
            raw = await asyncio.to_thread(self._send, request, wait_seconds or self.timeout_seconds)
        except (urllib.error.URLError, TimeoutError) as problem:
            raise SandboxError(f"Railway did not answer: {problem}") from problem
        answer = json.loads(raw)
        if answer.get("errors"):
            raise SandboxError(f"Railway refused: {answer['errors'][0].get('message')}")
        return answer["data"]

    @staticmethod
    def _send(request: urllib.request.Request, timeout: float) -> bytes:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body: bytes = response.read()
            return body


#: The GraphQL documents, one per call: template build and its status, then each sandbox call.
BUILD = (
    "mutation($env: String!, $input: SandboxTemplateInput!) "
    "{ sandboxTemplateBuild(environmentId: $env, input: $input) { id status } }"
)
BUILD_STATUS = (
    "query($id: ID!, $env: String!) "
    "{ sandboxTemplateBuild(environmentId: $env, id: $id) { status } }"
)
CREATE = "mutation($input: SandboxCreateInput!) { sandboxCreate(input: $input) { id status } }"
STATUS = "query($id: String!, $env: String!) { sandbox(id: $id, environmentId: $env) { status } }"
DESTROY = (
    "mutation($id: String!, $env: String!) { sandboxDestroy(id: $id, environmentId: $env) { id } }"
)
EXEC = (
    "mutation($id: String!, $env: String!, $command: String!, $timeout: Int) "
    "{ sandboxExec(id: $id, environmentId: $env, command: $command, timeoutSec: $timeout) "
    "{ exitCode stdout stderr timedOut truncated } }"
)
