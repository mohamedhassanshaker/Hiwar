# The console. Built from the repository root, and laid out inside the image the way the
# repository is laid out, so `outputFileTracingRoot` resolves to the same place in both.
# syntax=docker/dockerfile:1.7
FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152 AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/web

FROM base AS dependencies
COPY apps/web/package.json apps/web/package-lock.json apps/web/.npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

# The development image: the sources and the development dependencies in place.
FROM base AS dev
ENV NODE_ENV=development
COPY --from=dependencies --chown=node:node /repo/apps/web/node_modules ./node_modules
COPY --chown=node:node apps/web ./
USER node
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM base AS build
ENV NODE_ENV=production
COPY --from=dependencies /repo/apps/web/node_modules ./node_modules
COPY apps/web ./
RUN npm run build
# The `db-migrate` Job runs the same entry point `npm run db:migrate` runs. The standalone
# output does not carry it, so it is compiled to ESM here with everything it imports: the
# migrator reconciles the permission catalogue from the code that declares it. `set-password`
# is the operator's way to give existing people a password (D387).
RUN npx tsc src/db/migrate.ts src/db/set-password.ts --outDir db-migrate --rootDir src \
    --module esnext --moduleResolution bundler --target es2023 --skipLibCheck \
 && echo '{"type":"module"}' > db-migrate/package.json

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /repo

RUN groupadd --gid 10001 awp && useradd --uid 10001 --gid awp --no-create-home awp

# The standalone output is the server plus exactly the files Next.js traced for it.
COPY --from=build --chown=awp:awp /repo/apps/web/.next/standalone ./
COPY --from=build --chown=awp:awp /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone traces the server's own imports, not what it serves as files. The user guide's
# pictures live here, so without this they would 404 for every reader.
COPY --from=build --chown=awp:awp /repo/apps/web/public ./apps/web/public

# What the migration needs: the compiled tree, the Drizzle migrations beside it and the
# bootstrap SQL. The Job names both directories, because the compiled entry point does not
# sit where the source does. drizzle-orm is bundled into the server chunks rather than
# traced into node_modules, so the migrator is copied explicitly; `pg` is already there.
COPY --from=build --chown=awp:awp /repo/apps/web/db-migrate ./apps/web/db-migrate
COPY --chown=awp:awp apps/web/src/db/migrations ./apps/web/db-migrate/migrations
COPY --chown=awp:awp infra/postgres ./infra/postgres
COPY --from=dependencies --chown=awp:awp /repo/apps/web/node_modules/drizzle-orm ./apps/web/node_modules/drizzle-orm

USER awp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
