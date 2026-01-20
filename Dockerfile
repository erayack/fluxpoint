# --- STAGE 1: Base ---
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# --- STAGE 2: Builder (Dependencies + Compilation) ---
FROM base AS builder
WORKDIR /app
ENV PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES=true
# Copy all manifests to resolve the monorepo graph
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/tooling/package.json packages/tooling/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN printf "inject-workspace-packages=true\n" >> .npmrc
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the SvelteKit app
RUN pnpm --filter web build

# Flatten production artifacts
RUN pnpm --filter web --prod deploy /isolated

# --- STAGE 3: Runner ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy the isolated bundle (node_modules + workspace code)
COPY --from=builder /isolated .
# Copy the built SvelteKit server entrypoint
COPY --from=builder /app/apps/web/build ./build

EXPOSE 3000
CMD ["node", "build/index.js"]
