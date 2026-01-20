# Repository Guidelines

## Project Structure & Module Organization
- `apps/web/`: Svelte 5 + Vite frontend.
- `packages/api/`: API surface area and runtime validation.
  - Vendored Specta types go in `packages/api/src/generated/` (do not generate types in this repo).
  - Effect Schema wrappers live in `packages/api/src/schemas/` and are re-exported from `packages/api/src/index.ts`.
- `packages/core/`: shared Effect layers/services/logic used by apps.
- `packages/ui/`: shared Svelte components and UI utilities (export via `packages/ui/src/index.ts`).
- `packages/tooling/`: shared configs for linting and tests (ESLint/Oxlint/Vitest).

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies (see `packageManager` in `package.json`).
- `pnpm dev`: run the web app dev server (filters to `apps/web`).
- `pnpm --filter web build`: production build for `apps/web`.
- `pnpm --filter web preview`: preview the production build locally.
- `pnpm lint`: run `oxlint` + ESLint across the repo.
- `pnpm test`: run unit tests via Vitest (`packages/tooling/vitest.config.ts`).
  - Note: `pnpm test` exits with code 1 when no test files exist (Vitest default).

## Coding Style & Naming Conventions
- TypeScript is `strict` (see `tsconfig.base.json`); prefer typed APIs and avoid `any`.
- Centralized TSConfig aliases: prefer `@repo/*` imports (configured in `tsconfig.base.json` via `compilerOptions.paths`); add/update aliases there so they apply across apps/packages.
- ESM conventions: use `.js` extensions in relative TS imports/exports (example: `export * from "./layers/index.js";`).
- Match existing formatting: 2-space indentation, double quotes, and semicolons.
- Naming: Svelte components `PascalCase.svelte`; TS modules `camelCase.ts`; use `index.ts` for barrel exports.

## Tooling & Root Binaries
- Keep shared CLI tooling (e.g. `eslint`, `oxlint`, `vitest`) in the repo root `devDependencies`; run via `pnpm <script>` from the root.
- Centralize lint/test configuration in `packages/tooling/` and reference it from root scripts.
- For `apps/web/`, Vite resolves TSConfig aliases via `vite-tsconfig-paths` (`apps/web/vite.config.ts`).
- `pnpm.onlyBuiltDependencies` is configured in root `package.json` to allow build scripts for `esbuild` and `@oxlint/darwin-arm64`.

## Testing Guidelines
- Framework: Vitest (Node environment).
- Naming: `*.test.ts` or `*.spec.ts`, preferably colocated with the module under test (e.g. `packages/core/src/foo.test.ts`).
- Keep tests deterministic and fast; avoid network and time-based flakiness.

## Commit & Pull Request Guidelines
- Commits: use Conventional Commits (`feat:`, `fix:`, `chore:`), optionally scoped (e.g. `feat(core): add BrowserHttpLayer`).
- PRs: include a short description, link the relevant issue/ticket, add screenshots for UI changes in `apps/web/`, and ensure `pnpm lint` and `pnpm test` pass.
