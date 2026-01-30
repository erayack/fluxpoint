#!/usr/bin/env npx tsx
/**
 * Scaffolds a new Effect-based Node.js app under apps/.
 * Usage: pnpm create-app <name>
 * Example: pnpm create-app customer-portal
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = resolve(__dirname, "../apps");

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm create-app <name>");
  console.error("Example: pnpm create-app customer-portal");
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("❌ App name must be lowercase alphanumeric with hyphens (e.g., customer-portal)");
  process.exit(1);
}

const appDir = resolve(APPS_DIR, name);

if (existsSync(appDir)) {
  console.error(`❌ App directory already exists: ${appDir}`);
  process.exit(1);
}

const toScreamingSnake = (str: string) => str.toUpperCase().replace(/-/g, "_");
const toPascalCase = (str: string) =>
  str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

const envPrefix = toScreamingSnake(name);
const pascalName = toPascalCase(name);
const configName = pascalName + "Config";

const files: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      scripts: {
        dev: "tsx src/main.ts",
        start: "tsx src/main.ts",
        test: "vitest run",
      },
      dependencies: {
        "@effect/platform": "^0.94.2",
        "@effect/platform-node": "^0.104.1",
        "@repo/api": "workspace:*",
        "@repo/core": "workspace:*",
        effect: "^3.19.15",
      },
      devDependencies: {
        "@types/node": "^22.15.21",
        vitest: "^4.0.18",
      },
    },
    null,
    2,
  ),

  "tsconfig.json": JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        types: ["node"],
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  ),

  "vitest.config.ts": `import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
  },
});
`,

  ".env.example": `# ${pascalName} Configuration
${envPrefix}_API_BASE_URL=http://127.0.0.1:3000
${envPrefix}_API_TOKEN=
`,

  "src/main.ts": `import { ConfigProvider, Effect, Fiber, Layer, Logger, LogLevel } from "effect";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { WebhookStoreLive } from "@repo/core";
import { ${configName}Live, run${pascalName} } from "./app.js";

const httpLayer = NodeHttpClient.layerUndici;
const configLayer = ${configName}Live;
const storeLayer = Layer.provide(WebhookStoreLive, Layer.merge(configLayer, httpLayer));
const appLayer = Layer.mergeAll(configLayer, storeLayer, httpLayer);

const loggerLayer = Logger.replace(
  Logger.defaultLogger,
  Logger.json,
).pipe(Layer.merge(Logger.minimumLogLevel(LogLevel.Info)));

const awaitSignal = Effect.async<"SIGINT" | "SIGTERM">((resume) => {
  const handleSigint = () => resume(Effect.succeed("SIGINT"));
  const handleSigterm = () => resume(Effect.succeed("SIGTERM"));

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  return Effect.sync(() => {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  });
});

const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(run${pascalName});

  const handleSignal = awaitSignal.pipe(
    Effect.tap((signal) => Effect.logInfo(\`Received \${signal}, shutting down\`)),
    Effect.zipRight(Fiber.interrupt(fiber)),
  );

  yield* Effect.raceFirst(handleSignal, Fiber.join(fiber));
}).pipe(
  Effect.provide(appLayer),
  Effect.provide(loggerLayer),
  Effect.withConfigProvider(ConfigProvider.fromEnv()),
);

NodeRuntime.runMain(program);
`,

  "src/app.ts": `import { Context, Effect, Layer, Config } from "effect";
import type { WebhookStore } from "@repo/core";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface ${configName} {
  readonly workerId: string;
  readonly internalApiBaseUrl: string;
  readonly internalApiToken: string | null;
}

export class ${configName} extends Context.Tag("${configName}")<${configName}, ${configName}>() {}

export const ${configName}Live = Layer.effect(
  ${configName},
  Effect.gen(function* () {
    const workerId = yield* Config.string("${envPrefix}_WORKER_ID").pipe(
      Config.withDefault("${name}-1"),
    );
    const internalApiBaseUrl = yield* Config.string("${envPrefix}_API_BASE_URL");
    const internalApiToken = yield* Config.string("${envPrefix}_API_TOKEN").pipe(
      Config.withDefault(""),
      Config.map((s) => (s === "" ? null : s)),
    );

    return {
      workerId,
      internalApiBaseUrl,
      internalApiToken,
    };
  }),
);

// ─── Main Logic ──────────────────────────────────────────────────────────────

export const run${pascalName} = Effect.gen(function* () {
  const config = yield* ${configName};

  yield* Effect.logInfo(\`${pascalName} starting (worker=\${config.workerId}, api=\${config.internalApiBaseUrl})\`);

  // TODO: Implement your main logic here
  // WebhookStore is available via: const store = yield* WebhookStore;

  yield* Effect.logInfo("${pascalName} ready");
});
`,

  "src/app.test.ts": `import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { ${configName}, ${configName}Live, run${pascalName} } from "./app.js";

const testConfig: ${configName} = {
  workerId: "test-worker",
  internalApiBaseUrl: "http://localhost:3000",
  internalApiToken: null,
};

const TestConfigLayer = Layer.succeed(${configName}, testConfig);

describe("${pascalName}", () => {
  it("should load config successfully", async () => {
    const program = Effect.gen(function* () {
      const config = yield* ${configName};
      return config;
    }).pipe(Effect.provide(TestConfigLayer));

    const result = await Effect.runPromise(program);
    expect(result.workerId).toBe("test-worker");
    expect(result.internalApiBaseUrl).toBe("http://localhost:3000");
  });

  // TODO: Add more tests for your business logic
});
`,
};

console.log(`Creating app: ${name}`);

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = resolve(appDir, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  console.log(`  ✓ ${filePath}`);
}

console.log(`
✅ App created at apps/${name}

Next steps:
  1. pnpm install (from repo root)
  2. cp apps/${name}/.env.example apps/${name}/.env
  3. pnpm --filter ${name} dev
  4. pnpm --filter ${name} test
`);
