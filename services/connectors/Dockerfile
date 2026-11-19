# The connector runtime: one MCP server process per connector, over Streamable HTTP.
# syntax=docker/dockerfile:1.7
FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
RUN groupadd --gid 10001 awp && useradd --uid 10001 --gid awp --no-create-home awp
WORKDIR /app

FROM base AS dependencies
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

FROM base AS dev
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
RUN chown -R awp:awp /app
USER awp
EXPOSE 8080
CMD ["uvicorn", "awp_connectors.main:app", "--host", "0.0.0.0", "--port", "8080", "--reload"]

FROM base AS runtime
COPY --from=dependencies /opt/venv /opt/venv
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

USER awp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "awp_connectors.main:app", "--host", "0.0.0.0", "--port", "8080"]
