import effect from "@effect/eslint-plugin";
import svelte from "eslint-plugin-svelte";
import ts from "typescript-eslint";
import svelteParser from "svelte-eslint-parser";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.svelte-kit/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
    ],
  },
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    plugins: {
      "@effect": effect,
    },
  },
];
