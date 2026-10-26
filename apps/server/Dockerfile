FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

# ─── Dependencies ────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/admin/package.json ./apps/admin/
COPY apps/docs/package.json ./apps/docs/
COPY packages/types/package.json ./packages/types/
COPY packages/sdk-react/package.json ./packages/sdk-react/
COPY packages/sdk-react/playground/package.json ./packages/sdk-react/playground/
COPY packages/sdk-vue/package.json ./packages/sdk-vue/
COPY packages/sdk-vue/playground/package.json ./packages/sdk-vue/playground/
COPY packages/sdk-core/package.json ./packages/sdk-core/

# Optional build-only corporate/cloud CA. Verification remains enabled.
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; \
    fi; \
    HUSKY=0 bun install --frozen-lockfile

# ─── Build server ─────────────────────────────────────────────
FROM deps AS build-server
COPY packages/types ./packages/types
COPY apps/server ./apps/server
RUN cd packages/types && bun run build
RUN cd apps/server && bun build src/index.ts src/worker.ts scripts/migrate.ts scripts/seed-admin.ts --outdir dist --target bun --entry-naming '[name].[ext]'

# ─── Production image ─────────────────────────────────────────
FROM oven/bun:1.4.4-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build-server /app/apps/server/dist ./dist
COPY --from=build-server /app/apps/server/drizzle ./drizzle
COPY --from=build-server /app/apps/server/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
