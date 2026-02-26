/**
 * @typesugar/core Showcase
 *
 * Self-documenting examples of the macro system infrastructure.
 * This package provides the foundational APIs that all other
 * typesugar packages build on: macro registration, configuration,
 * diagnostics, resolution scoping, and runtime safety primitives.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Macro registration
  defineExpressionMacro,
  globalRegistry,
  type MacroKind,

  // Configuration system
  config,
  defineConfig,
  type TypesugarConfig,

  // Runtime safety primitives
  invariant,
  unreachable,
  debugOnly,

  // Diagnostics
  DiagnosticCategory,
  DIAGNOSTIC_CATALOG,
  getDiagnosticDescriptor,
  getDiagnosticsByCategory,
  renderDiagnosticCLI,
  type RichDiagnostic,

  // Generic Registry
  createGenericRegistry,

  // Resolution scope
  ResolutionScopeTracker,

  // Prelude
  DEFAULT_PRELUDE,
  isPreludeMethod,
  isPreludeOperator,
  METHOD_TO_TYPECLASS,
  OPERATOR_TO_TYPECLASS,

  // Import suggestions
  registerExport,
  getSuggestionsForSymbol,
  formatSuggestionsMessage,

  // Coherence checking
  CoherenceChecker,
  SOURCE_PRIORITY,

  // Resolution tracing
  ResolutionTracer,
  formatResolutionTrace,

  // Source map
  ExpansionTracker,
  globalExpansionTracker,

  // Operator symbols
  OPERATOR_SYMBOLS,
  type OperatorSymbol,
  type Op,
} from "../src/index.js";

// ============================================================================
// 1. MACRO REGISTRATION - Defining Compile-Time Macros
// ============================================================================

// The 6 macro kinds correspond to different syntactic triggers
typeAssert<
  Equal<
    MacroKind,
    "expression" | "attribute" | "derive" | "tagged-template" | "type" | "labeled-block"
  >
>();

// Expression macros are triggered by function calls: macroName(...)
const myMacro = defineExpressionMacro({
  name: "myShowcase",
  module: undefined,
  description: "A showcase expression macro",
  expand(_ctx, callExpr, _args) {
    return callExpr;
  },
});

assert(myMacro.name === "myShowcase");
assert(myMacro.kind === "expression");

// Register the macro with the global registry
globalRegistry.register(myMacro);

// The global registry stores all registered macros
const registered = globalRegistry.getExpression("myShowcase");
assert(registered !== undefined);
assert(registered!.name === "myShowcase");

// Macros can be looked up by kind
const allMacros = globalRegistry.getAll();
assert(allMacros.length > 0);

// ============================================================================
// 2. CONFIGURATION SYSTEM - Unified Config API
// ============================================================================

// Configuration is accessed via dot-notation paths
config.reset();
config.set({ debug: true, contracts: { mode: "full" } });

assert(config.get("debug") === true);
assert(config.get("contracts.mode") === "full");
assert(config.has("debug") === true);
assert(config.has("nonexistent") === false);

// Condition evaluation for compile-time branching
assert(config.evaluate("debug") === true);
assert(config.evaluate("!debug") === false);
assert(config.evaluate("debug && contracts.mode == 'full'") === true);
assert(config.evaluate("debug || nonexistent") === true);

// Conditional values — compile-time if/else
const debugValue = config.when("debug", "debug-mode", "release-mode");
assert(debugValue === "debug-mode");

config.set({ debug: false });
const releaseValue = config.when("debug", "debug-mode", "release-mode");
assert(releaseValue === "release-mode");

// Resolution mode per file
assert(config.getResolutionModeForFile("src/main.ts") === "automatic");

// Prelude typeclasses are available without import in automatic mode
assert(config.isInPrelude("Eq") === true);
assert(config.isInPrelude("Show") === true);
assert(config.isInPrelude("CustomTypeclass") === false);

// defineConfig provides type-safe config authoring
const userConfig: TypesugarConfig = defineConfig({
  debug: false,
  contracts: { mode: "assertions", proveAtCompileTime: true },
  features: { experimental: true },
});
typeAssert<Equal<typeof userConfig, TypesugarConfig>>();

config.reset();

// ============================================================================
// 3. RUNTIME SAFETY PRIMITIVES - invariant, unreachable, debugOnly
// ============================================================================

// invariant — asserts a condition at runtime, strippable in production
invariant(1 + 1 === 2, "Math should work");
invariant(typeof "hello" === "string");

let invariantFailed = false;
try {
  invariant(false, "This should throw");
} catch (e) {
  invariantFailed = true;
  assert((e as Error).message === "This should throw");
}
assert(invariantFailed);

// unreachable — marks code paths that should never execute
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.side ** 2;
    default:
      unreachable(shape);
  }
}

assert(area({ kind: "circle", radius: 1 }) === Math.PI);
assert(area({ kind: "square", side: 2 }) === 4);

// debugOnly — code that only runs in development, erased in production
let debugRan = false;
debugOnly(() => {
  debugRan = true;
});
assert(debugRan === true);

// ============================================================================
// 4. DIAGNOSTICS SYSTEM - Rust-Quality Error Messages
// ============================================================================

// Diagnostics are organized in a catalog with structured error codes
const noInstanceError = getDiagnosticDescriptor(9001);
assert(noInstanceError !== undefined);
assert(noInstanceError!.code === 9001);
assert(noInstanceError!.severity === "error");
assert(noInstanceError!.category === DiagnosticCategory.TypeclassResolution);

// Get all diagnostics for a category
const typeclassErrors = getDiagnosticsByCategory(DiagnosticCategory.TypeclassResolution);
assert(typeclassErrors.length > 0);

const deriveErrors = getDiagnosticsByCategory(DiagnosticCategory.DeriveFailed);
assert(deriveErrors.length > 0);

// The full catalog covers all error ranges
assert(DIAGNOSTIC_CATALOG.size > 40);

// Diagnostic categories cover all subsystems
typeAssert<Extends<"typeclass" | "syntax" | "expansion" | "derive", DiagnosticCategory>>();

// RichDiagnostic supports labeled spans, notes, help, and code suggestions
const mockDiagnostic: RichDiagnostic = {
  code: 9001,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  message: 'No instance found for `Eq<Point>`',
  labels: [],
  notes: ["Auto-derivation requires Eq instances for all fields"],
  help: "Add @derive(Eq) to Point",
  suggestions: [],
};

const rendered = renderDiagnosticCLI(mockDiagnostic, { colors: false });
assert(rendered.includes("TS9001"));
assert(rendered.includes("Eq<Point>"));
assert(rendered.includes("@derive(Eq)"));

// ============================================================================
// 5. GENERIC REGISTRY - Reusable Registry Abstraction
// ============================================================================

// Simple registry with error on duplicates (default)
const typeRegistry = createGenericRegistry<string, { name: string; fields: string[] }>({
  name: "TypeRegistry",
});

typeRegistry.set("Point", { name: "Point", fields: ["x", "y"] });
typeRegistry.set("Color", { name: "Color", fields: ["r", "g", "b"] });

assert(typeRegistry.has("Point"));
assert(typeRegistry.get("Point")!.fields.length === 2);

// Registry with "skip" strategy — silently ignores duplicates
const skipRegistry = createGenericRegistry<string, number>({
  duplicateStrategy: "skip",
  name: "SkipRegistry",
});

skipRegistry.set("a", 1);
skipRegistry.set("a", 2);
assert(skipRegistry.get("a") === 1);

// Registry with "replace" strategy — overwrites existing
const replaceRegistry = createGenericRegistry<string, number>({
  duplicateStrategy: "replace",
  name: "ReplaceRegistry",
});

replaceRegistry.set("a", 1);
replaceRegistry.set("a", 2);
assert(replaceRegistry.get("a") === 2);

// Registry with "merge" strategy — combines entries
const mergeRegistry = createGenericRegistry<string, string[]>({
  duplicateStrategy: "merge",
  merge: (existing, incoming) => [...existing, ...incoming],
  name: "MergeRegistry",
});

mergeRegistry.set("tags", ["a", "b"]);
mergeRegistry.set("tags", ["c"]);
assert(mergeRegistry.get("tags")!.length === 3);

// Registries are iterable
let count = 0;
for (const [_key, _value] of typeRegistry) {
  count++;
}
assert(count === 2);

// ============================================================================
// 6. PRELUDE SYSTEM - Typeclasses Available Without Import
// ============================================================================

// The default prelude includes the most commonly used typeclasses
// DEFAULT_PRELUDE is an array of PreludeEntry objects
assert(DEFAULT_PRELUDE.length > 0);
assert(DEFAULT_PRELUDE.some((e) => e.name === "Eq"));
assert(DEFAULT_PRELUDE.some((e) => e.name === "Ord"));
assert(DEFAULT_PRELUDE.some((e) => e.name === "Show"));
assert(DEFAULT_PRELUDE.some((e) => e.name === "Clone"));

// METHOD_TO_TYPECLASS and OPERATOR_TO_TYPECLASS are Maps
assert(METHOD_TO_TYPECLASS.get("show") === "Show");
assert(METHOD_TO_TYPECLASS.get("clone") === "Clone");
assert(METHOD_TO_TYPECLASS.get("equals") === "Eq");

// Operator-to-typeclass mapping
assert(OPERATOR_TO_TYPECLASS.get("===") === "Eq");
assert(OPERATOR_TO_TYPECLASS.get("<") === "Ord");
// Note: "+" is mapped to Semigroup's combine, not Numeric
// assert(OPERATOR_TO_TYPECLASS.get("+") === "Numeric");

// Quick checks — isPreludeMethod returns PreludeEntry | undefined, not boolean
assert(isPreludeMethod("show") !== undefined);
assert(isPreludeMethod("nonExistentMethod") === undefined);
assert(isPreludeOperator("===") !== undefined);

// ============================================================================
// 7. OPERATOR SYMBOLS - Standard JS Operators for Typeclass Dispatch
// ============================================================================

// OPERATOR_SYMBOLS lists all operators handled by the typeclass system
assert(OPERATOR_SYMBOLS.length > 0);
assert(OPERATOR_SYMBOLS.includes("+"));
assert(OPERATOR_SYMBOLS.includes("==="));
assert(OPERATOR_SYMBOLS.includes("<"));

typeAssert<Extends<"+", OperatorSymbol>>();
typeAssert<Extends<"===", OperatorSymbol>>();

// Op<S> is the branded return type that triggers operator rewriting
// When a typeclass method returns Op<"+">, the transformer rewrites a + b
// to typeclassInstance.methodName(a, b)
type AddResult = Op<"+">;
type EqResult = Op<"===">;
typeAssert<Not<Equal<AddResult, EqResult>>>();

// ============================================================================
// 8. IMPORT SUGGESTIONS - "Did You Mean?" for Missing Symbols
// ============================================================================

// Register known exports for suggestion lookups
registerExport({
  name: "ShowcaseType",
  module: "@typesugar/showcase",
  kind: "type",
});

const suggestions = getSuggestionsForSymbol("ShowcaseType");
assert(suggestions.length > 0);
assert(suggestions[0].module === "@typesugar/showcase");

const formatted = formatSuggestionsMessage(suggestions);
assert(formatted !== undefined);
assert(formatted!.includes("@typesugar/showcase"));

// ============================================================================
// 9. COHERENCE CHECKING - Orphan Instance Detection
// ============================================================================

// CoherenceChecker detects conflicting typeclass instances
const checker = new CoherenceChecker();

// Register first instance — no conflict yet
const firstConflict = checker.registerInstance({
  typeclass: "Eq",
  forType: "Point",
  source: "derived",
  fileName: "src/point.ts",
  line: 10,
  column: 0,
});
assert(firstConflict === undefined);

// Register second instance for same (typeclass, type) — conflict!
const secondConflict = checker.registerInstance({
  typeclass: "Eq",
  forType: "Point",
  source: "explicit",
  fileName: "src/point-eq.ts",
  line: 5,
  column: 0,
});

// Different priorities (explicit vs derived) creates a conflict warning
// Explicit wins but we get a warning about shadowing
// (Same priority would be an error)

// Priority order: explicit < derived < auto-derived < library (lower = higher priority)
assert(SOURCE_PRIORITY.explicit < SOURCE_PRIORITY.derived);
assert(SOURCE_PRIORITY.derived < SOURCE_PRIORITY["auto-derived"]);

// ============================================================================
// 10. RESOLUTION TRACING - Debug Why Resolution Succeeded or Failed
// ============================================================================

// formatResolutionTrace formats a ResolutionTrace (plain data) into diagnostic lines
// ResolutionTracer is used internally by the transformer with actual AST nodes
const mockTrace = {
  sought: "Eq<Point>",
  attempts: [
    { step: "explicit instance lookup", target: "Eq<Point>", result: "not-found" as const },
    {
      step: "auto-derive via Mirror",
      target: "Eq<Point>",
      result: "found" as const,
      children: [
        { step: "check field", target: "x: number", result: "found" as const },
        { step: "check field", target: "y: number", result: "found" as const },
      ],
    },
  ],
  finalResult: "resolved" as const,
};

const traceOutput = formatResolutionTrace(mockTrace);
assert(traceOutput.length > 0);
assert(traceOutput.some((line) => line.includes("Eq<Point>")));

// ResolutionTracer requires ts.Node objects so it's used internally by the transformer
// The class exists and can be instantiated (tracing is controlled by config.tracing)
const tracer = new ResolutionTracer();
typeAssert<Equal<typeof tracer.formatForCLI, (fileName?: string) => string>>();

// ============================================================================
// 11. EXPANSION TRACKING - Source Map Support for Macros
// ============================================================================

// ExpansionTracker records what macros expanded where (for source maps)
// The recordExpansion method requires ts.Node and ts.SourceFile objects,
// so it's used internally by the transformer, not directly in user code
const expansionTracker = new ExpansionTracker();

// The tracker provides these methods:
assert(typeof expansionTracker.getExpansionsForFile === "function");
assert(typeof expansionTracker.getAllExpansions === "function");
assert(typeof expansionTracker.generateSourceMap === "function");
assert(expansionTracker.count === 0);

// globalExpansionTracker is the singleton used by the transformer
typeAssert<Equal<typeof globalExpansionTracker, ExpansionTracker>>();

// ============================================================================
// 12. RESOLUTION SCOPE - Opt-Out Directives
// ============================================================================

// ResolutionScopeTracker manages per-file opt-out state
const scopeTracker = new ResolutionScopeTracker();

// Files can opt out of all typesugar processing
scopeTracker.setOptedOut("src/vanilla.ts", true);
const vanillaScope = scopeTracker.getScope("src/vanilla.ts");
assert(vanillaScope.optedOut === true);

// Files can opt out of specific features
scopeTracker.addOptedOutFeature("src/partial.ts", "extensions");
const partialScope = scopeTracker.getScope("src/partial.ts");
assert(partialScope.optedOut === false);
assert(scopeTracker.isFeatureOptedOut("src/partial.ts", "extensions") === true);

console.log("✓ All @typesugar/core showcase assertions passed");
