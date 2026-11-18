# syntax=docker/dockerfile:1.7
# The one-off initialisation service of the Railway deployment (D390), built from the
# repository root. It does inside Railway's private network what `scripts/dev-local.sh`,
# `scripts/db-credentials.sh`, the object-buckets Job and `scripts/seed.sh` do for kind:
# databases and their login role, buckets, migrations and the first seed (`init.sh`); and,
# as the `data-import` service, replaces the data with a copy of kind's (`import.sh`).
FROM bitnamilegacy/minio-client:2025.7.21-debian-12-r2 AS mc

FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152
ENV NEXT_TELEMETRY_DISABLED=1
# The PostgreSQL 18 client, from the PGDG repository: bookworm's own is 15, and pg_restore
# cannot read a dump made by a newer pg_dump (`import.sh`).
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=mc /opt/bitnami/minio-client/bin/mc /usr/local/bin/mc

WORKDIR /repo/apps/web
COPY apps/web/package.json apps/web/package-lock.json apps/web/.npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/web ./
COPY infra/postgres /repo/infra/postgres
COPY infra/railway/init/init.sh infra/railway/init/import.sh /repo/infra/railway/init/

RUN groupadd --gid 10001 awp && useradd --uid 10001 --gid awp --create-home awp \
 && chown -R awp:awp /repo
USER awp
CMD ["bash", "/repo/infra/railway/init/init.sh"]
