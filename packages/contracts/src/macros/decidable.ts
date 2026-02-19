/**
 * @decidable — Decidability Annotation Attribute Macro
 *
 * Annotates custom refinement predicates with their decidability level,
 * enabling the prover to select optimal strategies and emit warnings
 * when compile-time predicates fall back to runtime checking.
 *
 * Inspired by Coq's termination and decidability requirements.
 *
 * @example
 * ```typescript
 * // Annotate a custom refinement type
 * @decidable("compile-time", "constant")
 * type PositiveEven = Refined<number, "PositiveEven">;
 *
 * // The prover now knows:
 * // - PositiveEven should be provable at compile-time
 * // - Prefer constant evaluation strategy
 * // - Warn if falling back to runtime
 *
 * // Mark as decidable but may need SMT solver
 * @decidable("decidable", "z3")
 * type ComplexConstraint = Refined<number, "ComplexConstraint">;
 *
 * // Mark as runtime-only (no warnings on fallback)
 * @decidable("runtime", "algebra")
 * type DynamicCheck = Refined<string, "DynamicCheck">;
 * ```
 */

import * as ts from "typescript";
import {
  defineAttributeMacro,
  globalRegistry,
  MacroContext,
  type AttributeTarget,
} from "@ttfx/core";
import {
  registerDecidability,
  type Decidability,
  type ProofStrategy,
} from "../prover/type-facts.js";

/**
 * Valid decidability levels.
 */
const VALID_DECIDABILITY: readonly Decidability[] = [
  "compile-time",
  "decidable",
  "runtime",
  "undecidable",
];

/**
 * Valid proof strategies.
 */
const VALID_STRATEGIES: readonly ProofStrategy[] = [
  "constant",
  "type",
  "algebra",
  "linear",
  "z3",
];

export const decidableAttribute = defineAttributeMacro({
  name: "decidable",
  description:
    "Annotates a refinement type with its decidability level and preferred proof strategy.",
  validTargets: ["typeAlias", "function", "class"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    // Validate arguments: @decidable(decidability, strategy?)
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        decorator,
        '@decidable expects 1-2 arguments: @decidable("compile-time" | "decidable" | "runtime" | "undecidable", strategy?)',
      );
      return stripDecorator(ctx, target, decorator);
    }

    // Parse decidability level
    const decidabilityArg = args[0];
    if (!ts.isStringLiteral(decidabilityArg)) {
      ctx.reportError(
        decorator,
        "@decidable first argument must be a string literal",
      );
      return stripDecorator(ctx, target, decorator);
    }

    const decidability = decidabilityArg.text as Decidability;
    if (!VALID_DECIDABILITY.includes(decidability)) {
      ctx.reportError(
        decorator,
        `@decidable: invalid decidability "${decidability}". Must be one of: ${VALID_DECIDABILITY.join(", ")}`,
      );
      return stripDecorator(ctx, target, decorator);
    }

    // Parse optional strategy
    let strategy: ProofStrategy = "algebra"; // default
    if (args.length >= 2) {
      const strategyArg = args[1];
      if (!ts.isStringLiteral(strategyArg)) {
        ctx.reportError(
          decorator,
          "@decidable second argument must be a string literal",
        );
        return stripDecorator(ctx, target, decorator);
      }
      strategy = strategyArg.text as ProofStrategy;
      if (!VALID_STRATEGIES.includes(strategy)) {
        ctx.reportError(
          decorator,
          `@decidable: invalid strategy "${strategy}". Must be one of: ${VALID_STRATEGIES.join(", ")}`,
        );
        return stripDecorator(ctx, target, decorator);
      }
    }

    // Extract the brand name based on target type
    let brand: string | undefined;

    if (ts.isTypeAliasDeclaration(target)) {
      // For type aliases, use the type name as the brand
      // Or try to extract from Refined<Base, "Brand"> if present
      brand = extractBrandFromTypeAlias(ctx, target);
    } else if (
      ts.isFunctionDeclaration(target) ||
      ts.isMethodDeclaration(target)
    ) {
      // For functions, use the function name as a custom predicate identifier
      brand = target.name?.getText();
    } else if (ts.isClassDeclaration(target)) {
      // For classes (refinement type classes), use class name
      brand = target.name?.getText();
    }

    if (!brand) {
      ctx.reportError(
        decorator,
        "@decidable: could not determine brand name from target",
      );
      return stripDecorator(ctx, target, decorator);
    }

    // Register the decidability at compile time
    // This registration happens during macro expansion
    registerDecidability({
      brand,
      decidability,
      preferredStrategy: strategy,
    });

    // Generate runtime registration call (for when the module loads)
    // INTENTIONALLY UNHYGIENIC: __ttfx_contracts is expected to be a runtime namespace
    // containing contract utilities. Users must import or set this up appropriately.
    const registrationCall = ctx.factory.createExpressionStatement(
      ctx.factory.createCallExpression(
        ctx.factory.createPropertyAccessExpression(
          ctx.factory.createIdentifier("__ttfx_contracts"),
          ctx.factory.createIdentifier("registerDecidability"),
        ),
        undefined,
        [
          ctx.factory.createObjectLiteralExpression([
            ctx.factory.createPropertyAssignment(
              "brand",
              ctx.factory.createStringLiteral(brand),
            ),
            ctx.factory.createPropertyAssignment(
              "decidability",
              ctx.factory.createStringLiteral(decidability),
            ),
            ctx.factory.createPropertyAssignment(
              "preferredStrategy",
              ctx.factory.createStringLiteral(strategy),
            ),
          ]),
        ],
      ),
    );

    // For type aliases, we can't add statements, so we return just the stripped type
    // The registration happens at compile time via registerDecidability above
    if (ts.isTypeAliasDeclaration(target)) {
      return stripDecoratorFromTypeAlias(ctx, target, decorator);
    }

    // For functions/classes, we could potentially inject registration
    // But for simplicity, just strip the decorator (registration happened at compile time)
    return stripDecorator(ctx, target, decorator);
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the brand string from a type alias that defines a Refined type.
 *
 * Handles patterns like:
 * - `type Foo = Refined<number, "Foo">`
 * - `type Bar = Refined<string, "Bar"> & SomeOtherType`
 */
function extractBrandFromTypeAlias(
  ctx: MacroContext,
  typeAlias: ts.TypeAliasDeclaration,
): string | undefined {
  const typeName = typeAlias.name.getText();
  const typeNode = typeAlias.type;

  // Try to find Refined<Base, "Brand"> in the type
  const brand = findRefinedBrand(typeNode);
  if (brand) return brand;

  // Fallback: use the type alias name itself as the brand
  return typeName;
}

/**
 * Recursively search for a Refined<Base, "Brand"> type reference and extract the brand.
 */
function findRefinedBrand(typeNode: ts.TypeNode): string | undefined {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName.getText();
    if (typeName === "Refined" && typeNode.typeArguments?.length === 2) {
      const brandArg = typeNode.typeArguments[1];
      if (
        ts.isLiteralTypeNode(brandArg) &&
        ts.isStringLiteral(brandArg.literal)
      ) {
        return brandArg.literal.text;
      }
    }
  }

  if (ts.isIntersectionTypeNode(typeNode)) {
    for (const member of typeNode.types) {
      const brand = findRefinedBrand(member);
      if (brand) return brand;
    }
  }

  if (ts.isUnionTypeNode(typeNode)) {
    for (const member of typeNode.types) {
      const brand = findRefinedBrand(member);
      if (brand) return brand;
    }
  }

  return undefined;
}

function stripDecorator(
  ctx: MacroContext,
  target: ts.Declaration,
  decoratorToRemove: ts.Decorator,
): ts.Node {
  if (ts.isClassDeclaration(target)) {
    const remainingDecorators =
      ts.getDecorators(target)?.filter((d) => d !== decoratorToRemove) ?? [];
    const otherModifiers = ts.canHaveModifiers(target)
      ? (ts.getModifiers(target) ?? [])
      : [];

    return ctx.factory.updateClassDeclaration(
      target,
      [...remainingDecorators, ...otherModifiers],
      target.name,
      target.typeParameters,
      target.heritageClauses,
      target.members,
    );
  }

  if (ts.isFunctionDeclaration(target)) {
    // Function declarations in standard TS don't have decorators, but in the
    // macro system they can. We use type assertion since we know the decorator
    // was applied by the macro system.
    const hasDecorators = target as unknown as ts.HasDecorators;
    const remainingDecorators =
      ts.getDecorators(hasDecorators)?.filter((d) => d !== decoratorToRemove) ??
      [];
    const otherModifiers = ts.canHaveModifiers(target)
      ? (ts.getModifiers(target) ?? [])
      : [];

    return ctx.factory.updateFunctionDeclaration(
      target,
      [...remainingDecorators, ...otherModifiers],
      target.asteriskToken,
      target.name,
      target.typeParameters,
      target.parameters,
      target.type,
      target.body,
    );
  }

  // Fallback: return as-is
  return target;
}

function stripDecoratorFromTypeAlias(
  ctx: MacroContext,
  target: ts.TypeAliasDeclaration,
  decoratorToRemove: ts.Decorator,
): ts.Node {
  // Type aliases can't have decorators in standard TS, but with macros they can.
  // We use type assertion since we know the decorator was applied by the macro system.
  const hasDecorators = target as unknown as ts.HasDecorators;
  const remainingDecorators =
    ts.getDecorators(hasDecorators)?.filter((d) => d !== decoratorToRemove) ??
    [];
  const otherModifiers = ts.canHaveModifiers(target)
    ? (ts.getModifiers(target) ?? [])
    : [];

  return ctx.factory.updateTypeAliasDeclaration(
    target,
    [...remainingDecorators, ...otherModifiers],
    target.name,
    target.typeParameters,
    target.type,
  );
}

// Register the macro
globalRegistry.register(decidableAttribute);

// ============================================================================
// Runtime API (for programmatic use without decorators)
// ============================================================================

/**
 * Programmatic version of @decidable for use without decorators.
 *
 * @example
 * ```typescript
 * import { decidable } from "@ttfx/contracts";
 *
 * // Register decidability for a custom type
 * decidable("MyCustomType", "compile-time", "constant");
 * ```
 */
export function decidable(
  brand: string,
  decidability: Decidability,
  preferredStrategy: ProofStrategy = "algebra",
): void {
  registerDecidability({
    brand,
    decidability,
    preferredStrategy,
  });
}
