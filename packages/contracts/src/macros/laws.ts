/**
 * @laws Macro — Generic Law Verification
 *
 * A generic attribute macro for verifying algebraic laws on any interface.
 * This is the low-level building block used by domain-specific macros
 * like @typesugar/fp's @verifyLaws.
 *
 * ## Usage
 *
 * ```typescript
 * import { laws } from "@typesugar/contracts/laws";
 * import type { Law, LawSet } from "@typesugar/contracts/laws";
 *
 * // Define laws for your interface
 * function cacheLaws<K, V>(cache: Cache<K, V>, eq: Eq<V>): LawSet {
 *   return [
 *     {
 *       name: "get-after-set",
 *       arity: 2,
 *       check: (k: K, v: V) => { cache.set(k, v); return eq.eqv(cache.get(k)!, v); }
 *     }
 *   ];
 * }
 *
 * // Verify laws on an instance
 * @laws(cacheLaws, { arbitrary: arbCache })
 * const myCache: Cache<string, number> = new LRUCache();
 * ```
 *
 * ## Configuration
 *
 * The macro reads from `laws.mode` config:
 * - `false` (default): Erased completely
 * - `"compile-time"`: Static verification via prover
 * - `"property-test"`: Generate forAll() tests
 *
 * @module
 */

import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import type { LawSet, VerificationMode, UndecidableAction } from "../laws/types.js";
import { getLawsConfig } from "../laws/verify.js";

// ============================================================================
// Types
// ============================================================================

export interface LawsDecoratorOptions {
  /** Override verification mode */
  mode?: VerificationMode;
  /** Arbitrary instance expression for property tests */
  arbitrary?: string;
  /** Additional equality instance if needed */
  eq?: string;
  /** What to do when proof is undecidable */
  onUndecidable?: UndecidableAction;
  /** Number of property test iterations */
  iterations?: number;
}

// ============================================================================
// @laws Attribute Macro
// ============================================================================

export const lawsAttribute = defineAttributeMacro({
  name: "laws",
  module: "@typesugar/contracts",
  description: "Verify algebraic laws for an interface implementation",
  validTargets: ["property", "class"],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    const config = getLawsConfig();

    // Get effective mode (decorator arg overrides global config)
    const options = parseOptions(ctx, args);
    const mode = options.mode ?? config.mode;

    // === ERASURE MODE ===
    if (mode === false) {
      return stripDecorator(ctx, target, decorator);
    }

    // First arg should be the law generator function/identifier
    const lawGenExpr = args[0];
    if (!lawGenExpr) {
      ctx.reportError(
        decorator,
        "@laws requires a law generator function as the first argument. " +
          "Example: @laws(myLaws, { arbitrary: arbMyType })"
      );
      return stripDecorator(ctx, target, decorator);
    }

    // Get the target name for diagnostics and generated code
    const targetName = extractTargetName(ctx, target);
    if (!targetName) {
      ctx.reportError(decorator, "@laws must be applied to a named declaration.");
      return stripDecorator(ctx, target, decorator);
    }

    // === COMPILE-TIME MODE ===
    if (mode === "compile-time") {
      return expandCompileTime(ctx, target, decorator, {
        targetName,
        lawGenExpr,
        options,
        config,
      });
    }

    // === PROPERTY-TEST MODE ===
    if (mode === "property-test") {
      return expandPropertyTest(ctx, target, decorator, {
        targetName,
        lawGenExpr,
        options,
        config,
      });
    }

    return stripDecorator(ctx, target, decorator);
  },
});

// ============================================================================
// Mode Expansions
// ============================================================================

interface ExpansionContext {
  targetName: string;
  lawGenExpr: ts.Expression;
  options: LawsDecoratorOptions;
  config: ReturnType<typeof getLawsConfig>;
}

function expandCompileTime(
  ctx: MacroContext,
  target: ts.Declaration,
  decorator: ts.Decorator,
  expCtx: ExpansionContext
): ts.Node[] {
  const { targetName, lawGenExpr, options } = expCtx;
  const lawGen = lawGenExpr.getText();

  // Generate compile-time verification block
  // In full implementation, this would invoke the prover for each law
  const verificationCode = `
// @laws compile-time verification for ${targetName}
(function __laws_verify_${targetName}() {
  const _laws = ${lawGen}(${targetName}${options.eq ? `, ${options.eq}` : ""});
  for (const _law of _laws) {
    // Compile-time prover invocation would go here
    // For now, emit debug info if enabled
    if (typeof process !== "undefined" && process.env.TYPESUGAR_LAWS_DEBUG) {
      console.log(\`[laws] Verifying: \${_law.name}\`);
    }
  }
})();
`;

  const statements = ctx.parseStatements(verificationCode);
  const strippedTarget = stripDecorator(ctx, target, decorator);

  return [strippedTarget, ...statements];
}

function expandPropertyTest(
  ctx: MacroContext,
  target: ts.Declaration,
  decorator: ts.Decorator,
  expCtx: ExpansionContext
): ts.Node[] {
  const { targetName, lawGenExpr, options, config } = expCtx;
  const lawGen = lawGenExpr.getText();
  const iterations = options.iterations ?? config.iterations;

  if (!options.arbitrary) {
    ctx.reportError(
      decorator,
      "@laws in property-test mode requires an 'arbitrary' option. " +
        "Example: @laws(myLaws, { arbitrary: arbMyType })"
    );
    return [stripDecorator(ctx, target, decorator)];
  }

  // Generate property-based tests
  const testCode = `
// @laws property tests for ${targetName}
describe("${targetName} laws", () => {
  const _laws = ${lawGen}(${targetName}${options.eq ? `, ${options.eq}` : ""});
  
  for (const _law of _laws) {
    it(\`satisfies \${_law.name}\`, () => {
      for (let _i = 0; _i < ${iterations}; _i++) {
        const _args: unknown[] = [];
        for (let _j = 0; _j < _law.arity; _j++) {
          _args.push(${options.arbitrary}.arbitrary());
        }
        
        const _result = _law.check(..._args);
        if (!_result) {
          throw new Error(\`Law '\${_law.name}' failed for: \${JSON.stringify(_args)}\`);
        }
      }
    });
  }
});
`;

  const statements = ctx.parseStatements(testCode);
  const strippedTarget = stripDecorator(ctx, target, decorator);

  return [strippedTarget, ...statements];
}

// ============================================================================
// Parsing Helpers
// ============================================================================

function parseOptions(ctx: MacroContext, args: readonly ts.Expression[]): LawsDecoratorOptions {
  const result: LawsDecoratorOptions = {};

  // Skip first arg (law generator), parse remaining as options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const key = prop.name.text;
          const value = prop.initializer;

          switch (key) {
            case "mode":
              if (value.kind === ts.SyntaxKind.FalseKeyword) {
                result.mode = false;
              } else if (ts.isStringLiteral(value)) {
                result.mode = value.text as VerificationMode;
              }
              break;

            case "arbitrary":
              result.arbitrary = value.getText();
              break;

            case "eq":
              result.eq = value.getText();
              break;

            case "onUndecidable":
              if (ts.isStringLiteral(value)) {
                result.onUndecidable = value.text as UndecidableAction;
              }
              break;

            case "iterations":
              if (ts.isNumericLiteral(value)) {
                result.iterations = parseInt(value.text, 10);
              }
              break;
          }
        }
      }
    }
  }

  return result;
}

function extractTargetName(ctx: MacroContext, target: ts.Node): string | undefined {
  if (ts.isVariableStatement(target)) {
    const decl = target.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) {
      return decl.name.text;
    }
  } else if (ts.isVariableDeclaration(target)) {
    if (ts.isIdentifier(target.name)) {
      return target.name.text;
    }
  } else if (ts.isClassDeclaration(target) && target.name) {
    return target.name.text;
  }
  return undefined;
}

// ============================================================================
// Decorator Stripping
// ============================================================================

function stripDecorator(
  ctx: MacroContext,
  target: ts.Node,
  decoratorToRemove: ts.Decorator
): ts.Node {
  if (!ts.canHaveDecorators(target)) return target;

  const existingDecorators = ts.getDecorators(target);
  if (!existingDecorators) return target;

  const remainingDecorators = existingDecorators.filter((d) => d !== decoratorToRemove);

  const existingModifiers = ts.canHaveModifiers(target) ? ts.getModifiers(target) : undefined;

  const newModifiers = [...remainingDecorators, ...(existingModifiers ?? [])];

  // Check the underlying node type using runtime guards
  // We need to cast to unknown first to reset the narrowed type after canHaveDecorators
  const node = target as unknown as ts.Node;
  if (ts.isVariableStatement(node)) {
    return ctx.factory.updateVariableStatement(
      node,
      newModifiers.length > 0 ? newModifiers : undefined,
      node.declarationList
    );
  }

  if (ts.isClassDeclaration(node)) {
    return ctx.factory.updateClassDeclaration(
      node,
      newModifiers.length > 0 ? newModifiers : undefined,
      node.name,
      node.typeParameters,
      node.heritageClauses,
      node.members
    );
  }

  return target;
}

// ============================================================================
// Register Macro
// ============================================================================

globalRegistry.register(lawsAttribute);

// ============================================================================
// Runtime Stub
// ============================================================================

/**
 * Runtime stub for @laws decorator.
 * At runtime this is a no-op; all verification happens at compile time.
 */
export function laws<T extends object>(
  lawGenerator: (instance: T) => LawSet,
  options?: LawsDecoratorOptions
): (target: T) => T {
  return (target) => target;
}
