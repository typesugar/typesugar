/**
 * @typesugar/units — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime `units` fallback + unit constructors live in the package's
 * `.` entry. See PEP-050.
 *
 * Provides the `units` tagged-template / call macro that parses unit literals at
 * compile time:
 *   const distance = units`5 meters`;
 *   const speed = units`100 km/h`;
 *   const force = units`9.8 N`;
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";
import { lookupUnitAlias } from "./unit-aliases.js";

/** Module the generated constructor calls refer to (the runtime `.` entry). */
const UNITS_MODULE = "@typesugar/units";

/**
 * Parse a unit literal string like "5 meters" or "100 km/h"
 */
function parseUnitLiteral(text: string): { value: number; unit: string } | null {
  const trimmed = text.trim();

  // Try to match: number followed by optional whitespace and unit
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.+)?$/i);

  if (!match) {
    return null;
  }

  const value = parseFloat(match[1]);
  const unit = match[2]?.trim() || "";

  return { value, unit };
}

/**
 * Units tagged template macro
 *
 * units`5 meters` => meters(5)
 * units`100 km/h` => kilometersPerHour(100)
 */
export const unitsMacro = defineExpressionMacro({
  name: "units",
  description: "Parse unit literals at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    // Handle tagged template literal
    if (args.length === 1 && ts.isTemplateLiteral(args[0])) {
      const template = args[0];

      // Simple case: no substitutions
      if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return parseAndCreateUnit(ctx, template.text, callExpr);
      }

      // Template with substitutions - we need to handle this differently
      // For now, error on complex templates
      ctx.reportError(callExpr, "units template literals with substitutions are not yet supported");
      return callExpr;
    }

    // Handle direct string argument: units("5 meters")
    if (args.length === 1 && ts.isStringLiteral(args[0])) {
      return parseAndCreateUnit(ctx, args[0].text, callExpr);
    }

    // Handle number + unit string: units(5, "meters")
    if (args.length === 2) {
      const valueArg = args[0];
      const unitArg = args[1];

      if (ts.isStringLiteral(unitArg)) {
        const unitText = unitArg.text.trim();
        const fnName = lookupUnitAlias(unitText);

        if (!fnName) {
          ctx.reportError(callExpr, `Unknown unit: ${unitText}`);
          return callExpr;
        }

        // Generate: unitFn(value)
        const ref = constructorRef(ctx, fnName, callExpr);
        if (!ref) return callExpr;
        return factory.createCallExpression(ref, undefined, [valueArg]);
      }
    }

    ctx.reportError(
      callExpr,
      "Invalid units() call - expected a string literal or tagged template"
    );
    return callExpr;
  },
});

/**
 * Helper to parse a unit string and create the appropriate function call
 */
function parseAndCreateUnit(ctx: MacroContext, text: string, errorNode: ts.Node): ts.Expression {
  const factory = ctx.factory;
  const parsed = parseUnitLiteral(text);

  if (!parsed) {
    ctx.reportError(errorNode, `Invalid unit literal: ${text}`);
    return errorNode as ts.Expression;
  }

  const { value, unit } = parsed;

  // If no unit specified, just return the number
  if (!unit) {
    return factory.createNumericLiteral(value);
  }

  const fnName = lookupUnitAlias(unit);

  if (!fnName) {
    ctx.reportError(errorNode, `Unknown unit: ${unit}`);
    return errorNode as ts.Expression;
  }

  const ref = constructorRef(ctx, fnName, errorNode);
  if (!ref) return errorNode as ts.Expression;
  return factory.createCallExpression(ref, undefined, [factory.createNumericLiteral(value)]);
}

/**
 * A reference to the runtime unit constructor `fnName` that is guaranteed to
 * be bound at the expansion site (MU-3).
 *
 * The user typically imports only `units`, and the transformer strips that
 * specifier because it resolved to a macro, so a bare `meters` identifier would
 * be unbound (ReferenceError) — or would capture an unrelated user binding.
 * `ctx.ensureImport` registers the import and aliases it when a TOP-LEVEL
 * import/declaration already uses the name. It does not see function-local
 * bindings, so those are checked here by walking the enclosing scopes; on a
 * local collision we report an error rather than emit a call the local would
 * capture (there is no MacroContext API to force an aliased import).
 */
function constructorRef(
  ctx: MacroContext,
  fnName: string,
  site: ts.Node
): ts.Identifier | undefined {
  const local = findLocalBinding(fnName, site);
  if (local) {
    ctx.reportError(
      site,
      `units: the expansion calls the unit constructor \`${fnName}\` from ${UNITS_MODULE}, ` +
        `but a local binding named \`${fnName}\` shadows it here. Rename the local binding, ` +
        `or call ${fnName}(...) from an import instead of using the units macro.`
    );
    return undefined;
  }
  return ctx.ensureImport(fnName, UNITS_MODULE);
}

/**
 * Whether `name` is declared in a scope enclosing `site` below the source-file
 * level (top level is handled by `ctx.ensureImport`). Works on the original
 * (parented) node; a synthetic node with no parent chain yields `false`.
 */
function findLocalBinding(name: string, site: ts.Node): boolean {
  const bindsName = (b: ts.BindingName): boolean => {
    if (ts.isIdentifier(b)) return b.text === name;
    for (const el of b.elements) {
      if (ts.isBindingElement(el) && bindsName(el.name)) return true;
    }
    return false;
  };
  const declaresInStatements = (stmts: readonly ts.Statement[]): boolean => {
    for (const st of stmts) {
      if (ts.isVariableStatement(st)) {
        if (st.declarationList.declarations.some((d) => bindsName(d.name))) return true;
      } else if (
        (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) &&
        st.name?.text === name
      ) {
        return true;
      }
    }
    return false;
  };

  let node: ts.Node | undefined = ts.getOriginalNode(site);
  let prev: ts.Node | undefined;
  while (node && !ts.isSourceFile(node)) {
    if (
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node)
    ) {
      if (declaresInStatements(node.statements)) return true;
    } else if (ts.isFunctionLike(node)) {
      if (node.parameters.some((p) => bindsName(p.name))) return true;
      // A named function expression binds its own name inside its body.
      if (ts.isFunctionExpression(node) && node.name?.text === name) return true;
    } else if (ts.isClassExpression(node)) {
      if (node.name?.text === name) return true;
    } else if (ts.isCatchClause(node)) {
      if (node.variableDeclaration && bindsName(node.variableDeclaration.name)) return true;
    } else if (
      (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer) &&
      prev !== node.initializer
    ) {
      if (node.initializer.declarations.some((d) => bindsName(d.name))) return true;
    }
    prev = node;
    node = node.parent;
  }
  return false;
}

// ============================================================================
// Register
// ============================================================================

export function register(): void {
  globalRegistry.register(unitsMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
