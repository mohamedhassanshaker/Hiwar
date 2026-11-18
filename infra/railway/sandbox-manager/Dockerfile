# The Railway sandbox-manager image (D390): the kind image of services/sandbox, unchanged, plus
# the workspace image's lock files, which the Railway sandbox template is built from
# (`awp_sandbox/railway.py`). Built from services/sandbox by scripts/railway/images.sh.
ARG BASE
FROM ${BASE}
COPY workspace/pyproject.toml workspace/uv.lock workspace/package.json workspace/package-lock.json /app/workspace/
