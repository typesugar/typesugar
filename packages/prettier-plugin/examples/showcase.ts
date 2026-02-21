/**
 * @typesugar/prettier-plugin Showcase
 *
 * Configuration guide and feature reference for the typesugar Prettier plugin.
 *
 * The plugin prevents Prettier from crashing on typesugar custom syntax
 * (|>, ::, F<_>) and optionally preserves that syntax through formatting.
 *
 * Install: npm install @typesugar/prettier-plugin
 */

// ============================================================================
// 1. BASIC SETUP — Prevent Prettier from crashing
// ============================================================================

// In .prettierrc (or .prettierrc.json):
//
//   {
//     "plugins": ["@typesugar/prettier-plugin"]
//   }
//
// This registers the "typesugar-ts" parser for .ts/.tsx/.mts/.cts files.
// Custom syntax is converted to valid TS before Prettier parses it.
//
// Output contains preprocessor artifacts (__binop__, $<F, A>) but is valid TS.
// Use this when you just need CI format checks to pass.

// ============================================================================
// 2. FULL ROUND-TRIP FORMAT — Preserve custom syntax
// ============================================================================

// For actual formatting where you want |>, ::, F<_> preserved, use the
// `format()` function programmatically:
//
//   import { format } from "@typesugar/prettier-plugin";
//
//   const source = `const x = data |> filter(pred) |> map(fn);`;
//   const formatted = await format(source, { filepath: "example.ts" });
//   // formatted: `const x = data |> filter(pred) |> map(fn);`
//
// The pipeline:
//   1. preFormat:  custom syntax → valid TS  (|> → __binop__(), F<_> → marker)
//   2. prettier:   format the valid TS
//   3. postFormat: valid TS → custom syntax   (__binop__() → |>, marker → F<_>)

// ============================================================================
// 3. CLI TOOL — Format from the command line
// ============================================================================

// The package includes a CLI tool for batch formatting:
//
//   # Format files (write in place)
//   npx typesugar-fmt src/**/*.ts
//
//   # Check formatting (CI mode — exit 1 if unformatted)
//   npx typesugar-fmt --check src/**/*.ts
//
// Supported extensions: .ts, .tsx, .mts, .cts

// ============================================================================
// 4. CUSTOM SYNTAX HANDLED — What gets preprocessed
// ============================================================================

// The plugin handles three categories of custom syntax:
//
//   Syntax              Example              Preprocessed Form
//   ─────────────────── ──────────────────── ────────────────────────
//   Pipeline operator   data |> fn           __binop__(data, "|>", fn)
//   Cons operator       head :: tail         __binop__(head, "::", tail)
//   HKT declaration     interface Foo<F<_>>  interface Foo<F /*@ts:hkt*/>
//   HKT usage           F<A>                 $<F, A>
//
// After Prettier formats, postFormat reverses these transformations.

// ============================================================================
// 5. MULTI-LINE PIPELINE FORMATTING
// ============================================================================

// The post-formatter handles multi-line pipelines intelligently:
//
//   // Input:
//   const result = data |> filter(x => x > 0) |> map(x => x * 2) |> reduce(add)
//
//   // After formatting:
//   const result = data
//     |> filter((x) => x > 0)
//     |> map((x) => x * 2)
//     |> reduce(add);
//
// Operators are placed at the start of continuation lines with consistent indent.

// ============================================================================
// 6. PLUGIN OPTIONS — Configuration
// ============================================================================

// The plugin adds one custom option:
//
//   {
//     "plugins": ["@typesugar/prettier-plugin"],
//     "typesugarSkip": false
//   }
//
//   typesugarSkip (boolean, default: false):
//     Skip typesugar preprocessing entirely. Use this to temporarily
//     disable the plugin without removing it from the config.

// ============================================================================
// 7. FORMAT API — Programmatic usage
// ============================================================================

// Exports:
//
//   plugin (default)             Prettier plugin object
//   format(source, opts?)        Full round-trip format (preserves custom syntax)
//   check(source, opts?)         Check if source needs formatting (returns boolean)
//   getFormatMetadata(source)    Inspect what transformations would be applied
//   preFormat(source, opts?)     Step 1: custom syntax → valid TS
//   postFormat(formatted, meta)  Step 3: valid TS → custom syntax
//
// FormatOptions:
//   filepath?: string           File path (for JSX detection and config resolution)
//   prettierOptions?: Options   Additional Prettier options to pass through
//
// PreFormatOptions:
//   fileName?: string           File name for JSX detection

// ============================================================================
// 8. FORMAT METADATA — Debugging transformations
// ============================================================================

// Use getFormatMetadata() to inspect what the plugin would do:
//
//   import { getFormatMetadata } from "@typesugar/prettier-plugin";
//
//   const meta = getFormatMetadata(`
//     interface Functor<F<_>> {
//       map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
//     }
//   `);
//
//   console.log(meta.changed);    // true
//   console.log(meta.hktParams);  // [{ name: "F", scope: { start: 0, end: 95 } }]

// ============================================================================
// 9. INTEGRATION WITH ESLINT
// ============================================================================

// Use both the Prettier plugin and ESLint plugin together:
//
//   // .prettierrc
//   { "plugins": ["@typesugar/prettier-plugin"] }
//
//   // eslint.config.mjs
//   import typesugarPlugin from "@typesugar/eslint-plugin";
//   import prettierConfig from "eslint-config-prettier";
//
//   export default [
//     typesugarPlugin.configs.recommended,
//     prettierConfig,
//   ];
//
// The Prettier plugin formats first, then ESLint checks the result.
// eslint-config-prettier disables ESLint formatting rules to avoid conflicts.

export {};
