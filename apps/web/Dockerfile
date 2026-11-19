# syntax=docker/dockerfile:1.7
# The Hiwar web application (control panel, operator portal with the AI capabilities, widget,
# public site). Built from the repository root and laid out the way the repository is, so
# `outputFileTracingRoot` resolves to the same place in both.
FROM node:24.11.0-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/web

FROM base AS dependencies
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

FROM base AS build
ENV NODE_ENV=production
COPY --from=dependencies /repo/apps/web/node_modules ./node_modules
COPY apps/web ./
COPY packages /repo/packages
RUN npm run build
# The db-migrate Job runs the migrator, which the standalone output does not carry.
RUN npx tsc src/db/migrate.ts --outDir db-migrate --rootDir src \
    --module esnext --moduleResolution bundler --target es2023 --skipLibCheck \
 && echo '{"type":"module"}' > db-migrate/package.json

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /repo
RUN groupadd --gid 10001 hiwar && useradd --uid 10001 --gid hiwar --no-create-home hiwar
COPY --from=build --chown=hiwar:hiwar /repo/apps/web/.next/standalone ./
COPY --from=build --chown=hiwar:hiwar /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=hiwar:hiwar /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=hiwar:hiwar /repo/apps/web/db-migrate ./apps/web/db-migrate
COPY --chown=hiwar:hiwar apps/web/src/db/migrations ./apps/web/src/db/migrations
COPY --from=dependencies --chown=hiwar:hiwar /repo/apps/web/node_modules/drizzle-orm ./apps/web/node_modules/drizzle-orm
USER hiwar
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
