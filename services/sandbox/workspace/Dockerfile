# The image a sandbox workspace Pod runs: what an Agent Skill's scripts may use.
# Python 3.12 with the libraries in pyproject.toml, Node 24 with the ones in package.json.
# No LibreOffice: a skill's optional render check is skipped where it is missing.
# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS node-libraries
WORKDIR /opt/node
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM python:3.12-slim-bookworm AS python-libraries
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /opt/workspace
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev

FROM python:3.12-slim-bookworm AS runtime
COPY --from=node-libraries /usr/local/bin/node /usr/local/bin/node
COPY --from=node-libraries /opt/node/node_modules /opt/node/node_modules
COPY --from=python-libraries /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    NODE_PATH=/opt/node/node_modules \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN groupadd --gid 10001 awp && useradd --uid 10001 --gid awp --no-create-home awp
USER awp
WORKDIR /workspace
CMD ["sleep", "900"]
