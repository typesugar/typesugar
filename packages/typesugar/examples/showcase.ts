/**
 * typesugar Showcase
 *
 * Self-documenting examples of the umbrella package. The `typesugar`
 * package re-exports everything from @typesugar/core plus provides
 * convenient access to all built-in macro namespaces (comptime, reflect,
 * derive, operators, typeclass, specialize) and commonly-used callables.
 *
 * This is the "batteries included" entry point — one import gives you
 * everything you need.
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
  // ======================================================================
  // Re-exported from @typesugar/core — full macro infrastructure
  // ======================================================================
  config,
  defineConfig,
  invariant,
  unreachable,
  debugOnly,
  globalRegistry,
  defineExpressionMacro,
  DiagnosticBuilder,
  DiagnosticCategory,
  DIAGNOSTIC_CATALOG,
  createGenericRegistry,
  OPERATOR_SYMBOLS,

  // ======================================================================
  // Macro namespace re-exports — access each subsystem
  // ======================================================================
  comptime,
  reflect,
  deriveMacros,
  operators,
  typeclass,
  specialize,

  // ======================================================================
  // Direct callable re-exports — commonly used macros
  // ======================================================================
  ops,
  pipe,
  compose,
  comptimeEval,

  // ======================================================================
  // Decorator placeholder
  // ======================================================================
  derive,
  deriveDecorator,

  // ======================================================================
  // Registration
  // ======================================================================
  registerAllMacros,

  // ======================================================================
  // Types from core (re-exported for convenience)
  // ======================================================================
  type MacroContext,
  type MacroKind,
  type TypesugarConfig,
  type Op,
} from "../src/index.js";

// ============================================================================
// 1. ONE IMPORT TO RULE THEM ALL - Everything From One Package
// ============================================================================

// The umbrella re-exports all of @typesugar/core
assert(config !== undefined, "config from @typesugar/core");
assert(globalRegistry !== undefined, "globalRegistry from @typesugar/core");
assert(typeof defineExpressionMacro === "function", "defineExpressionMacro from @typesugar/core");
assert(typeof invariant === "function", "invariant from @typesugar/core");
assert(typeof unreachable === "function", "unreachable from @typesugar/core");
assert(typeof debugOnly === "function", "debugOnly from @typesugar/core");
assert(DIAGNOSTIC_CATALOG.size > 0, "Diagnostics catalog from @typesugar/core");
assert(OPERATOR_SYMBOLS.length > 0, "Operator symbols from @typesugar/core");

// Types are also available
typeAssert<Extends<"expression", MacroKind>>();
typeAssert<Extends<{ debug?: boolean }, TypesugarConfig>>();

// ============================================================================
// 2. MACRO NAMESPACES - Organized Access to Each Subsystem
// ============================================================================

// Each built-in macro module is available as a namespace
assert(comptime !== undefined, "comptime namespace");
assert(reflect !== undefined, "reflect namespace");
assert(deriveMacros !== undefined, "derive macros namespace");
assert(operators !== undefined, "operators namespace");
assert(typeclass !== undefined, "typeclass namespace");
assert(specialize !== undefined, "specialize namespace");

// Each namespace has a register() function
assert(typeof comptime.register === "function");
assert(typeof reflect.register === "function");
assert(typeof deriveMacros.register === "function");
assert(typeof operators.register === "function");
assert(typeof typeclass.register === "function");
assert(typeof specialize.register === "function");

// ============================================================================
// 3. REGISTER ALL MACROS - One Call to Enable Everything
// ============================================================================

// registerAllMacros() enables all built-in macros at once
assert(typeof registerAllMacros === "function");
registerAllMacros();

// After registration, macros are available in the global registry
assert(globalRegistry.getAll().length > 0, "Macros are registered");

// ============================================================================
// 4. DIRECT CALLABLE MACROS - No Namespace Needed
// ============================================================================

// ops() — wraps an expression for operator overloading
assert(typeof ops === "function");

// pipe() — left-to-right function composition
assert(typeof pipe === "function");

const piped = pipe(10, (x: number) => x * 2, (x: number) => x + 1);
assert(piped === 21);

// compose() — right-to-left function composition
assert(typeof compose === "function");

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;
const composed = compose(addOne, double);
assert(composed(5) === 11); // addOne(double(5)) = 11

// comptimeEval — direct reference to the comptime function
assert(typeof comptimeEval === "function");

// ============================================================================
// 5. DERIVE DECORATOR PLACEHOLDER - Runtime Stub for Compile-Time
// ============================================================================

// The derive() function is a runtime placeholder that the transformer replaces
assert(typeof derive === "function");
assert(typeof deriveDecorator === "function");

// At compile time, @derive(Eq, Clone) triggers macro expansion
// At runtime, the decorator is a no-op (returns the class unchanged)

// Usage pattern:
//
// @derive(Eq, Clone, Debug)
// interface Point { x: number; y: number; }
//
// This generates at compile time:
//   pointEquals(a: Point, b: Point): boolean
//   clonePoint(p: Point): Point
//   debugPoint(p: Point): string

// ============================================================================
// 6. QUICK START - How Users Get Started
// ============================================================================

// Step 1: Install
//   npm install typesugar

// Step 2: Configure tsconfig.json (for ts-patch)
//   {
//     "compilerOptions": {
//       "plugins": [{
//         "transform": "@typesugar/transformer"
//       }]
//     }
//   }

// Step 3: Or configure your bundler (for unplugin)
//   // vite.config.ts
//   import typesugar from "typesugar/vite";
//   export default { plugins: [typesugar()] };

// Step 4: Write code with macros
//   import { derive, pipe, invariant } from "typesugar";
//
//   @derive(Eq, Debug, Clone)
//   interface User {
//     name: string;
//     email: string;
//   }
//
//   const process = pipe(
//     rawData,
//     parse,
//     validate,
//     transform,
//   );
//
//   invariant(user.email.includes("@"), "Invalid email");

// ============================================================================
// 7. BUNDLER ENTRY POINTS - Multiple Export Paths
// ============================================================================

// The typesugar package provides bundler-specific entry points:
//
// import typesugar from "typesugar/vite";      → Vite plugin
// import typesugar from "typesugar/webpack";   → Webpack plugin
// import typesugar from "typesugar/esbuild";   → esbuild plugin
// import typesugar from "typesugar/rollup";    → Rollup plugin
// import { ... } from "typesugar/core";        → Core APIs only
// import { ... } from "typesugar/transformer"; → Transformer only
// import { ... } from "typesugar";             → Everything (default)

// ============================================================================
// 8. CONFIGURATION THROUGH THE UMBRELLA - Config API Works Too
// ============================================================================

// Configuration is available directly from the umbrella import
config.reset();
config.set({
  debug: false,
  contracts: { mode: "full", proveAtCompileTime: true },
});

assert(config.get("contracts.mode") === "full");
assert(config.get("contracts.proveAtCompileTime") === true);

// defineConfig provides type safety for config files
const myConfig = defineConfig({
  debug: process.env.NODE_ENV !== "production",
  contracts: { mode: "assertions" },
  features: { experimental: true },
});
typeAssert<Equal<typeof myConfig, TypesugarConfig>>();

config.reset();

// ============================================================================
// 9. GENERIC REGISTRY - Available From Umbrella Too
// ============================================================================

// The generic registry abstraction is useful for custom tool authors
const myRegistry = createGenericRegistry<string, number>({
  name: "MyToolRegistry",
  duplicateStrategy: "replace",
});

myRegistry.set("counter", 0);
myRegistry.set("counter", 1);
assert(myRegistry.get("counter") === 1);

console.log("✓ All typesugar umbrella showcase assertions passed");
