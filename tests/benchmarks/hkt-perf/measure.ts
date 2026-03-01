#!/usr/bin/env tsx
/**
 * HKT Encoding Compile-Time Benchmark
 *
 * Measures `tsc --noEmit` time for each HKT encoding approach.
 * This measures TYPE-CHECKING performance, not runtime performance.
 *
 * Usage: pnpm tsx tests/benchmarks/hkt-perf/measure.ts [--iterations N]
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const BENCHMARK_DIR = dirname(__filename);
const ENCODINGS = ["typesugar-encoding", "effect-encoding", "preprocessed"] as const;
const DEFAULT_ITERATIONS = 5;

interface BenchmarkResult {
  encoding: string;
  times: number[];
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

function measureTypeCheck(encoding: string, tscPath: string): number {
  const encodingDir = resolve(BENCHMARK_DIR, encoding);
  const tsconfig = resolve(encodingDir, "tsconfig.json");

  const start = performance.now();
  try {
    execSync(`${tscPath} --noEmit -p ${tsconfig}`, {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 60000,
    });
  } catch (e: unknown) {
    // Type errors result in exit code 2 - that's fine, we're measuring time
    const error = e as { status?: number; stderr?: string; stdout?: string };
    if (error.status !== 2 && error.stderr) {
      console.error(`Error in ${encoding}:`, error.stderr);
    }
  }
  const elapsed = performance.now() - start;

  return elapsed;
}

function calculateStats(times: number[]): Omit<BenchmarkResult, "encoding" | "times"> {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const median =
    times.length % 2 === 0
      ? (sorted[times.length / 2 - 1] + sorted[times.length / 2]) / 2
      : sorted[Math.floor(times.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const variance = times.reduce((acc, t) => acc + (t - mean) ** 2, 0) / times.length;
  const stdDev = Math.sqrt(variance);

  return { mean, median, min, max, stdDev };
}

function formatMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms.toFixed(0)}ms`;
}

function formatRelative(ms: number, baseline: number): string {
  const ratio = ms / baseline;
  if (ratio < 0.95) return `${((1 - ratio) * 100).toFixed(0)}% faster`;
  if (ratio > 1.05) return `${((ratio - 1) * 100).toFixed(0)}% slower`;
  return "~same";
}

async function main() {
  const args = process.argv.slice(2);
  const iterationsIdx = args.indexOf("--iterations");
  const iterations =
    iterationsIdx >= 0 ? parseInt(args[iterationsIdx + 1], 10) : DEFAULT_ITERATIONS;

  console.log("╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║              HKT Encoding COMPILE-TIME Benchmark                      ║");
  console.log("╠═══════════════════════════════════════════════════════════════════════╣");
  console.log(`║ Measuring: tsc --noEmit (type-checking, no code generation)           ║`);
  console.log(`║ Iterations: ${iterations.toString().padEnd(60)}║`);
  console.log("╚═══════════════════════════════════════════════════════════════════════╝");
  console.log();

  // Find tsc - use workspace root
  const workspaceRoot = resolve(BENCHMARK_DIR, "../../..");
  const tscPath = resolve(workspaceRoot, "node_modules/.bin/tsc");
  if (!existsSync(tscPath)) {
    console.error(`Error: tsc not found at ${tscPath}. Run \`pnpm install\` first.`);
    process.exit(1);
  }

  const version = execSync(`"${tscPath}" --version`, { encoding: "utf8" }).trim();
  console.log(`TypeScript: ${version}`);
  console.log(`Path: ${tscPath}`);
  console.log();

  // Warm-up run (important for accurate measurements)
  console.log("Warming up (first run is always slower)...");
  for (const encoding of ENCODINGS) {
    const time = measureTypeCheck(encoding, tscPath);
    console.log(`  ${encoding}: ${formatMs(time)}`);
  }
  console.log();

  // Benchmark runs
  const results: BenchmarkResult[] = [];

  for (const encoding of ENCODINGS) {
    console.log(`Benchmarking ${encoding}...`);
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const elapsed = measureTypeCheck(encoding, tscPath);
      times.push(elapsed);
      process.stdout.write(`  Run ${i + 1}/${iterations}: ${formatMs(elapsed)}    \r`);
    }
    console.log(`  Completed: ${times.map((t) => formatMs(t)).join(", ")}`);

    const stats = calculateStats(times);
    results.push({ encoding, times, ...stats });
  }

  // Results table
  console.log();
  console.log("═".repeat(80));
  console.log("RESULTS (lower is better)");
  console.log("═".repeat(80));
  console.log();

  // Find baseline (preprocessed = concrete types, no HKT)
  const baseline = results.find((r) => r.encoding === "preprocessed")!;

  console.log(
    "Encoding".padEnd(25) +
      "Mean".padStart(12) +
      "Median".padStart(12) +
      "StdDev".padStart(12) +
      "vs Preprocessed".padStart(18)
  );
  console.log("-".repeat(79));

  for (const r of results) {
    const relative =
      r.encoding === "preprocessed" ? "(baseline)" : formatRelative(r.median, baseline.median);

    console.log(
      r.encoding.padEnd(25) +
        formatMs(r.mean).padStart(12) +
        formatMs(r.median).padStart(12) +
        formatMs(r.stdDev).padStart(12) +
        relative.padStart(18)
    );
  }

  console.log();
  console.log("═".repeat(80));
  console.log();

  // Interpretation
  const typesugarResult = results.find((r) => r.encoding === "typesugar-encoding")!;
  const effectResult = results.find((r) => r.encoding === "effect-encoding")!;

  console.log("Interpretation:");
  console.log();
  console.log(`  PREPROCESSED (concrete types):     ${formatMs(baseline.median)}`);
  console.log(`    → This is what typesugar compiles TO (our target)`);
  console.log();
  console.log(`  TYPESUGAR HKT (Apply<F, A>):       ${formatMs(typesugarResult.median)}`);
  console.log(`    → ${formatRelative(typesugarResult.median, baseline.median)} than target`);
  console.log(`    → Uses conditional type in Apply<> for resolution`);
  console.log();
  console.log(`  EFFECT HKT (TypeLambda):           ${formatMs(effectResult.median)}`);
  console.log(`    → ${formatRelative(effectResult.median, baseline.median)} than target`);
  console.log(`    → Uses this-type unification + indexed access`);
  console.log();

  const typesugarOverhead = ((typesugarResult.median - baseline.median) / baseline.median) * 100;
  const effectOverhead = ((effectResult.median - baseline.median) / baseline.median) * 100;

  console.log("Key insight:");
  console.log(`  • typesugar HKT overhead: ~${typesugarOverhead.toFixed(0)}%`);
  console.log(`  • Effect HKT overhead: ~${effectOverhead.toFixed(0)}%`);
  console.log();
  console.log("  Both HKT encodings add type-checking overhead vs concrete types.");
  console.log("  typesugar's preprocessor eliminates this by rewriting to concrete types.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
