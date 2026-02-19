/**
 * Examples Index
 *
 * Re-exports all example modules.
 *
 * Each example demonstrates different aspects of the @ttfx/fp system:
 *
 * - validation-pipeline: Error accumulation with Validated/ValidatedNel
 * - console-app: Interactive console app with IO, Ref, and State
 * - http-service: Dependency injection with Reader, error handling with Either
 * - state-machine-parser: Parser combinators using State monad
 */

export * from "./validation-pipeline";
export * from "./console-app";
export * from "./http-service";
export * from "./state-machine-parser";

// ============================================================================
// Run All Examples
// ============================================================================

import { runValidationExample } from "./validation-pipeline";
import { runDemo } from "./console-app";
import { runHttpServiceExample } from "./http-service";
import { runParserExample } from "./state-machine-parser";

/**
 * Run all examples (sync ones only, to avoid async complications)
 */
export function runAllExamples(): void {
  console.log(
    "╔═══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║                @ttfx/fp EXAMPLES                        ║",
  );
  console.log(
    "╚═══════════════════════════════════════════════════════════════╝",
  );
  console.log("");

  // Validation pipeline (sync)
  runValidationExample();
  console.log("\n");

  // Parser example (sync)
  runParserExample();
  console.log("\n");

  console.log("For interactive examples, run individually:");
  console.log("  - runDemo() for Console App demo");
  console.log("  - runHttpServiceExample() for HTTP Service example");
}

/**
 * Run all examples including async
 */
export async function runAllExamplesAsync(): Promise<void> {
  console.log(
    "╔═══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║                @ttfx/fp EXAMPLES                        ║",
  );
  console.log(
    "╚═══════════════════════════════════════════════════════════════╝",
  );
  console.log("");

  // Validation pipeline
  runValidationExample();
  console.log("\n");

  // Parser example
  runParserExample();
  console.log("\n");

  // HTTP Service example (async)
  await runHttpServiceExample();
  console.log("\n");

  // Console app demo (has IO effects)
  runDemo();
}
