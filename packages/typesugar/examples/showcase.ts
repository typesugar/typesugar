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

// The umbrella's runtime entry ("typesugar") is TypeScript-free: the macro
// call stubs, the derive markers, defineConfig, and core's TYPES. The value
// APIs of @typesugar/core (config, the registries, diagnostics) load the
// compiler and live at "typesugar/core".
import {
  // Runtime stubs: the transformer replaces these calls at compile time
  comptime,
  reflect,
  typeclass,
  summon,
  implicit,
  pipe,
  compose,
  derive,
  Eq,
  Clone,
  defineConfig,
  registerAllMacros,

  // Types from core (re-exported as types only)
  type MacroContext,
  type MacroKind,
  type TypesugarConfig,
} from "typesugar";

import {
  config,
  invariant,
  unreachable,
  debugOnly,
  globalRegistry,
  defineExpressionMacro,
  DiagnosticBuilder,
  DiagnosticCategory,
  DIAGNOSTIC_CATALOG,
  createGenericRegistry,
} from "typesugar/core";

// ============================================================================
// 1. ONE PACKAGE - Runtime Stubs From "typesugar", Core APIs From "typesugar/core"
// ============================================================================

// "typesugar/core" re-exports all of @typesugar/core
assert(config !== undefined, "config from @typesugar/core");
assert(globalRegistry !== undefined, "globalRegistry from @typesugar/core");
assert(typeof defineExpressionMacro === "function", "defineExpressionMacro from @typesugar/core");
assert(typeof invariant === "function", "invariant from @typesugar/core");
assert(typeof unreachable === "function", "unreachable from @typesugar/core");
assert(typeof debugOnly === "function", "debugOnly from @typesugar/core");
assert(typeof DiagnosticBuilder === "function", "DiagnosticBuilder from @typesugar/core");
assert(DiagnosticCategory.TypeclassResolution === "typeclass");
assert(DIAGNOSTIC_CATALOG.size > 0, "Diagnostics catalog from @typesugar/core");

// Types are available from "typesugar" itself
typeAssert<Extends<"expression", MacroKind>>();
typeAssert<Extends<{ debug?: boolean }, TypesugarConfig>>();
typeAssert<Not<Equal<MacroContext, unknown>>>();

// ============================================================================
// 2. RUNTIME STUBS - Placeholders the Transformer Replaces
// ============================================================================

// Runtime stubs are the direct imports; a call left unexpanded throws, saying
// the transformer isn't configured
assert(typeof comptime === "function", "comptime runtime stub");
assert(typeof reflect === "function", "reflect runtime stub");
assert(typeof typeclass === "function", "typeclass runtime stub");
assert(typeof summon === "function", "summon runtime stub");
assert(typeof implicit === "function", "implicit runtime stub");

// The derive markers are values too (`@derive(Eq, Clone)`), and the types of
// their typeclasses
assert(Eq !== undefined && Clone !== undefined);

// ============================================================================
// 3. MACRO REGISTRATION - Done by the Transformer
// ============================================================================

// The transformer loads macro packages itself (every @typesugar/* package's
// "typesugar.macros" entry); importing "typesugar" registers nothing.
// registerAllMacros() is a deprecated no-op kept for old callers.
assert(typeof registerAllMacros === "function");
registerAllMacros();

// ============================================================================
// 4. DIRECT CALLABLE MACROS - No Namespace Needed
// ============================================================================

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

// comptime — runtime stub for compile-time evaluation
// At compile time, comptime(() => expr) evaluates expr and inlines the result
assert(typeof comptime === "function");

// ============================================================================
// 5. DERIVE DECORATOR PLACEHOLDER - Runtime Stub for Compile-Time
// ============================================================================

// The derive() function is a runtime placeholder that the transformer replaces
assert(typeof derive === "function");

// At compile time, @derive(Eq, Clone) triggers macro expansion
// At runtime, the decorator is a no-op (returns the class unchanged)

// Usage pattern:
//
// @derive(Eq, Clone, Debug)
// interface Point { x: number; y: number; }
//
// This generates at compile time the companion instances
//   Point.Eq, Point.Clone, Point.Debug
// (Point.Eq.equals(a, b), Point.Clone.clone(p), Point.Debug.debug(p)).

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
//   import { derive, Eq, Debug, Clone, pipe } from "typesugar";
//   import { invariant } from "typesugar/core";
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
// import { ... } from "typesugar";             → Macro stubs, derive markers, types

// ============================================================================
// 8. CONFIGURATION THROUGH THE UMBRELLA - Config API Works Too
// ============================================================================

// Configuration is available from "typesugar/core"
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
