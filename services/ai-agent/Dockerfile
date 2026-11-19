# The agent service and the agent workers: one image, two commands.
# Built from the repository root, because the bundled Agent Skills live in `packages/`.
# syntax=docker/dockerfile:1.7
FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    AWP_SKILLS_PATH=/app/skills \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken \
    DOCLING_ARTIFACTS_PATH=/opt/docling-models \
    PATH=/opt/venv/bin:$PATH

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv

# Tesseract with the Arabic and English packs, for the "OCR scanned PDFs" option.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 awp && useradd --uid 10001 --gid awp --no-create-home awp
WORKDIR /app

# The lock file alone, so a source change does not reinstall the world.
FROM base AS dependencies
COPY services/ai-agent/pyproject.toml services/ai-agent/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev --extra parsers

# tiktoken downloads its vocabulary from openaipublic.blob.core.windows.net the first time
# an encoding is used. A pod has no egress, so that connect does not fail - it hangs until
# it times out, on the first model step of every run. Fetched here, where there is a
# network, and read from `TIKTOKEN_CACHE_DIR` at runtime.
RUN python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')" \
    && chown -R hiwar:hiwar /opt/tiktoken

# docling's model weights, for the same reason: fetched here, read from
# `DOCLING_ARTIFACTS_PATH` at runtime (`ingestion/parsing.py`). Named explicitly rather than
# the CLI's own predefined set, which also downloads models for enrichments this pipeline
# never turns on (picture description, code/formula and chart extraction, other OCR engines)
# and would needlessly multiply the image's size.
#
# `rapidocr` is not prefetched: its weights serve from a CDN this build cannot always reach,
# and the pipeline turns docling's own OCR off (`do_ocr=False`); a scanned document is read
# with Tesseract instead (`ingestion/parsing.py`).
RUN docling-tools models download layout tableformer --output-dir "${DOCLING_ARTIFACTS_PATH}" \
    && chown -R hiwar:hiwar "${DOCLING_ARTIFACTS_PATH}"

# The development image: the sources and the development dependencies in place.
FROM base AS dev
COPY --from=dependencies --chown=hiwar:hiwar /opt/tiktoken /opt/tiktoken
COPY --from=dependencies --chown=hiwar:hiwar /opt/docling-models /opt/docling-models
COPY services/ai-agent/pyproject.toml services/ai-agent/uv.lock services/ai-agent/README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --extra parsers
COPY services/ai-agent/src ./src
COPY packages/skills-bundled ./skills
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --extra parsers
RUN chown -R hiwar:hiwar /app
USER awp
EXPOSE 8000
CMD ["uvicorn", "awp_agent.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS runtime
COPY --from=dependencies /opt/venv /opt/venv
COPY --from=dependencies --chown=hiwar:hiwar /opt/tiktoken /opt/tiktoken
COPY --from=dependencies --chown=hiwar:hiwar /opt/docling-models /opt/docling-models
COPY services/ai-agent/pyproject.toml services/ai-agent/uv.lock services/ai-agent/README.md ./
COPY services/ai-agent/src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra parsers
COPY --chown=hiwar:hiwar packages/skills-bundled ./skills

USER awp
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"

# The FastAPI AG-UI endpoint. The workers run the same image with
# `awp-agent-worker <task-queue>` as their command.
CMD ["uvicorn", "awp_agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
