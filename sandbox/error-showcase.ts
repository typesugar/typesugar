/**
 * Error Showcase for typesugar Macros
 *
 * This file intentionally contains code that triggers typesugar diagnostic errors.
 * It's designed for testing the VS Code plugin's error display and is excluded
 * from lint/build/test pipelines.
 *
 * ## How to use:
 * 1. Open this file in VS Code/Cursor with the typesugar plugin enabled
 * 2. Look at the Problems panel (Cmd/Ctrl+Shift+M)
 * 3. Hover over red squiggles to see error messages
 *
 * ## Error types:
 * - TS9xxx errors come from the typesugar transformer (macro errors)
 * - TSxxxx errors (4 digits) come from standard TypeScript
 * - Some constructs trigger BOTH (macro error + TS error)
 *
 * Categories covered:
 * - TS9001-9099: Typeclass Resolution
 * - TS9100-9199: Derive Failures
 * - TS9200-9299: Macro Syntax
 * - TS9500-9599: Comptime
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { comptime, summon, static_assert, includeStr } from "typesugar";
import type { Eq, Ord } from "@typesugar/std";

// ============================================================================
// TS9001: No instance found for typeclass
// ============================================================================
// Error: "No instance found for `Eq<OpaqueType>`"
// This error triggers when summon() can't find or auto-derive an instance.

// OpaqueType is intentionally opaque - can't auto-derive Eq
interface OpaqueType {
  readonly _brand: unique symbol;
  value: unknown; // 'unknown' prevents auto-derivation
}

// MACRO ERROR: TS9001 - No instance found for Eq<OpaqueType>
const opaqueEq = summon<Eq<OpaqueType>>();

// ============================================================================
// TS9101: Cannot auto-derive - field lacks instance
// ============================================================================
// Error: "Cannot auto-derive Eq<HasFunction>: field `callback` has type `() => void` which lacks Eq"

// Functions cannot be compared for equality, so types containing functions can't derive Eq
/** @deriving Eq */
interface HasFunction {
  x: number;
  y: number;
  callback: () => void; // PROBLEM: Functions don't have Eq
}

// ============================================================================
// TS9103: @deriving on union requires discriminant
// ============================================================================
// Error: "@deriving on union types requires a discriminant field"

// This union has no common field to discriminate on
/** @deriving Eq */
type NoDiscriminant = { name: string } | { age: number };

// Compare to valid union (has 'kind' discriminant):
/** @deriving Eq */
type WithDiscriminant = { kind: "a"; name: string } | { kind: "b"; age: number };

// ============================================================================
// TS9104: Cannot derive - type has no fields
// ============================================================================
// Error: "Cannot derive Eq: type EmptyType has no fields"

/** @deriving Eq */
interface EmptyType {}

// ============================================================================
// TS9205: Expected compile-time constant string
// ============================================================================
// Error: "Expected a compile-time constant string literal"

// includeStr() requires a string literal known at compile time
const dynamicPath = "./template.txt";
// MACRO ERROR: TS9205 - not a string literal
const contentFromVar = includeStr(dynamicPath);

// Compare to valid usage:
// const validContent = includeStr("./template.txt"); // Works!

// ============================================================================
// TS9209: Cannot evaluate at compile time
// ============================================================================
// Error: "Cannot evaluate expression at compile time"

// comptime() can only evaluate expressions with compile-time-known values
declare const runtimeValue: number;
// MACRO ERROR: TS9209 - runtimeValue isn't known at compile time
const comptimeWithRuntime = comptime(() => runtimeValue * 2);

// Compare to valid usage:
const validComptime = comptime(() => 1 + 2 + 3); // Works!

// ============================================================================
// TS9217: Static assertion failed
// ============================================================================
// Error: "Static assertion failed: Math is broken"

// MACRO ERROR: TS9217 - The condition is false
static_assert(1 + 1 === 3, "Math is broken");

// Compare to valid usage:
static_assert(1 + 1 === 2, "Math works correctly");

// ============================================================================
// TS9219: static_assert condition must be compile-time constant
// ============================================================================
// Error: "static_assert condition must be a compile-time constant"

declare const dynamicCondition: boolean;
// MACRO ERROR: TS9219 - condition not known at compile time
static_assert(dynamicCondition, "Dynamic conditions not allowed");

// ============================================================================
// TS9800/TS9801: Operator errors (disabled)
// ============================================================================
// @operators decorator triggers a transformer crash (escapedName bug) which
// prevents ALL other diagnostics in this file from appearing.
// TODO: Fix the crash in tryExpandAttributeMacros, then re-enable these.
//
// @operators({ "=": "assign" })   // TS9800 - '=' cannot be overloaded
// @operators({ "+": "add" })      // TS9801 - wrong param count

// ============================================================================
// VALID EXAMPLES (no errors)
// ============================================================================
// These demonstrate correct usage for comparison.

// Valid derivation with primitive fields only
/** @deriving Eq, Ord */
interface ValidPoint {
  x: number;
  y: number;
}

// ============================================================================
// TS9303 - @hkt type alias missing _ placeholder
// ============================================================================

/** @hkt */
type BadNoPlaceholder = Array<number>; // Should report TS9303

// ============================================================================
// TS9304 - @hkt type alias with multiple _ placeholders
// ============================================================================

import type { _ } from "@typesugar/type-system";

/** @hkt */
type BadMultiplePlaceholders = [_, _]; // Should report TS9304

// ============================================================================
// SUMMARY OF ERRORS IN THIS FILE
// ============================================================================
/*
Expected macro errors (TS9xxx):

1. TS9001 - No instance found for Eq<OpaqueType>
2. TS9101 - Cannot derive Eq<HasFunction>: field callback has () => void
3. TS9103 - Union NoDiscriminant has no discriminant field
4. TS9104 - Cannot derive Eq<EmptyType>: no fields
5. TS9205 - includeStr requires string literal, got variable
6. TS9209 - comptime can't evaluate runtimeValue
7. TS9217 - static_assert(1+1===3) failed (IDE: requires macro package loading)
8. TS9219 - static_assert condition is not compile-time (IDE: requires macro package loading)
9. TS9303 - @hkt type alias missing _ placeholder
10. TS9304 - @hkt must contain exactly one _ placeholder

Not yet testable in IDE:
- TS9800/TS9801 - Operator errors (crashes transformer, disabled)
- TS9301/TS9302 - HKT errors (@hkt is preprocessor-only, F<_> is not valid .ts syntax)

To see these errors:
1. Open in VS Code/Cursor with typesugar plugin
2. Check Problems panel (Cmd/Ctrl+Shift+M)
3. Hover over red squiggles for full error messages
*/

console.log("Error showcase loaded - check Problems panel for macro diagnostics");
