# @repo/api

This package consumes vendored Specta-generated TypeScript types and wraps them in Effect Schema for runtime validation.

## Vendored types contract
- Place Specta output into `src/generated/`.
- Do not generate types in this repo.
- Keep the generated files as a direct copy from the Rust pipeline.

## Schema wrappers
- Add schema files in `src/schemas/`.
- Re-export schemas from `src/schemas/index.ts`.
- Re-export both generated types and schemas from `src/index.ts`.
