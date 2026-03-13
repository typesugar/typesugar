/**
 * Benchmark: oxc vs tsc parsing and codegen
 *
 * Compares the performance of oxc-engine's native transform
 * against TypeScript's createSourceFile + printer APIs.
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";

// Import the native binding directly
const oxcEngine = require("../oxc-engine.darwin-arm64.node");

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

function benchmarkOxc(
  source: string,
  filename: string,
  iterations: number
): BenchmarkResult {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    oxcEngine.transform(source, filename, {});
  }
  const totalMs = performance.now() - start;
  return {
    name: "oxc",
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

function benchmarkTsc(
  source: string,
  filename: string,
  iterations: number
): BenchmarkResult {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const sourceFile = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    printer.printFile(sourceFile);
  }
  const totalMs = performance.now() - start;
  return {
    name: "tsc",
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

function formatResult(result: BenchmarkResult): string {
  return `${result.name.padEnd(8)} | ${result.avgMs.toFixed(3).padStart(8)} ms | ${result.opsPerSec.toFixed(0).padStart(8)} ops/sec`;
}

const TEST_CASES = [
  {
    name: "Simple const",
    source: `const x: number = 42;`,
    iterations: 1000,
  },
  {
    name: "Function",
    source: `
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`,
    iterations: 1000,
  },
  {
    name: "Class",
    source: `
interface Greeter {
  greet(name: string): string;
}

class FormalGreeter implements Greeter {
  private prefix: string;
  
  constructor(prefix: string = "Dear") {
    this.prefix = prefix;
  }
  
  greet(name: string): string {
    return \`\${this.prefix} \${name}, how do you do?\`;
  }
}
`,
    iterations: 500,
  },
  {
    name: "__binop__ (preprocessed .sts)",
    source: `
const result = __binop__(__binop__(1, "|>", double), "|>", square);
const list = __binop__(1, "::", __binop__(2, "::", __binop__(3, "::", [])));
`,
    iterations: 1000,
  },
];

async function runBenchmarks() {
  console.log("=".repeat(60));
  console.log("oxc-engine vs tsc Benchmark");
  console.log("=".repeat(60));
  console.log("");

  for (const testCase of TEST_CASES) {
    console.log(`\n## ${testCase.name}`);
    console.log("-".repeat(40));

    const oxcResult = benchmarkOxc(
      testCase.source,
      "test.ts",
      testCase.iterations
    );
    const tscResult = benchmarkTsc(
      testCase.source,
      "test.ts",
      testCase.iterations
    );

    console.log(formatResult(oxcResult));
    console.log(formatResult(tscResult));

    const speedup = tscResult.avgMs / oxcResult.avgMs;
    console.log(`\noxc is ${speedup.toFixed(2)}x ${speedup > 1 ? "faster" : "slower"} than tsc`);
  }

  // Verify oxc parses preprocessed .sts correctly
  console.log("\n\n## Verification: preprocessed .sts parsing");
  console.log("-".repeat(40));

  const stsCode = `
// Preprocessed pipeline operators
const doubled = __binop__(value, "|>", double);
const tripled = __binop__(__binop__(value, "|>", double), "|>", addOne);

// Preprocessed cons operators  
const list = __binop__(1, "::", __binop__(2, "::", __binop__(3, "::", [])));

// Preprocessed HKT
type Kind<F, A> = { _F: F; _A: A };
const mapped: Kind<F, B> = map(fa)(f);
`;

  const result = oxcEngine.transform(stsCode, "test.ts", {});
  if (result.diagnostics.length === 0) {
    console.log("✓ Preprocessed .sts content parses successfully");
    console.log("✓ __binop__() calls are valid TypeScript");
    console.log("✓ Kind<F, A> type alias is valid TypeScript");
  } else {
    console.log("✗ Parse errors:");
    for (const d of result.diagnostics) {
      console.log(`  - ${d.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Benchmark complete");
  console.log("=".repeat(60));
}

runBenchmarks().catch(console.error);
