/**
 * @typesugar/fp macro-time registrations (PEP-055 Phase D).
 *
 * Isolated into its own `./macros` entry per PEP-050 Case-1: `ResultAlgebra`
 * values reference `MacroContext` (a compile-time-only type) and are only
 * meaningful to the macro-expansion pipeline, so they must not live in the
 * `.` runtime entry.
 *
 * Relocated from `@typesugar/macros`'s `specialize.ts`, where they were a
 * deliberate builtin seed (`fp` had no `./macros` entry to host its own
 * registration) — now that PEP-055 makes manifest-based discovery of a
 * `./macros` entry unconditional, `fp` hosts its own.
 */

import { registerSyntaxMarkerFallback } from "@typesugar/core";
import { registerResultAlgebra, type ResultAlgebra } from "@typesugar/macros";

// Zero-cost Option/Result inlining macros (registered on import).
export { zeroCostOptionMacro, zeroCostResultMacro } from "./zero-cost/macros.js";

// PEP-052 Wave 6: resolution-free fallback for fp's `@syntax-methods Show`
// marker, so it activates in hosts that cannot resolve modules via the
// checker (mirrors std's registrations in `std/src/macros/index.ts`). Lives
// in this compile-time entry, not the runtime `.` barrel, because importing
// `@typesugar/core` loads `typescript` and cosmiconfig.
registerSyntaxMarkerFallback("@typesugar/fp/syntax/show", { methods: ["Show"] });

/**
 * Option algebra: ok(v) -> v, err(e) -> null
 *
 * Specializes Result<E, T> to T | null (Option<T>).
 * Error information is discarded.
 */
export const optionResultAlgebra: ResultAlgebra = {
  name: "Option",
  targetTypes: ["Option"],
  rewriteOk: (_ctx, value) => value,
  rewriteErr: (ctx, _error) => ctx.factory.createNull(),
  preservesError: false,
};

/**
 * Either algebra: ok(v) -> { _tag: "Right", right: v }, err(e) -> { _tag: "Left", left: e }
 *
 * Specializes Result<E, T> to Either<E, T>.
 * Both success and error values are preserved with discriminated union tags.
 */
export const eitherResultAlgebra: ResultAlgebra = {
  name: "Either",
  targetTypes: ["Either"],
  rewriteOk: (ctx, value) =>
    ctx.factory.createObjectLiteralExpression([
      ctx.factory.createPropertyAssignment("_tag", ctx.factory.createStringLiteral("Right")),
      ctx.factory.createPropertyAssignment("right", value),
    ]),
  rewriteErr: (ctx, error) =>
    ctx.factory.createObjectLiteralExpression([
      ctx.factory.createPropertyAssignment("_tag", ctx.factory.createStringLiteral("Left")),
      ctx.factory.createPropertyAssignment("left", error),
    ]),
  preservesError: true,
};

registerResultAlgebra(optionResultAlgebra);
registerResultAlgebra(eitherResultAlgebra);
