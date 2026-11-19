"""Reading a connector's credentials from its mounted Secret.

The console stores a connector secret encrypted and never returns it; the runtime reads the
plaintext from a mounted Kubernetes Secret and puts it in the server process's environment. It
is never logged, never returned by an endpoint, and never written to a response — which is what
the "a connector secret is stored as ciphertext and the API never returns the value" rule means
on this side of the boundary.
"""

from __future__ import annotations

from pathlib import Path

from awp_connectors.config import settings

REDACTED = "••••••"


def environment_for(env_from_secret: str) -> dict[str, str]:
    """The environment variables of one connector, read from its mounted Secret folder.

    A Kubernetes Secret mounted as a volume is one file per key, which is exactly the shape
    this needs: the file name is the variable and the content is the value.
    """
    if not env_from_secret:
        return {}
    folder = Path(settings().secrets_path) / env_from_secret
    if not folder.is_dir():
        return {}
    return {
        item.name: item.read_text(encoding="utf-8").strip()
        for item in sorted(folder.iterdir())
        if item.is_file() and not item.name.startswith("..")
    }


def redact(environment: dict[str, str]) -> dict[str, str]:
    """The same keys with every value hidden, for a log line or a status endpoint."""
    return dict.fromkeys(environment, REDACTED)
