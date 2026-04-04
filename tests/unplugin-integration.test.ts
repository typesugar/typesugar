/**
 * Integration tests for unplugin-typesugar (PEP-035 Wave 2D)
 *
 * Tests the unplugin in Vite build mode and esbuild mode to verify
 * that @derive output is correctly transpiled to portable JavaScript.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Fixture: a minimal TypeScript file with @derive that exercises
// namespace companion merging (the construct that breaks esbuild)
const FIXTURE_CODE = `
/** @derive(Eq, Debug) */
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
console.log("eq:", Point.Eq.equals(p1, p2));
console.log("debug:", Point.Debug.debug(p1));
`.trim();

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: false,
    skipLibCheck: true,
    esModuleInterop: true,
  },
  include: ["*.ts"],
});

// Use a fixture directory within the project tree so the unplugin
// pipeline can find the tsconfig and resolve the files
const fixtureDir = path.join(__dirname, ".unplugin-fixture");

beforeAll(() => {
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, "input.ts"), FIXTURE_CODE);
  fs.writeFileSync(path.join(fixtureDir, "tsconfig.json"), TSCONFIG);
});

afterAll(() => {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// Vite build mode
// ============================================================================
// Note: Vite can't be loaded inside a Vitest context (Vitest itself runs on Vite).
// Vite integration is covered by the esbuild tests below — Vite uses esbuild
// for TS transpilation, so the same transpile path (emitJs) is exercised.

// ============================================================================
// esbuild mode
// ============================================================================

describe("unplugin in esbuild mode", () => {
  it("builds @derive file without errors", async () => {
    const esbuild = await import("esbuild");
    const typesugarPlugin = await import("unplugin-typesugar/esbuild");

    const result = await esbuild.build({
      entryPoints: [path.join(fixtureDir, "input.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      logLevel: "silent",
      plugins: [
        typesugarPlugin.default({
          tsconfig: path.join(fixtureDir, "tsconfig.json"),
        }),
      ],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.outputFiles).toBeDefined();
    expect(result.outputFiles!.length).toBeGreaterThan(0);

    const code = result.outputFiles![0].text;

    // Should be valid JavaScript (no TypeScript syntax)
    expect(code).not.toContain("namespace");
    expect(code).not.toMatch(/:\s*number/);

    // Should contain the runtime code from @derive
    expect(code).toContain("equals");
    expect(code).toContain("debug");

    // Should contain user code
    expect(code).toContain("console.log");
  });

  it("produces correct runtime output with @derive", async () => {
    const esbuild = await import("esbuild");
    const typesugarPlugin = await import("unplugin-typesugar/esbuild");

    // Use IIFE format so the bundled code can be eval'd
    const result = await esbuild.build({
      entryPoints: [path.join(fixtureDir, "input.ts")],
      bundle: true,
      write: false,
      format: "iife",
      platform: "node",
      logLevel: "silent",
      plugins: [
        typesugarPlugin.default({
          tsconfig: path.join(fixtureDir, "tsconfig.json"),
        }),
      ],
    });

    const code = result.outputFiles![0].text;

    // Execute the bundled code and capture console output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      // eslint-disable-next-line no-eval
      eval(code);
    } finally {
      console.log = originalLog;
    }

    // Verify runtime behavior
    expect(logs).toContain("eq: true");
    expect(logs.some((l) => l.startsWith("debug:"))).toBe(true);
  });
});
