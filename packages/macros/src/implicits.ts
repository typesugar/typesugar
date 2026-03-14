/**
 * Implicit Parameters — `= implicit()` default parameter pattern
 *
 * Provides automatic typeclass instance resolution at call sites.
 * Functions declare implicit parameters using `= implicit()` as a default value.
 * The transformer detects these at call sites by inspecting the callee's
 * declaration through TypeScript's type checker, then fills in the missing
 * arguments with resolved instances.
 *
 * No decorator. No global function registry. The type checker does the work.
 *
 * ## Example
 *
 * ```typescript
 * // Declare a function with implicit parameters:
 * function show<A>(a: A, S: Show<A> = implicit()): string {
 *   return S.show(a);
 * }
 *
 * // Call site — implicit param is filled in automatically:
 * show(42);
 * // Expands to: show(42, Show.summon<number>("number"))
 *
 * // Explicit override still works:
 * show(42, customShow);
 * ```
 *
 * ## Automatic Propagation
 *
 * When inside a function with `= implicit()` params, those params become
 * available to nested calls (enclosing scope propagation):
 *
 * ```typescript
 * function outer<A>(a: A, S: Show<A> = implicit()): void {
 *   inner(a);  // S is automatically propagated to inner!
 * }
 *
 * function inner<A>(a: A, S: Show<A> = implicit()): void {
 *   console.log(S.show(a));
 * }
 *
 * // With custom instance — flows through:
 * outer(42, customShow);
 * // → inner gets customShow, not the global instance
 * ```
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext } from "@typesugar/core";
import { TS9001, TS9008 } from "@typesugar/core";
import { getSuggestionsForTypeclass } from "@typesugar/core";
import { instanceRegistry, typeclassRegistry } from "./typeclass.js";
import {
  formatResolutionTrace,
  generateHelpFromTrace,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "@typesugar/core";

// ============================================================================
// Types
// ============================================================================

/**
 * Implicit scope — tracks which implicit instances are available
 * at the current point in the code (for propagation through nested calls).
 */
export interface ImplicitScope {
  /** Map of "Typeclass<ConcreteType>" → variable name providing it */
  available: Map<string, string>;
}

// ============================================================================
// Detection Helpers
// ============================================================================

/**
 * Check if an initializer expression is a call to `implicit()`.
 */
export function isImplicitDefault(init: ts.Expression | undefined): boolean {
  if (!init || !ts.isCallExpression(init)) return false;
  const expr = init.expression;
  return ts.isIdentifier(expr) && expr.text === "implicit";
}

/**
 * Check if a function-like declaration has any `= implicit()` parameters.
 */
export function hasImplicitParams(decl: ts.SignatureDeclaration): boolean {
  return decl.parameters.some((p) => isImplicitDefault(p.initializer));
}

/**
 * Return the indices of parameters with `= implicit()` defaults.
 */
export function getImplicitParamIndices(decl: ts.SignatureDeclaration): number[] {
  const indices: number[] = [];
  for (let i = 0; i < decl.parameters.length; i++) {
    if (isImplicitDefault(decl.parameters[i].initializer)) {
      indices.push(i);
    }
  }
  return indices;
}

// ============================================================================
// Scope Building
// ============================================================================

/**
 * Build an ImplicitScope from a function's `= implicit()` parameters.
 *
 * Used for propagation: when inside a function with implicit params,
 * those params become available to nested calls so that caller-provided
 * instances flow through without re-resolution.
 */
export function buildImplicitScopeFromDecl(decl: ts.SignatureDeclaration): ImplicitScope {
  const available = new Map<string, string>();

  for (const param of decl.parameters) {
    if (!isImplicitDefault(param.initializer)) continue;
    if (!param.type || !ts.isTypeReferenceNode(param.type)) continue;

    const typeName = param.type.typeName;
    if (!ts.isIdentifier(typeName)) continue;

    const typeclassName = typeName.text;
    const paramName = ts.isIdentifier(param.name) ? param.name.text : "";

    const typeArgs = param.type.typeArguments;
    if (!typeArgs || typeArgs.length === 0) continue;

    const typeArgText = typeArgs[0].getText();
    const key = `${typeclassName}<${typeArgText}>`;
    available.set(key, paramName);
  }

  return { available };
}

// ============================================================================
// Instance Resolution
// ============================================================================

/**
 * Check if a type name is a registered typeclass.
 */
export function isRegisteredTypeclass(name: string): boolean {
  return typeclassRegistry.has(name);
}

/**
 * Resolve an implicit instance from the registry.
 */
export function resolveImplicit(
  typeclassName: string,
  forType: string
): { instanceName: string; derived: boolean } | undefined {
  const instance = instanceRegistry.find(
    (i) => i.typeclassName === typeclassName && i.forType === forType
  );
  if (instance) {
    return {
      instanceName: instance.instanceName,
      derived: instance.derived ?? false,
    };
  }
  return undefined;
}

// ============================================================================
// AST Helpers
// ============================================================================

const TS_KEYWORD_TYPES = new Set([
  "number",
  "string",
  "boolean",
  "bigint",
  "symbol",
  "undefined",
  "null",
  "void",
  "never",
  "any",
  "unknown",
  "object",
]);

/**
 * Create a TypeNode from a type name string, handling complex forms that
 * `factory.createTypeReferenceNode(name)` would mangle (e.g. `string[]`,
 * `Map<string, number>`).
 */
function createTypeRefSafe(factory: ts.NodeFactory, typeName: string): ts.TypeNode {
  if (typeName.endsWith("[]")) {
    const elementType = typeName.slice(0, -2);
    return factory.createTypeReferenceNode("Array", [createTypeRefSafe(factory, elementType)]);
  }

  const ltIdx = typeName.indexOf("<");
  if (ltIdx !== -1) {
    const baseName = typeName.slice(0, ltIdx);
    const innerRaw = typeName.slice(ltIdx + 1, typeName.lastIndexOf(">"));
    const innerArgs = splitTopLevelTypeArgs(innerRaw);
    return factory.createTypeReferenceNode(
      baseName,
      innerArgs.map((a) => createTypeRefSafe(factory, a.trim()))
    );
  }

  if (TS_KEYWORD_TYPES.has(typeName)) {
    return factory.createKeywordTypeNode(keywordFor(typeName));
  }

  return factory.createTypeReferenceNode(typeName, undefined);
}

/** Split `"string, Map<K, V>"` → `["string", "Map<K, V>"]` respecting nesting. */
function splitTopLevelTypeArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "<") depth++;
    else if (s[i] === ">") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function keywordFor(name: string): ts.KeywordTypeSyntaxKind {
  const map: Record<string, ts.KeywordTypeSyntaxKind> = {
    number: ts.SyntaxKind.NumberKeyword,
    string: ts.SyntaxKind.StringKeyword,
    boolean: ts.SyntaxKind.BooleanKeyword,
    bigint: ts.SyntaxKind.BigIntKeyword,
    symbol: ts.SyntaxKind.SymbolKeyword,
    undefined: ts.SyntaxKind.UndefinedKeyword,
    null: ts.SyntaxKind.NullKeyword as ts.KeywordTypeSyntaxKind,
    void: ts.SyntaxKind.VoidKeyword,
    never: ts.SyntaxKind.NeverKeyword,
    any: ts.SyntaxKind.AnyKeyword,
    unknown: ts.SyntaxKind.UnknownKeyword,
    object: ts.SyntaxKind.ObjectKeyword,
  };
  return map[name];
}

// ============================================================================
// Call Site Transformation
// ============================================================================

/**
 * Transform a call expression by filling in missing `= implicit()` arguments.
 *
 * Resolution order for each implicit parameter:
 *   1. Enclosing scope (propagation from caller's own implicit params)
 *   2. Global instance registry (`@instance` / `@deriving`)
 *
 * Returns the rewritten call expression, or `undefined` if no transformation
 * is needed (callee has no implicit params, or all args already provided).
 */
export function transformImplicitsCall(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  enclosingScope?: ImplicitScope
): ts.Expression | undefined {
  let decl: ts.SignatureDeclaration | undefined;
  let resolvedSig: ts.Signature | undefined;
  try {
    resolvedSig = ctx.typeChecker.getResolvedSignature(callExpr);
    if (!resolvedSig) return undefined;
    decl = resolvedSig.getDeclaration() as ts.SignatureDeclaration | undefined;
  } catch {
    return undefined;
  }

  if (!decl || !decl.parameters) return undefined;

  const providedArgs = callExpr.arguments.length;
  if (providedArgs >= decl.parameters.length) return undefined;

  // Quick check: any unprovided params with = implicit()?
  let hasImplicits = false;
  for (let i = providedArgs; i < decl.parameters.length; i++) {
    if (isImplicitDefault(decl.parameters[i].initializer)) {
      hasImplicits = true;
      break;
    }
  }
  if (!hasImplicits) return undefined;

  const factory = ctx.factory;
  const newArgs: ts.Expression[] = [...callExpr.arguments];

  // Infer type parameter mappings from the resolved signature (reuses resolvedSig)
  const typeParamMap = new Map<string, string>();
  try {
    // Explicit type arguments take priority
    if (callExpr.typeArguments && decl.typeParameters) {
      for (let i = 0; i < callExpr.typeArguments.length; i++) {
        if (i < decl.typeParameters.length) {
          typeParamMap.set(decl.typeParameters[i].name.text, callExpr.typeArguments[i].getText());
        }
      }
    }

    // Also infer from resolved parameter types
    const resolvedParams = resolvedSig.getParameters();
    for (let i = providedArgs; i < decl.parameters.length; i++) {
      const param = decl.parameters[i];
      if (!isImplicitDefault(param.initializer)) continue;
      if (!param.type || !ts.isTypeReferenceNode(param.type)) continue;

      if (i < resolvedParams.length) {
        const resolvedParamSymbol = resolvedParams[i];
        const resolvedType = ctx.typeChecker.getTypeOfSymbolAtLocation(
          resolvedParamSymbol,
          callExpr
        );
        const resolvedTypeStr = ctx.typeChecker.typeToString(resolvedType);
        const match = resolvedTypeStr.match(/^\w+<(.+)>$/);
        if (match) {
          const typeArgs = param.type.typeArguments;
          if (typeArgs && typeArgs.length > 0) {
            const typeArgText = typeArgs[0].getText();
            if (!typeParamMap.has(typeArgText)) {
              typeParamMap.set(typeArgText, match[1]);
            }
          }
        }
      }
    }
  } catch {
    // Fall through with whatever we have
  }

  // Fill in missing implicit parameters
  for (let i = providedArgs; i < decl.parameters.length; i++) {
    const param = decl.parameters[i];
    if (!isImplicitDefault(param.initializer)) {
      // Non-implicit default — leave it alone but keep scanning; implicit
      // params may appear later (e.g. `f(a, n = 0, eq = implicit())`).
      newArgs.push(factory.createIdentifier("undefined"));
      continue;
    }

    if (!param.type || !ts.isTypeReferenceNode(param.type)) {
      newArgs.push(factory.createIdentifier("undefined"));
      continue;
    }

    const typeName = param.type.typeName;
    if (!ts.isIdentifier(typeName)) {
      newArgs.push(factory.createIdentifier("undefined"));
      continue;
    }

    const typeclassName = typeName.text;
    const typeArgs = param.type.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      newArgs.push(factory.createIdentifier("undefined"));
      continue;
    }

    let concreteType = typeArgs[0].getText();
    if (typeParamMap.has(concreteType)) {
      concreteType = typeParamMap.get(concreteType)!;
    }

    const scopeKey = `${typeclassName}<${concreteType}>`;

    // 1. Check enclosing scope (propagation)
    if (enclosingScope?.available.has(scopeKey)) {
      const varName = enclosingScope.available.get(scopeKey)!;
      newArgs.push(factory.createIdentifier(varName));
      continue;
    }

    // 2. Fall back to global instance registry
    const resolved = resolveImplicit(typeclassName, concreteType);
    if (resolved) {
      const summonExpr = factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier(typeclassName), "summon"),
        [createTypeRefSafe(factory, concreteType)],
        [factory.createStringLiteral(concreteType)]
      );
      newArgs.push(summonExpr);
    } else {
      const attempts: ResolutionAttempt[] = [
        {
          step: "enclosing-scope",
          target: scopeKey,
          result: "not-found",
          reason: "not available in current implicit scope",
        },
        {
          step: "explicit-instance",
          target: `${typeclassName}<${concreteType}>`,
          result: "not-found",
          reason: "no @instance or @deriving registered",
        },
      ];

      const trace: ResolutionTrace = {
        sought: `${typeclassName}<${concreteType}>`,
        attempts,
        finalResult: "failed",
      };

      const traceNotes = formatResolutionTrace(trace);
      const helpMessage = generateHelpFromTrace(trace, typeclassName, concreteType);

      const paramName = ts.isIdentifier(param.name) ? param.name.text : `param[${i}]`;

      const builder = ctx.diagnostic(TS9001)
        .at(callExpr)
        .withArgs({ typeclass: typeclassName, type: concreteType });

      for (const traceNote of traceNotes) {
        builder.note(traceNote);
      }
      builder.note(`implicit parameter: ${paramName}`);

      const tcSuggestions = getSuggestionsForTypeclass(typeclassName);
      if (tcSuggestions.length > 0) {
        builder.help(`${helpMessage}\n    Add: ${tcSuggestions[0].importStatement}`);
      } else {
        builder.help(helpMessage);
      }

      builder.emit();
      return undefined;
    }
  }

  return factory.updateCallExpression(
    callExpr,
    callExpr.expression,
    callExpr.typeArguments,
    newArgs
  );
}

// ============================================================================
// summonAll — Summon multiple instances at once
// ============================================================================

export const summonAllMacro = defineExpressionMacro({
  name: "summonAll",
  module: "typesugar",
  description: "Summon multiple typeclass instances as a tuple",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        "summonAll requires type arguments, e.g., summonAll<Show<Point>, Eq<Point>>()"
      );
      return callExpr;
    }

    const factory = ctx.factory;
    const summonedExprs: ts.Expression[] = [];

    for (const typeArg of typeArgs) {
      if (!ts.isTypeReferenceNode(typeArg)) {
        ctx.reportError(
          typeArg,
          "summonAll type arguments must be type references like Show<Point>"
        );
        continue;
      }

      const tcName = typeArg.typeName.getText();
      const innerTypeArgs = typeArg.typeArguments;

      if (!innerTypeArgs || innerTypeArgs.length === 0) {
        ctx.diagnostic(TS9008)
          .at(typeArg)
          .help(`Use summonAll<${tcName}<YourType>>() with a concrete type argument`)
          .emit();
        continue;
      }

      const forType = innerTypeArgs[0].getText();

      summonedExprs.push(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier(tcName), "summon"),
          [createTypeRefSafe(factory, forType)],
          [factory.createStringLiteral(forType)]
        )
      );
    }

    return factory.createArrayLiteralExpression(summonedExprs);
  },
});

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(summonAllMacro);
