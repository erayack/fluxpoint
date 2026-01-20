import effect from "@effect/eslint-plugin";
import svelte from "eslint-plugin-svelte";
import ts from "typescript-eslint";

export default [
  {
    ignores: ["**/node_modules/**", "**/.svelte-kit/**", "**/dist/**", "**/build/**"]
  },
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    plugins: {
      "@effect": effect
    }
  }
];
