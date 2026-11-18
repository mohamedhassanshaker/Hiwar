"""A stand-in for the sandbox manager's HTTP API, over an in-memory workspace.

`mission/sandbox.py` builds its own `httpx.AsyncClient`; `install` gives every such client a
mock transport that answers as `services/sandbox` does. A script run is recorded and, as
the real script would, writes the output file named after its `--out` argument.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field

import httpx
import pytest

from awp_agent.mission import sandbox as mission_sandbox


@dataclass
class FakeSandbox:
    """One run's workspace: its files, and what reached the manager."""

    files: dict[str, bytes] = field(default_factory=dict)
    creates: list[str] = field(default_factory=list)
    scripts: list[list[str]] = field(default_factory=list)
    released: list[str] = field(default_factory=list)
    #: When set, the manager answers 503 as it does with no workspace to give.
    unavailable: bool = False
    #: When set, the manager fails with a 500 and a plain-text body, as an unhandled error does.
    broken: bool = False
    #: What a script run writes to its `--out` path.
    output: bytes = b"PK\x03\x04 a deck"

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.unavailable:
            return httpx.Response(503, json={"detail": "no sandbox node is free"})
        if self.broken:
            return httpx.Response(500, text="Internal Server Error")
        path = request.url.path
        if request.method == "POST" and path == "/sandboxes":
            self.creates.append(json.loads(request.content)["run_id"])
            return httpx.Response(200, json={"sandbox_id": "s1", "pod": "sandbox-s1"})
        if request.method == "DELETE" and path == "/sandboxes":
            self.released.append(request.url.params["run_id"])
            return httpx.Response(200, json={"destroyed": 1})
        if path == "/sandboxes/s1/files" and request.method == "POST":
            body = json.loads(request.content)
            self.files[body["path"]] = base64.b64decode(body["content_base64"])
            return self._result()
        if path == "/sandboxes/s1/files":
            wanted = request.url.params["path"]
            if wanted not in self.files:
                return self._result(1, stderr=f"base64: {wanted}: No such file or directory")
            return self._result(stdout=base64.b64encode(self.files[wanted]).decode())
        if path == "/sandboxes/s1/exec":
            return self._exec(json.loads(request.content)["command"])
        return httpx.Response(404, json={"detail": f"no route {path}"})

    def _exec(self, command: list[str]) -> httpx.Response:
        if command[:2] == ["test", "-f"]:
            return self._result(0 if command[2] in self.files else 1)
        if command[0] == "mkdir":
            return self._result()
        if command[0] == "find":
            listed = [
                "./" + name.removeprefix("/workspace/")
                for name in self.files
                if not name.startswith("/workspace/skills/")
            ]
            return self._result(stdout="\n".join(listed) + "\n")
        if command[0] == "sh":
            arguments = command[4:]
            self.scripts.append(arguments)
            if "--out" in arguments:
                out = arguments[arguments.index("--out") + 1]
                self.files[f"/workspace/{out}"] = self.output
            return self._result(stdout="built\n")
        return self._result(127, stderr=f"{command[0]}: not found")

    @staticmethod
    def _result(exit_code: int = 0, *, stdout: str = "", stderr: str = "") -> httpx.Response:
        return httpx.Response(
            200,
            json={"exit_code": exit_code, "stdout": stdout, "stderr": stderr, "timed_out": False},
        )


def install(monkeypatch: pytest.MonkeyPatch) -> FakeSandbox:
    """Route the runtime's sandbox calls to a fresh stand-in, and return it."""
    sandbox = FakeSandbox()

    def client(base_url: str, seconds: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url, timeout=seconds, transport=httpx.MockTransport(sandbox.handle)
        )

    monkeypatch.setattr(mission_sandbox, "_client", client)
    return sandbox
