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
RUN VITE_API_URL=/_services/scoutin-2 pnpm --filter frontend exec vite build --base=/_services/scoutin-2/ && \
    pnpm --filter frontend exec tsc

# Compile plugin backend TypeScript to JS so pnpm deploy can include them
# as plain JavaScript in node_modules (Node cannot type-strip files in node_modules).
RUN pnpm --filter @scouterna/scoutin-plugin-api run build
RUN pnpm --filter @scouterna/scoutin-plugin-base run build
RUN pnpm --filter @scouterna/scoutin-plugin-malcolm-test run build

# Create a self-contained backend deployment with production deps only.
# Workspace packages (@scouterna/scoutin-plugin-*) are bundled in as well.
RUN pnpm deploy --filter @scouterna/scoutin-backend --prod --legacy /deploy

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV BASE_PATH=/_services/scoutin-2

# Self-contained backend: source files + production node_modules (from pnpm deploy)
COPY --from=builder /deploy ./

# Plugins import from @scouterna/scoutin-backend/plugin-services, but pnpm deploy
# places the backend at the root (/app), not in node_modules. Create a minimal shim
# so Node.js can find and read the package.json exports. The src/ symlink's realpath
# resolves to /app/src/..., which is outside node_modules, so type-stripping works.
RUN mkdir -p node_modules/@scouterna/scoutin-backend && \
    cp package.json node_modules/@scouterna/scoutin-backend/package.json && \
    ln -s ../../../src node_modules/@scouterna/scoutin-backend/src

# Frontend static files served by Hono's serveStatic middleware
COPY --from=builder /app/packages/frontend/dist ./public

EXPOSE 3000
# --conditions production activates the compiled-JS export condition in plugin packages,
# bypassing the TypeScript source that cannot be type-stripped from node_modules.
CMD ["node", "--conditions", "production", "src/index.ts"]
