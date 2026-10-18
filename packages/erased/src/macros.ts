/**
 * Expression macro for automatic vtable resolution.
 *
 * The `erased()` macro:
 * 1. Parses the requested capabilities from type arguments: `erased<[Show, Eq]>(value)`
 * 2. Infers the value's concrete type from the TypeChecker
 * 3. Looks up typeclass instances from the registry (Show<T>, Eq<T>, etc.)
 * 4. Generates the vtable inline: `{ show: (v) => showT.show(v), equals: (a, b) => eqT.equals(a, b) }`
 * 5. Emits: `eraseWith(value, { ... })`
 *
 * Usage: `const e = erased<[Show, Eq]>(myValue)` — zero boilerplate!
 *
 * **Requirements:**
 * - Capability names must map to typeclass names (ShowCapability → Show typeclass)
 * - The type must have registered instances for all requested typeclasses
 * - Falls back to pass-through if type inference fails
 *
 * @module
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  globalRegistry,
  isSyntheticNode,
  MacroContext,
} from "@typesugar/core";
import { resolveInstance, type ResolvedInstance } from "@typesugar/macros";

/**
 * Maps capability names to their corresponding typeclass info.
 * Method names in capabilities match typeclass method names.
 */
const CAPABILITY_TO_TYPECLASS: Record<
  string,
  { typeclass: string; methods: Array<{ capMethod: string; tcMethod: string; arity: number }> }
> = {
  Show: {
    typeclass: "Show",
    methods: [{ capMethod: "show", tcMethod: "show", arity: 1 }],
  },
  ShowCapability: {
    typeclass: "Show",
    methods: [{ capMethod: "show", tcMethod: "show", arity: 1 }],
  },
  Eq: {
    typeclass: "Eq",
    methods: [{ capMethod: "equals", tcMethod: "equals", arity: 2 }],
  },
  EqCapability: {
    typeclass: "Eq",
    methods: [{ capMethod: "equals", tcMethod: "equals", arity: 2 }],
  },
  Ord: {
    typeclass: "Ord",
    methods: [{ capMethod: "compare", tcMethod: "compare", arity: 2 }],
  },
  OrdCapability: {
    typeclass: "Ord",
    methods: [{ capMethod: "compare", tcMethod: "compare", arity: 2 }],
  },
  Hash: {
    typeclass: "Hash",
    methods: [{ capMethod: "hash", tcMethod: "hash", arity: 1 }],
  },
  HashCapability: {
    typeclass: "Hash",
    methods: [{ capMethod: "hash", tcMethod: "hash", arity: 1 }],
  },
  Clone: {
    typeclass: "Clone",
    methods: [{ capMethod: "clone", tcMethod: "clone", arity: 1 }],
  },
  CloneCapability: {
    typeclass: "Clone",
    methods: [{ capMethod: "clone", tcMethod: "clone", arity: 1 }],
  },
  Debug: {
    typeclass: "Debug",
    methods: [{ capMethod: "debug", tcMethod: "debug", arity: 1 }],
  },
  DebugCapability: {
    typeclass: "Debug",
    methods: [{ capMethod: "debug", tcMethod: "debug", arity: 1 }],
  },
  Json: {
    typeclass: "Json",
    methods: [
      { capMethod: "toJson", tcMethod: "toJson", arity: 1 },
      { capMethod: "fromJson", tcMethod: "fromJson", arity: 1 },
    ],
  },
  JsonCapability: {
    typeclass: "Json",
    methods: [
      { capMethod: "toJson", tcMethod: "toJson", arity: 1 },
      { capMethod: "fromJson", tcMethod: "fromJson", arity: 1 },
    ],
  },
};

/**
 * An expression that refers to a resolved instance from the call site: the
 * local binding for an explicit import, an ensured import for an instance found
 * by scanning an imported module, or the (possibly dotted) name for a local one.
 *
 * Mirrors `buildInstanceReference` in @typesugar/macros' instance-resolver,
 * which that package does not export.
 */
function instanceReference(ctx: MacroContext, resolved: ResolvedInstance): ts.Expression {
  const f = ctx.factory;
  if (resolved.source === "explicit-import" && resolved.localName && !resolved.typeOnlyImport) {
    return f.createIdentifier(resolved.localName);
  }
  if (resolved.source !== "local-scope" && resolved.importSpecifier) {
    return ctx.ensureImport(resolved.exportName, resolved.importSpecifier);
  }
  const parts = resolved.exportName.split(".");
  let expr: ts.Expression = f.createIdentifier(parts[0]);
  for (let i = 1; i < parts.length; i++) expr = f.createPropertyAccessExpression(expr, parts[i]);
  return expr;
}

/**
 * Extract capability names from a tuple type like `[Show, Eq]` or `[ShowCapability, EqCapability]`.
 */
function extractCapabilityNames(typeNode: ts.TypeNode): string[] {
  const names: string[] = [];

  if (ts.isTupleTypeNode(typeNode)) {
    for (const element of typeNode.elements) {
      if (ts.isTypeReferenceNode(element) && ts.isIdentifier(element.typeName)) {
        names.push(element.typeName.text);
      }
    }
  } else if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    names.push(typeNode.typeName.text);
  }

  return names;
}

/**
 * Get the base type name from a TypeChecker type, stripping generics.
 * E.g., "Point" from "Point", "Array<number>" → "Array"
 */
function getBaseTypeName(type: ts.Type, typeChecker: ts.TypeChecker): string {
  const symbol = type.getSymbol() || type.aliasSymbol;
  if (symbol) {
    return symbol.getName();
  }
  const typeString = typeChecker.typeToString(type);
  const match = typeString.match(/^(\w+)/);
  return match ? match[1] : typeString;
}

/**
 * Expression macro for `erased()` — auto-generates vtables from typeclass instances.
 *
 * @example
 * ```typescript
 * const e = erased<[Show, Eq]>(myPoint);
 * // Expands to:
 * // eraseWith(myPoint, {
 * //   show: (v) => showPoint.show(v),
 * //   equals: (a, b) => eqPoint.equals(a, b),
 * // })
 * ```
 */
export const erasedMacro = defineExpressionMacro({
  name: "erased",
  module: "@typesugar/erased",
  description:
    "Erase a value's type, keeping only specified capabilities. " +
    "Auto-resolves vtable from typeclass registry.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeChecker = ctx.typeChecker;

    // Need exactly one argument: the value to erase
    if (args.length !== 1) {
      ctx.reportError(callExpr, "erased() requires exactly one argument: erased<[Caps]>(value)");
      return callExpr;
    }

    const valueExpr = args[0];

    // Need type arguments specifying capabilities
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        "erased() requires type arguments specifying capabilities: erased<[Show, Eq]>(value)"
      );
      return callExpr;
    }

    // Extract capability names from the type argument
    const capabilityNames = extractCapabilityNames(typeArgs[0]);
    if (capabilityNames.length === 0) {
      ctx.reportError(
        callExpr,
        "Could not extract capability names from type argument. " +
          "Expected: erased<[Show, Eq]>(value)"
      );
      return callExpr;
    }

    // Infer the concrete type of the value. A macro-generated argument has no
    // position, and the checker can throw on it (CLAUDE.md): report instead.
    if (isSyntheticNode(valueExpr)) {
      ctx.reportError(
        callExpr,
        "erased(): cannot infer the type of a macro-generated argument; " +
          "use eraseWith(value, vtable) instead"
      );
      return callExpr;
    }
    const valueType = typeChecker.getTypeAtLocation(valueExpr);
    // `erased<[Eq]>(42)` sees the literal type `42`; instances are declared for
    // `number`, so fall back to the literal's base type when the exact type has
    // no instance.
    const baseType = typeChecker.getBaseTypeOfLiteralType(valueType);
    const typeName = getBaseTypeName(baseType, typeChecker);

    // Build vtable properties
    const vtableProperties: ts.PropertyAssignment[] = [];
    const missingInstances: string[] = [];

    for (const capName of capabilityNames) {
      const mapping = CAPABILITY_TO_TYPECLASS[capName];
      if (!mapping) {
        ctx.reportWarning(
          callExpr,
          `Unknown capability "${capName}" — skipping. ` +
            `Known: Show, Eq, Ord, Hash, Clone, Debug, Json`
        );
        continue;
      }

      // Resolve the typeclass instance from scope (PEP-052: registry-free).
      let resolved = resolveInstance(ctx, mapping.typeclass, valueType);
      if ((!resolved || resolved.kind !== "resolved") && baseType !== valueType) {
        resolved = resolveInstance(ctx, mapping.typeclass, baseType);
      }
      if (!resolved || resolved.kind !== "resolved") {
        missingInstances.push(`${mapping.typeclass}<${typeName}>`);
        continue;
      }
      const resolvedInstance = resolved;

      // Generate vtable method entries
      for (const method of mapping.methods) {
        // Create a wrapper: (v) => instanceName.method(v)
        // or (a, b) => instanceName.method(a, b) for binary methods
        const params: ts.ParameterDeclaration[] = [];
        const callArgs: ts.Expression[] = [];

        if (method.arity === 1) {
          params.push(
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier("v"),
              undefined,
              undefined,
              undefined
            )
          );
          callArgs.push(factory.createIdentifier("v"));
        } else if (method.arity === 2) {
          params.push(
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier("a"),
              undefined,
              undefined,
              undefined
            ),
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier("b"),
              undefined,
              undefined,
              undefined
            )
          );
          callArgs.push(factory.createIdentifier("a"), factory.createIdentifier("b"));
        }

        const instanceCall = factory.createCallExpression(
          factory.createPropertyAccessExpression(
            instanceReference(ctx, resolvedInstance),
            factory.createIdentifier(method.tcMethod)
          ),
          undefined,
          callArgs
        );

        const arrow = factory.createArrowFunction(
          undefined,
          undefined,
          params,
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          instanceCall
        );

        vtableProperties.push(
          factory.createPropertyAssignment(factory.createIdentifier(method.capMethod), arrow)
        );
      }
    }

    // If we're missing instances, report error but still generate partial vtable
    if (missingInstances.length > 0) {
      ctx.reportError(
        callExpr,
        `Missing typeclass instances for erased(): ${missingInstances.join(", ")}. ` +
          `Add @instance or @derive for these types.`
      );
      // Fall back to pass-through if we have no vtable entries
      if (vtableProperties.length === 0) {
        return callExpr;
      }
    }

    // Generate: eraseWith(value, { show: ..., equals: ... })
    const vtableObj = factory.createObjectLiteralExpression(vtableProperties, true);

    // ensureImport: the user typically imports only `erased`, so `eraseWith`
    // must be brought into scope (aliased if a local binding has that name).
    return factory.createCallExpression(
      ctx.ensureImport("eraseWith", "@typesugar/erased"),
      undefined,
      [valueExpr, vtableObj]
    );
  },
});

// ============================================================================
// Registration
// ============================================================================

export function register(): void {
  globalRegistry.register(erasedMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
