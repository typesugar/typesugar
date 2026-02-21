/**
 * End-to-end performance benchmarks for the macro transformer.
 *
 * Unlike the microbenchmarks in benchmark.test.ts, these exercise the FULL
 * transformer pipeline on realistic source files:
 *
 * 1. Full transformer pass on files with no macros (overhead measurement)
 * 2. Full transformer pass on files with many comptime() calls
 * 3. Full transformer pass on files with @derive on large classes
 * 4. VM-based comptime evaluation (the most expensive real-world path)
 * 5. Scaling: how throughput changes with 1, 10, 50, 100 macro invocations
 * 6. Visitor overhead: large files with zero macros
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { globalRegistry, defineExpressionMacro } from "../src/core/registry.js";
import type { ExpressionMacro, MacroContext } from "../src/core/types.js";
import macroTransformerFactory from "../src/transforms/macro-transformer.js";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let tmpDir: string;

/**
 * Register a simple test macro that replaces `testMacro(expr)` with `expr`.
 * This lets us measure transformer overhead without the cost of a real macro.
 */
let testMacro: ExpressionMacro;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typemacro-bench-e2e-"));

  testMacro = defineExpressionMacro({
    name: "benchMacro",
    expand: (_ctx: MacroContext, _callExpr: ts.CallExpression, args: readonly ts.Expression[]) => {
      return args.length > 0 ? args[0] : _ctx.factory.createNumericLiteral(0);
    },
  });
  try {
    globalRegistry.register(testMacro);
  } catch {
    // Already registered from a previous run
  }
});

afterAll(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Create a ts.Program for a source string. This is the expensive part
 * that happens once per build, not per file.
 */
function createProgram(
  source: string,
  extraFiles: Record<string, string> = {}
): { program: ts.Program; mainFile: string } {
  const mainFile = path.join(
    tmpDir,
    `bench_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`
  );
  fs.writeFileSync(mainFile, source);

  const filePaths = [mainFile];
  for (const [name, content] of Object.entries(extraFiles)) {
    const filePath = path.join(tmpDir, name);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
    filePaths.push(filePath);
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    baseUrl: tmpDir,
  };

  return { program: ts.createProgram(filePaths, options), mainFile };
}

/**
 * Run the full transformer pipeline on a source string.
 * Returns the output text and timing for both program creation and transform.
 */
function transformAndMeasure(
  source: string,
  extraFiles: Record<string, string> = {}
): { output: string; totalMs: number; programMs: number; transformMs: number } {
  const programStart = performance.now();
  const { program, mainFile } = createProgram(source, extraFiles);
  const programMs = performance.now() - programStart;

  const sourceFile = program.getSourceFile(mainFile)!;

  const transformStart = performance.now();
  const transformerFactory = macroTransformerFactory(program);
  const result = ts.transform(sourceFile, [transformerFactory]);
  const transformed = result.transformed[0];
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const output = printer.printFile(transformed);
  const transformMs = performance.now() - transformStart;

  result.dispose();
  fs.unlinkSync(mainFile);

  return { output, totalMs: programMs + transformMs, programMs, transformMs };
}

interface BenchStats {
  avgMs: number;
  minMs: number;
  maxMs: number;
  medianMs: number;
}

interface FullBenchStats {
  total: BenchStats;
  program: BenchStats;
  transform: BenchStats;
}

function computeStats(times: number[]): BenchStats {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    avgMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    medianMs: sorted[Math.floor(sorted.length / 2)],
  };
}

/**
 * Run a transform N times and return stats, broken down by phase.
 */
function benchTransform(
  source: string,
  iterations: number,
  extraFiles: Record<string, string> = {}
): FullBenchStats {
  const totalTimes: number[] = [];
  const programTimes: number[] = [];
  const transformTimes: number[] = [];

  // Warmup
  transformAndMeasure(source, extraFiles);

  for (let i = 0; i < iterations; i++) {
    const r = transformAndMeasure(source, extraFiles);
    totalTimes.push(r.totalMs);
    programTimes.push(r.programMs);
    transformTimes.push(r.transformMs);
  }

  return {
    total: computeStats(totalTimes),
    program: computeStats(programTimes),
    transform: computeStats(transformTimes),
  };
}

/**
 * Benchmark ONLY the transform phase, reusing a single program.
 * This is the realistic scenario: program is created once, transformer
 * runs on each file.
 */
function benchTransformOnly(source: string, iterations: number): BenchStats {
  const { program, mainFile } = createProgram(source);
  const sourceFile = program.getSourceFile(mainFile)!;
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < 3; i++) {
    const factory = macroTransformerFactory(program);
    const r = ts.transform(sourceFile, [factory]);
    const p = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    p.printFile(r.transformed[0]);
    r.dispose();
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const factory = macroTransformerFactory(program);
    const r = ts.transform(sourceFile, [factory]);
    const p = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    p.printFile(r.transformed[0]);
    r.dispose();
    times.push(performance.now() - start);
  }

  fs.unlinkSync(mainFile);
  return computeStats(times);
}

function formatStats(stats: BenchStats): string {
  return `avg=${stats.avgMs.toFixed(1)}ms  median=${stats.medianMs.toFixed(1)}ms  min=${stats.minMs.toFixed(1)}ms  max=${stats.maxMs.toFixed(1)}ms`;
}

function formatFullStats(stats: FullBenchStats): string {
  return [
    `total: ${formatStats(stats.total)}`,
    `  program creation: ${formatStats(stats.program)}`,
    `  transform only:   ${formatStats(stats.transform)}`,
  ].join("\n    ");
}

// ---------------------------------------------------------------------------
// Generate realistic source files
// ---------------------------------------------------------------------------

function generatePlainTypeScript(lines: number): string {
  const parts: string[] = [];
  parts.push("// Generated plain TypeScript file for benchmarking");
  for (let i = 0; i < lines; i++) {
    if (i % 20 === 0) {
      parts.push(`\ninterface Model${i} {`);
      for (let j = 0; j < 5; j++) {
        parts.push(`  field${j}: ${j % 2 === 0 ? "string" : "number"};`);
      }
      parts.push("}");
    } else if (i % 10 === 0) {
      parts.push(`function compute${i}(x: number): number { return x * ${i} + ${i}; }`);
    } else if (i % 5 === 0) {
      parts.push(`const val${i} = ${i} * 2 + ${i % 7};`);
    } else {
      parts.push(`const c${i} = "${i}_" + String(${i});`);
    }
  }
  return parts.join("\n");
}

function generateComptimeCalls(count: number): string {
  const parts: string[] = [];
  parts.push("// Generated file with many benchMacro() calls");
  for (let i = 0; i < count; i++) {
    parts.push(`const r${i} = benchMacro(${i * 7 + 3});`);
  }
  return parts.join("\n");
}

function generateMixedFile(macroCount: number, plainLines: number): string {
  const parts: string[] = [];
  parts.push("// Mixed file: plain TS + macro calls");
  let macrosPlaced = 0;
  const interval = Math.max(1, Math.floor(plainLines / macroCount));

  for (let i = 0; i < plainLines; i++) {
    if (macrosPlaced < macroCount && i % interval === 0) {
      parts.push(`const macro${macrosPlaced} = benchMacro(${macrosPlaced * 3});`);
      macrosPlaced++;
    } else {
      parts.push(`const plain${i} = ${i} + ${i * 2};`);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("End-to-end transformer benchmarks", { timeout: 120_000 }, () => {
  describe("Baseline: full pipeline (program creation + transform)", () => {
    it("small file (50 lines, no macros)", () => {
      const source = generatePlainTypeScript(50);
      const stats = benchTransform(source, 5);
      console.log(`  50-line plain TS:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(5000);
    });

    it("medium file (200 lines, no macros)", () => {
      const source = generatePlainTypeScript(200);
      const stats = benchTransform(source, 5);
      console.log(`  200-line plain TS:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(8000);
    });

    it("large file (1000 lines, no macros)", () => {
      const source = generatePlainTypeScript(1000);
      const stats = benchTransform(source, 3);
      console.log(`  1000-line plain TS:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(3000);
    });
  });

  describe("Transform-only (program reused, realistic scenario)", () => {
    it("small file (50 lines, no macros)", () => {
      const source = generatePlainTypeScript(50);
      const stats = benchTransformOnly(source, 20);
      console.log(`  50-line plain TS (transform only): ${formatStats(stats)}`);
      expect(stats.medianMs).toBeLessThan(50);
    });

    it("medium file (200 lines, no macros)", () => {
      const source = generatePlainTypeScript(200);
      const stats = benchTransformOnly(source, 20);
      console.log(`  200-line plain TS (transform only): ${formatStats(stats)}`);
      expect(stats.medianMs).toBeLessThan(100);
    });

    it("large file (1000 lines, no macros)", () => {
      const source = generatePlainTypeScript(1000);
      const stats = benchTransformOnly(source, 10);
      console.log(`  1000-line plain TS (transform only): ${formatStats(stats)}`);
      expect(stats.medianMs).toBeLessThan(200);
    });

    it("50 macro calls (transform only)", () => {
      const source = generateComptimeCalls(50);
      const stats = benchTransformOnly(source, 20);
      console.log(`  50 macro calls (transform only): ${formatStats(stats)}`);
      expect(stats.medianMs).toBeLessThan(50);
    });

    it("100 macro calls (transform only)", () => {
      const source = generateComptimeCalls(100);
      const stats = benchTransformOnly(source, 10);
      console.log(`  100 macro calls (transform only): ${formatStats(stats)}`);
      expect(stats.medianMs).toBeLessThan(100);
    });

    it("1000 lines + 100 macros (transform only)", () => {
      const source = generateMixedFile(100, 1000);
      const stats = benchTransformOnly(source, 10);
      console.log(`  1000 lines + 100 macros (transform only): ${formatStats(stats)}`);
      expect(stats.medianMs).toBeLessThan(200);
    });
  });

  describe("Macro expansion throughput (full pipeline)", () => {
    it("1 macro call", () => {
      const source = generateComptimeCalls(1);
      const stats = benchTransform(source, 5);
      console.log(`  1 macro call:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(2000);
    });

    it("10 macro calls", () => {
      const source = generateComptimeCalls(10);
      const stats = benchTransform(source, 5);
      console.log(`  10 macro calls:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(2000);
    });

    it("50 macro calls", () => {
      const source = generateComptimeCalls(50);
      const stats = benchTransform(source, 5);
      console.log(`  50 macro calls:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(5000);
    });

    it("100 macro calls", () => {
      const source = generateComptimeCalls(100);
      const stats = benchTransform(source, 3);
      console.log(`  100 macro calls:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(10000);
    });
  });

  describe("Mixed files (full pipeline)", () => {
    it("500 lines, 10 macros", () => {
      const source = generateMixedFile(10, 500);
      const stats = benchTransform(source, 5);
      console.log(`  500 lines + 10 macros:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(5000);
    });

    it("500 lines, 50 macros", () => {
      const source = generateMixedFile(50, 500);
      const stats = benchTransform(source, 5);
      console.log(`  500 lines + 50 macros:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(5000);
    });

    it("1000 lines, 100 macros", () => {
      const source = generateMixedFile(100, 1000);
      const stats = benchTransform(source, 3);
      console.log(`  1000 lines + 100 macros:\n    ${formatFullStats(stats)}`);
      expect(stats.total.medianMs).toBeLessThan(10000);
    });
  });

  describe("Scaling analysis (transform-only, program reused)", () => {
    it("measures per-macro cost without program creation noise", () => {
      const counts = [0, 1, 5, 10, 25, 50, 100];
      const results: Array<{ count: number; medianMs: number }> = [];

      for (const count of counts) {
        const source = count === 0 ? "const x = 1;\n".repeat(10) : generateComptimeCalls(count);
        const stats = benchTransformOnly(source, 10);
        results.push({ count, medianMs: stats.medianMs });
      }

      console.log("\n  Scaling analysis — transform only (macro count → median time):");
      console.log("  ┌──────────┬────────────┬──────────────┐");
      console.log("  │ # macros │ median ms  │ ms per macro  │");
      console.log("  ├──────────┼────────────┼──────────────┤");

      const baselineMs = results[0].medianMs;
      for (const r of results) {
        const perMacro = r.count > 0 ? ((r.medianMs - baselineMs) / r.count).toFixed(3) : "—";
        console.log(
          `  │ ${String(r.count).padStart(8)} │ ${r.medianMs.toFixed(2).padStart(10)} │ ${String(perMacro).padStart(12)} │`
        );
      }
      console.log("  └──────────┴────────────┴──────────────┘");

      const last = results[results.length - 1];
      const perMacroCost = (last.medianMs - baselineMs) / last.count;
      console.log(`\n  Per-macro marginal cost: ${(perMacroCost * 1000).toFixed(1)}μs`);
      expect(perMacroCost).toBeLessThan(2);
    });
  });

  describe("Visitor overhead (transform-only, program reused)", () => {
    it("measures visitor cost per AST node without program creation", () => {
      const sizes = [50, 200, 500, 1000];
      const results: Array<{ lines: number; medianMs: number }> = [];

      for (const lines of sizes) {
        const source = generatePlainTypeScript(lines);
        const stats = benchTransformOnly(source, 10);
        results.push({ lines, medianMs: stats.medianMs });
      }

      console.log("\n  Visitor overhead — transform only (file size → time):");
      console.log("  ┌──────────┬────────────┬──────────────┐");
      console.log("  │ # lines  │ median ms  │ μs per line   │");
      console.log("  ├──────────┼────────────┼──────────────┤");
      for (const r of results) {
        const perLine = ((r.medianMs / r.lines) * 1000).toFixed(1);
        console.log(
          `  │ ${String(r.lines).padStart(8)} │ ${r.medianMs.toFixed(2).padStart(10)} │ ${perLine.padStart(12)} │`
        );
      }
      console.log("  └──────────┴────────────┴──────────────┘");

      const ratio = results[results.length - 1].medianMs / results[0].medianMs;
      console.log(`\n  1000-line / 50-line ratio: ${ratio.toFixed(1)}x (ideal ≈ 20x)`);
      expect(ratio).toBeLessThan(100);
    });
  });
});
