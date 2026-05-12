# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy package manifests before source so this layer is cached unless deps change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/plugin-api/package.json ./packages/plugin-api/
COPY plugins/base/package.json ./plugins/base/
COPY plugins/malcolm-test/package.json ./plugins/malcolm-test/
RUN pnpm install --frozen-lockfile

# Copy remaining source files.
COPY . .

# Generate the Prisma client into packages/backend/src/generated/prisma/.
# DATABASE_URL is required by prisma.config.ts at load time even though
# generate never connects to the database.
RUN DATABASE_URL=postgresql://build-placeholder \
    pnpm --filter @scouterna/scoutin-backend exec prisma generate

# Build the frontend SPA → packages/frontend/dist/
RUN pnpm --filter frontend build

# Create a self-contained backend deployment with production deps only.
# Workspace packages (@scouterna/scoutin-plugin-*) are bundled in as well.
RUN pnpm deploy --filter @scouterna/scoutin-backend --prod --legacy /deploy

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Self-contained backend: source files + production node_modules (from pnpm deploy)
COPY --from=builder /deploy ./

# Frontend static files served by Hono's serveStatic middleware
COPY --from=builder /app/packages/frontend/dist ./public

EXPOSE 3000
# Node 24 runs TypeScript source directly without any flags.
# The backend tsconfig uses noEmit + erasableSyntaxOnly for this pattern.
CMD ["node", "src/index.ts"]
