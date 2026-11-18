# `services/connectors`

The connector runtime. The same image runs in two modes.

| Mode | `CONNECTOR_MODE` | What it does |
| --- | --- | --- |
| Control | `control` (default) | Holds the connector registry, creates one Deployment and Service per stdio connector, and proxies `/mcp/{id}` to it. Never runs a connector's code. |
| Bridge | `bridge` | Runs exactly one stdio MCP server, named by `CONNECTOR_ID`, and exposes it over Streamable HTTP. This is what each per-connector Pod runs. |

A stdio MCP server is third-party code: usually an `npx` package, possibly chatty, possibly
leaky, and holding that connector's credentials. One Pod each means one blast radius and one
memory limit each.

## Secrets

A connector's credentials are stored encrypted by the console and are never returned by any
API. A stdio connector's are a Kubernetes Secret mounted as a volume, one file per key, which the
runtime puts in the server process's environment; `/connectors` shows which variables are set,
never what they are. A remote connector's arrive with `PUT /connectors` as the `headers` and
`query` its requests carry (D296): held in memory only, left out of the ConfigMap kept for a
restart and of a bridge's spec, and redacted from any error. A connector restored without them
(`needs_credential`) answers 409, and the console sends them again.

## Hot reload

`PUT /connectors` replaces the whole set, stops the sessions of connectors that changed, removes
the workloads of connectors that are gone and creates the ones that are new. That is what
"saving a connector takes effect without a restart" means (S-54).

## Commands

```bash
uv sync
uv run ruff check .
uv run mypy .
uv run pytest
```
