/**
 * @verifyLaws Macro — Typeclass Law Verification
 *
 * An attribute macro that verifies typeclass law compliance at compile time
 * or generates property-based tests for runtime verification.
 *
 * This is a cats-specific wrapper around @typesugar/contracts generic @laws macro,
 * adding automatic typeclass detection and law generator inference.
 *
 * ## Usage
 *
 * ```typescript
 * // With explicit law generator
 * @verifyLaws(semigroupLaws, { eq: eqNumber, arbitrary: arbNumber })
 * const semigroupSum: Semigroup<number> = { combine: (x, y) => x + y };
 *
 * // On @instance declarations (auto-detects typeclass)
 * @instance @verifyLaws
 * const optionMonad: Monad<OptionF> = { ... };
 * ```
 *
 * ## Verification Modes
 *
 * Controlled by `cats.verifyLaws` config option (or a per-decorator
 * `{ mode }` option, which takes precedence):
 *
 * - `false` (default): Decorator is erased completely — zero cost
 * - `"compile-time"` / `"property-test"`: NOT IMPLEMENTED. The decorator is
 *   erased and a diagnostic says no verification was performed (an error with
 *   `{ strict: true }`, otherwise a warning). Earlier versions emitted code for
 *   these modes that verified nothing (compile-time) or spliced test-framework
 *   `describe`/`it` blocks into the production module (property-test); both
 *   were removed rather than shipped as silent no-ops.
 *
 * ## Zero-Cost Guarantee
 *
 * When disabled:
 * - The @verifyLaws decorator vanishes from emitted code
 * - Law definition files are tree-shaken (never imported at runtime)
 * - No runtime overhead whatsoever
 *
 * ## Generic vs Cats-Specific
 *
 * This macro extends `@typesugar/contracts`' generic `@laws` macro with:
 * - Automatic typeclass detection from type annotations
 * - Built-in law generator inference for cats typeclasses
 * - Naming convention-based fallbacks
 *
 * For non-typeclass use cases, use `@laws` from `@typesugar/contracts` directly.
 *
 * @module
 */

import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import { config } from "@typesugar/core";
import { stripDecorator } from "@typesugar/core";
// Inlined from @typesugar/contracts to avoid a cross-package dependency.
// Keep in sync with packages/contracts/src/laws/types.ts.
type VerificationMode = false | "compile-time" | "property-test";
type UndecidableAction = "error" | "warn" | "fallback" | "ignore";

// ============================================================================
// Types
// ============================================================================

interface VerifyLawsConfig {
  mode: VerificationMode;
  onUndecidable: UndecidableAction;
  propertyTestIterations: number;
}

// ============================================================================
// Configuration
// ============================================================================

function getVerifyLawsConfig(): VerifyLawsConfig {
  return {
    mode: config.get<false | "compile-time" | "property-test">("cats.verifyLaws") ?? false,
    onUndecidable:
      config.get<"error" | "warn" | "fallback" | "ignore">("cats.onUndecidable") ?? "warn",
    propertyTestIterations: config.get<number>("cats.propertyTestIterations") ?? 100,
  };
}

// ============================================================================
// @verifyLaws Attribute Macro
// ============================================================================

export const verifyLawsAttribute = defineAttributeMacro({
  name: "verifyLaws",
  module: "typesugar",
  description: "Verify typeclass law compliance at compile time or via property tests",
  validTargets: ["property", "class"],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    const cfg = getVerifyLawsConfig();

    // Parse macro arguments for law generator and options
    const macroArgs = parseVerifyLawsArgs(ctx, args);
    // A per-decorator `{ mode }` overrides the project-wide config.
    const mode = macroArgs.mode !== undefined ? macroArgs.mode : cfg.mode;

    // === ERASURE MODE ===
    // When verification is disabled, strip the decorator entirely
    if (mode === false) {
      return stripDecorator(ctx, target, decorator);
    }

    // Get the instance name and type information
    const instanceInfo = extractInstanceInfo(ctx, target);
    if (!instanceInfo) {
      ctx.reportError(
        decorator,
        "@verifyLaws could not determine the instance type. " +
          "Apply to a const declaration with a typeclass type annotation."
      );
      return stripDecorator(ctx, target, decorator);
    }

    const { typeclassName, forType } = instanceInfo;

    // Determine which law generator to use
    const lawGenName = macroArgs.lawGenerator ?? inferLawGenerator(typeclassName);
    if (!lawGenName) {
      ctx.reportError(
        decorator,
        `@verifyLaws: no law generator found for typeclass '${typeclassName}'. ` +
          `Pass one explicitly: @verifyLaws(myLawGenerator, {...})`
      );
      return stripDecorator(ctx, target, decorator);
    }

    // === "compile-time" / "property-test" ===
    // Not implemented: say so, and erase (never emit code into the module).
    const message =
      `@verifyLaws mode '${mode}' is not implemented: no ${typeclassName}<${forType}> ` +
      `laws were verified (law generator '${lawGenName}'). The decorator was erased. ` +
      `Run the laws from a test file instead, e.g. with @typesugar/contracts' verifyLaws().`;
    if (macroArgs.strict) {
      ctx.reportError(decorator, message);
    } else {
      ctx.reportWarning(decorator, message);
    }
    return stripDecorator(ctx, target, decorator);
  },
});

// ============================================================================
// Instance Info Extraction
// ============================================================================

interface InstanceInfo {
  instanceName: string;
  typeclassName: string;
  forType: string;
}

function extractInstanceInfo(ctx: MacroContext, target: ts.Node): InstanceInfo | undefined {
  let varName: string | undefined;
  let typeNode: ts.TypeNode | undefined;

  if (ts.isVariableStatement(target)) {
    const decl = target.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) {
      varName = decl.name.text;
      typeNode = decl.type;
    }
  } else if (ts.isVariableDeclaration(target)) {
    if (ts.isIdentifier(target.name)) {
      varName = target.name.text;
      typeNode = target.type;
    }
  }

  if (!varName) return undefined;

  // Try to extract typeclass and type from the type annotation
  // e.g., Semigroup<number> → typeclassName="Semigroup", forType="number"
  // e.g., Monad<OptionF> → typeclassName="Monad", forType="OptionF"
  if (typeNode && ts.isTypeReferenceNode(typeNode)) {
    const typeclassName = typeNode.typeName.getText();
    const typeArgs = typeNode.typeArguments;

    if (typeArgs && typeArgs.length > 0) {
      const firstArg = typeArgs[0];
      const forType = firstArg.getText();

      return {
        instanceName: varName,
        typeclassName,
        forType,
      };
    }
  }

  // Fallback: try to infer from the instance name pattern
  // e.g., semigroupNumber → Semigroup, number
  const patterns = [
    /^(semigroup)(\w+)$/i,
    /^(monoid)(\w+)$/i,
    /^(functor)(\w+)$/i,
    /^(applicative)(\w+)$/i,
    /^(monad)(\w+)$/i,
    /^(foldable)(\w+)$/i,
    /^(traverse)(\w+)$/i,
    /^(eq)(\w+)$/i,
    /^(ord)(\w+)$/i,
    /^(show)(\w+)$/i,
  ];

  for (const pattern of patterns) {
    const match = varName.match(pattern);
    if (match) {
      return {
        instanceName: varName,
        typeclassName: capitalize(match[1]),
        forType: match[2].toLowerCase(),
      };
    }
  }

  return undefined;
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface VerifyLawsArgs {
  lawGenerator?: string;
  eq?: string;
  arbitrary?: string;
  mode?: false | "compile-time" | "property-test";
  strict?: boolean;
}

function parseVerifyLawsArgs(ctx: MacroContext, args: readonly ts.Expression[]): VerifyLawsArgs {
  const result: VerifyLawsArgs = {};

  for (const arg of args) {
    // Law generator identifier: @verifyLaws(semigroupLaws, ...)
    if (ts.isIdentifier(arg)) {
      if (!result.lawGenerator) {
        result.lawGenerator = arg.text;
      }
      continue;
    }

    // Options object: { eq: eqNumber, arbitrary: arbNumber }
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const key = prop.name.text;
          const value = prop.initializer;

          if (key === "eq" && ts.isIdentifier(value)) {
            result.eq = value.text;
          } else if (key === "arbitrary" && ts.isIdentifier(value)) {
            result.arbitrary = value.text;
          } else if (key === "mode") {
            if (value.kind === ts.SyntaxKind.FalseKeyword) {
              result.mode = false;
            } else if (ts.isStringLiteral(value)) {
              result.mode = value.text as "compile-time" | "property-test";
            }
          } else if (key === "strict") {
            result.strict = value.kind === ts.SyntaxKind.TrueKeyword;
          }
        }
      }
    }
  }

  return result;
}

// ============================================================================
// Law Generator Inference
// ============================================================================

const TYPECLASS_LAW_MAP: Record<string, string> = {
  Eq: "eqLaws",
  Ord: "ordLaws",
  Semigroup: "semigroupLaws",
  Monoid: "monoidLaws",
  Show: "showLaws",
  Functor: "functorLaws",
  Apply: "applyLaws",
  Applicative: "applicativeLaws",
  FlatMap: "flatMapLaws",
  Monad: "monadLaws",
  Foldable: "foldableLaws",
  Traverse: "traverseLaws",
  SemigroupK: "semigroupKLaws",
  MonoidK: "monoidKLaws",
  Alternative: "alternativeLaws",
};

function inferLawGenerator(typeclassName: string): string | undefined {
  return TYPECLASS_LAW_MAP[typeclassName];
}

// ============================================================================
// Helpers
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// Register Macro
// ============================================================================

globalRegistry.register(verifyLawsAttribute);

// ============================================================================
// Exports
// ============================================================================

export { getVerifyLawsConfig };

/**
 * @internal
 * Exposed for unit testing. Not part of the public API.
 */
export {
  extractInstanceInfo,
  parseVerifyLawsArgs,
  inferLawGenerator,
  capitalize,
  type VerifyLawsConfig,
  type VerifyLawsArgs,
  type InstanceInfo,
};
