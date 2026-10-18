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
import type { VerificationMode, UndecidableAction, LawsDecoratorOptions } from "../laws/types.js";
import { getLawsConfig } from "../laws/verify.js";

export type { LawsDecoratorOptions };

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
        optionExprs: {},
      });
    }

    // === PROPERTY-TEST MODE ===
    if (mode === "property-test") {
      return expandPropertyTest(ctx, target, decorator, {
        targetName,
        lawGenExpr,
        options,
        config,
        optionExprs: {
          arbitrary: findOptionExpr(args, "arbitrary"),
          eq: findOptionExpr(args, "eq"),
        },
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
  /** The option expressions themselves (kept as AST, not source text). */
  optionExprs: { arbitrary?: ts.Expression; eq?: ts.Expression };
}

function findOptionExpr(args: readonly ts.Expression[], key: string): ts.Expression | undefined {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === key) {
        return prop.initializer;
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === key) return prop.name;
    }
  }
  return undefined;
}

function expandCompileTime(
  ctx: MacroContext,
  target: ts.Declaration,
  decorator: ts.Decorator,
  expCtx: ExpansionContext
): ts.Node[] {
  // Compile-time law verification is not implemented. The old expansion
  // emitted a runtime IIFE that called the law generator at module load and
  // verified nothing; say so instead of pretending (deep review 2026-10).
  ctx.reportWarning(
    decorator,
    `@laws compile-time mode is not implemented: no laws were verified for ` +
      `${expCtx.targetName}. Use mode "property-test", or verifyLaws() from a test.`
  );
  return [stripDecorator(ctx, target, decorator)];
}

function expandPropertyTest(
  ctx: MacroContext,
  target: ts.Declaration,
  decorator: ts.Decorator,
  expCtx: ExpansionContext
): ts.Node[] {
  const { targetName, lawGenExpr, options, config, optionExprs } = expCtx;
  const iterations = options.iterations ?? config.iterations;

  if (!optionExprs.arbitrary) {
    ctx.reportError(
      decorator,
      "@laws in property-test mode requires an 'arbitrary' option. " +
        "Example: @laws(myLaws, { arbitrary: arbMyType })"
    );
    return [stripDecorator(ctx, target, decorator)];
  }

  // Built with ts.factory (CLAUDE.md: no string codegen):
  //
  // describe("<target> laws", () => {
  //   const _laws = lawGen(target[, eq]);
  //   for (const _law of _laws) {
  //     it(`satisfies ${_law.name}`, () => {
  //       for (let _i = 0; _i < N; _i++) {
  //         const _args = [];
  //         for (let _j = 0; _j < _law.arity; _j++) _args.push(arb.arbitrary());
  //         if (!_law.check(..._args))
  //           throw new Error(`Law '${_law.name}' failed for: ${JSON.stringify(_args)}`);
  //       }
  //     });
  //   }
  // });
  const f = ctx.factory;
  const id = (n: string) => f.createIdentifier(n);
  const lawsId = ctx.generateUniqueName("laws");
  const lawId = ctx.generateUniqueName("law");
  const iId = ctx.generateUniqueName("i");
  const jId = ctx.generateUniqueName("j");
  const argsId = ctx.generateUniqueName("args");
  const constDecl = (name: ts.Identifier, init: ts.Expression, flags = ts.NodeFlags.Const) =>
    f.createVariableDeclarationList(
      [f.createVariableDeclaration(name, undefined, undefined, init)],
      flags
    );
  const lawName = f.createPropertyAccessExpression(lawId, "name");
  const arrow = (body: ts.Statement[]) =>
    f.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBlock(body, true)
    );
  const countedLoop = (
    counter: ts.Identifier,
    bound: ts.Expression,
    body: ts.Statement
  ): ts.Statement =>
    f.createForStatement(
      constDecl(counter, f.createNumericLiteral(0), ts.NodeFlags.Let),
      f.createLessThan(counter, bound),
      f.createPostfixIncrement(counter),
      body
    );

  const pushArb = f.createExpressionStatement(
    f.createCallExpression(f.createPropertyAccessExpression(argsId, "push"), undefined, [
      f.createCallExpression(
        f.createPropertyAccessExpression(optionExprs.arbitrary, "arbitrary"),
        undefined,
        []
      ),
    ])
  );
  const failure = f.createThrowStatement(
    f.createNewExpression(id("Error"), undefined, [
      f.createTemplateExpression(f.createTemplateHead("Law '"), [
        f.createTemplateSpan(lawName, f.createTemplateMiddle("' failed for: ")),
        f.createTemplateSpan(
          f.createCallExpression(
            f.createPropertyAccessExpression(id("JSON"), "stringify"),
            undefined,
            [argsId]
          ),
          f.createTemplateTail("")
        ),
      ]),
    ])
  );
  const iteration = f.createBlock(
    [
      f.createVariableStatement(
        undefined,
        constDecl(
          argsId,
          f.createAsExpression(
            f.createArrayLiteralExpression([]),
            f.createArrayTypeNode(f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword))
          )
        )
      ),
      countedLoop(jId, f.createPropertyAccessExpression(lawId, "arity"), pushArb),
      f.createIfStatement(
        f.createLogicalNot(
          f.createCallExpression(f.createPropertyAccessExpression(lawId, "check"), undefined, [
            f.createSpreadElement(argsId),
          ])
        ),
        failure
      ),
    ],
    true
  );
  const itCall = f.createExpressionStatement(
    f.createCallExpression(id("it"), undefined, [
      f.createTemplateExpression(f.createTemplateHead("satisfies "), [
        f.createTemplateSpan(lawName, f.createTemplateTail("")),
      ]),
      arrow([countedLoop(iId, f.createNumericLiteral(iterations), iteration)]),
    ])
  );
  const describeCall = f.createExpressionStatement(
    f.createCallExpression(id("describe"), undefined, [
      f.createStringLiteral(`${targetName} laws`),
      arrow([
        f.createVariableStatement(
          undefined,
          constDecl(
            lawsId,
            f.createCallExpression(lawGenExpr, undefined, [
              id(targetName),
              ...(optionExprs.eq ? [optionExprs.eq] : []),
            ])
          )
        ),
        f.createForOfStatement(
          undefined,
          f.createVariableDeclarationList([f.createVariableDeclaration(lawId)], ts.NodeFlags.Const),
          lawsId,
          f.createBlock([itCall], true)
        ),
      ]),
    ])
  );

  return [stripDecorator(ctx, target, decorator), describeCall];
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
              result.arbitrary = safeText(value);
              break;

            case "eq":
              result.eq = safeText(value);
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

function safeText(node: ts.Node): string {
  try {
    return node.getText();
  } catch {
    return "<expression>";
  }
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
