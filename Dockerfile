# --- STAGE 1: Base ---
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the SvelteKit app
RUN pnpm --filter web build

# Flatten production artifacts
RUN pnpm --filter web --prod deploy /isolated
RUN mkdir -p /isolated/build && cp -R apps/web/build/. /isolated/build/

# --- STAGE 3: Runner ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app

# Copy the isolated bundle (node_modules + workspace code)
COPY --from=builder /isolated .

EXPOSE 3000
USER app
CMD ["node", "build/index.js"]
