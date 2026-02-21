/**
 * @typesugar/hlist — Expression Macros
 *
 * Zero-cost macros that rewrite HList construction to plain array literals
 * at compile time, eliminating the function call overhead.
 *
 * - `hlist(a, b, c)` --> `[a, b, c]`
 * - `labeled({ x: 1, y: 2 })` --> `[1, 2]` (labels are type-only)
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, type MacroContext } from "@typesugar/core";

/**
 * `hlist` macro — rewrites `hlist(a, b, c)` to the array literal `[a, b, c]`.
 *
 * The type system already tracks element types via `HList<[A, B, C]>`;
 * the macro simply strips the function call wrapper.
 */
export const hlistMacro = defineExpressionMacro({
  name: "hlist",
  description: "Zero-cost HList construction — emits a plain array literal",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    return ctx.factory.createArrayLiteralExpression(args as ts.Expression[], false);
  },
});

/**
 * `labeled` macro — rewrites `labeled({ x: 1, y: 2 })` to `[1, 2]`.
 *
 * Labels exist only in the type system (`LabeledField<"x", number>` etc.),
 * so the runtime representation is a flat values array.
 * The macro also stores the keys on a hidden `__keys` property for
 * runtime label lookups — same as the non-macro `labeled()` function.
 */
export const labeledMacro = defineExpressionMacro({
  name: "labeled",
  description: "Zero-cost LabeledHList construction — strips labels, emits value array",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1) {
      ctx.reportError(callExpr, "labeled() expects exactly one object argument");
      return callExpr;
    }

    const arg = args[0];

    if (!ts.isObjectLiteralExpression(arg)) {
      ctx.reportError(callExpr, "labeled() expects an object literal argument");
      return callExpr;
    }

    const values: ts.Expression[] = [];
    const keys: ts.Expression[] = [];

    for (const prop of arg.properties) {
      if (ts.isPropertyAssignment(prop)) {
        values.push(prop.initializer);
        const name = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;
        if (name !== undefined) {
          keys.push(factory.createStringLiteral(name));
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        values.push(factory.createIdentifier(prop.name.text));
        keys.push(factory.createStringLiteral(prop.name.text));
      }
    }

    // Emit: Object.assign([v1, v2, ...], { __keys: ["k1", "k2", ...] })
    const arrLiteral = factory.createArrayLiteralExpression(values, false);
    const keysArr = factory.createArrayLiteralExpression(keys, false);

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "assign"),
      undefined,
      [
        arrLiteral,
        factory.createObjectLiteralExpression(
          [factory.createPropertyAssignment("__keys", keysArr)],
          false
        ),
      ]
    );
  },
});

/**
 * `mapWith` macro — placeholder for future zero-cost heterogeneous map.
 *
 * Full implementation requires typeclass resolution to determine the
 * output type per element. For now, emits a standard `.map()` call.
 */
export const mapWithMacro = defineExpressionMacro({
  name: "mapWith",
  description: "Heterogeneous map (placeholder — full version needs typeclass integration)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 2) {
      ctx.reportError(callExpr, "mapWith() expects (hlist, fn) arguments");
      return callExpr;
    }
    const [list, fn] = args;

    return ctx.factory.createCallExpression(
      ctx.factory.createPropertyAccessExpression(list, "map"),
      undefined,
      [fn]
    );
  },
});

// ============================================================================
// Registration
// ============================================================================

/** Register all HList macros with the global macro registry. */
export function register(): void {
  globalRegistry.register(hlistMacro);
  globalRegistry.register(labeledMacro);
  globalRegistry.register(mapWithMacro);
}

register();
