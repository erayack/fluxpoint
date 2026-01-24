import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.svelte-kit/**", "**/*.test.ts", "**/*.spec.ts"],
    },
  },
});
