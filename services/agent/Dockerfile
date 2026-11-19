# syntax=docker/dockerfile:1.7
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
RUN groupadd --gid 10001 hiwar && useradd --uid 10001 --gid hiwar --no-create-home hiwar
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
USER hiwar
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "hiwar_agent.main:app", "--host", "0.0.0.0", "--port", "8080"]
