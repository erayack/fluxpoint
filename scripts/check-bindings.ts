#!/usr/bin/env npx tsx
/**
 * Checks that vendored Specta bindings are up-to-date (non-destructive).
 * Run: pnpm check:bindings
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINDINGS_PATH = resolve(__dirname, "../packages/api/src/generated/bindings.ts");
const RECEIVER_DIR = process.env.RECEIVER_DIR ?? resolve(__dirname, "../../receiver");

const hash = (content: string) => createHash("sha256").update(content).digest("hex").slice(0, 12);

if (!existsSync(BINDINGS_PATH)) {
  console.error(`❌ Bindings file not found: ${BINDINGS_PATH}`);
  process.exit(1);
}

if (!existsSync(RECEIVER_DIR)) {
  console.error(`❌ Receiver directory not found: ${RECEIVER_DIR}`);
  console.error("Set RECEIVER_DIR env var to the receiver repo path.");
  process.exit(1);
}

const tempDir = mkdtempSync(resolve(tmpdir(), "bindings-check-"));
const tempBindings = resolve(tempDir, "bindings.ts");

try {
  copyFileSync(BINDINGS_PATH, tempBindings);
  const vendored = readFileSync(tempBindings, "utf-8");

  try {
    execSync("cargo test export_bindings --release -- --nocapture", {
      cwd: RECEIVER_DIR,
      stdio: "pipe",
    });
  } catch (err) {
    console.error("❌ Failed to run export_bindings test");
    console.error((err as { stderr?: Buffer }).stderr?.toString() ?? err);
    process.exit(1);
  }

  const fresh = readFileSync(BINDINGS_PATH, "utf-8");

  copyFileSync(tempBindings, BINDINGS_PATH);

  if (vendored !== fresh) {
    console.error("❌ Bindings are out of date!");
    console.error(`   Vendored: ${hash(vendored)}`);
    console.error(`   Fresh:    ${hash(fresh)}`);
    console.error("Run 'just sync-bindings' in the receiver repo to update.");
    process.exit(1);
  }

  console.log(`✅ Bindings are up to date (${hash(vendored)})`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
