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
  const f = ctx.factory;

  // Generate compile-time verification block
  // In full implementation, this would invoke the prover for each law.
  //
  // const _laws = <lawGen>(<targetName>[, <eq>]);
  const lawGenArgs: ts.Expression[] = [f.createIdentifier(targetName)];
  if (options.eq) {
    lawGenArgs.push(dottedExpression(f, options.eq));
  }
  const lawsDecl = f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          "_laws",
          undefined,
          undefined,
          f.createCallExpression(lawGenExpr, undefined, lawGenArgs)
        ),
      ],
      ts.NodeFlags.Const
    )
  );

  // if (typeof process !== "undefined" && process.env.TYPESUGAR_LAWS_DEBUG) {
  //   console.log(`[laws] Verifying: ${_law.name}`);
  // }
  const debugGuard = f.createIfStatement(
    f.createBinaryExpression(
      f.createBinaryExpression(
        f.createTypeOfExpression(f.createIdentifier("process")),
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        f.createStringLiteral("undefined")
      ),
      ts.SyntaxKind.AmpersandAmpersandToken,
      f.createPropertyAccessExpression(
        f.createPropertyAccessExpression(f.createIdentifier("process"), "env"),
        "TYPESUGAR_LAWS_DEBUG"
      )
    ),
    f.createBlock(
      [
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("console"), "log"),
            undefined,
            [
              f.createTemplateExpression(f.createTemplateHead("[laws] Verifying: "), [
                f.createTemplateSpan(
                  f.createPropertyAccessExpression(f.createIdentifier("_law"), "name"),
                  f.createTemplateTail("")
                ),
              ]),
            ]
          )
        ),
      ],
      true
    )
  );

  // for (const _law of _laws) {
  //   // Compile-time prover invocation would go here
  //   <debugGuard>
  // }
  const forOfLaws = f.createForOfStatement(
    undefined,
    f.createVariableDeclarationList([f.createVariableDeclaration("_law")], ts.NodeFlags.Const),
    f.createIdentifier("_laws"),
    f.createBlock([debugGuard], true)
  );

  // (function __laws_verify_<targetName>() { <lawsDecl> <forOfLaws> })();
  const iife = f.createExpressionStatement(
    f.createCallExpression(
      f.createParenthesizedExpression(
        f.createFunctionExpression(
          undefined,
          undefined,
          f.createIdentifier(`__laws_verify_${targetName}`),
          undefined,
          [],
          undefined,
          f.createBlock([lawsDecl, forOfLaws], true)
        )
      ),
      undefined,
      []
    )
  );

  ts.addSyntheticLeadingComment(
    iife,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ` @laws compile-time verification for ${targetName}`,
    true
  );

  const strippedTarget = stripDecorator(ctx, target, decorator);

  return [strippedTarget, iife];
}

function expandPropertyTest(
  ctx: MacroContext,
  target: ts.Declaration,
  decorator: ts.Decorator,
  expCtx: ExpansionContext
): ts.Node[] {
  const { targetName, lawGenExpr, options, config } = expCtx;
  const f = ctx.factory;
  const iterations = options.iterations ?? config.iterations;

  if (!options.arbitrary) {
    ctx.reportError(
      decorator,
      "@laws in property-test mode requires an 'arbitrary' option. " +
        "Example: @laws(myLaws, { arbitrary: arbMyType })"
    );
    return [stripDecorator(ctx, target, decorator)];
  }

  const arbitraryExpr = dottedExpression(f, options.arbitrary);

  // const _laws = <lawGen>(<targetName>[, <eq>]);
  const lawGenArgs: ts.Expression[] = [f.createIdentifier(targetName)];
  if (options.eq) {
    lawGenArgs.push(dottedExpression(f, options.eq));
  }
  const lawsDecl = f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          "_laws",
          undefined,
          undefined,
          f.createCallExpression(lawGenExpr, undefined, lawGenArgs)
        ),
      ],
      ts.NodeFlags.Const
    )
  );

  // const _args: unknown[] = [];
  const argsDecl = f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          "_args",
          undefined,
          f.createArrayTypeNode(f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)),
          f.createArrayLiteralExpression([])
        ),
      ],
      ts.NodeFlags.Const
    )
  );

  // for (let _j = 0; _j < _law.arity; _j++) {
  //   _args.push(<arbitrary>.arbitrary());
  // }
  const innerForJ = f.createForStatement(
    f.createVariableDeclarationList(
      [f.createVariableDeclaration("_j", undefined, undefined, f.createNumericLiteral(0))],
      ts.NodeFlags.Let
    ),
    f.createBinaryExpression(
      f.createIdentifier("_j"),
      ts.SyntaxKind.LessThanToken,
      f.createPropertyAccessExpression(f.createIdentifier("_law"), "arity")
    ),
    f.createPostfixUnaryExpression(f.createIdentifier("_j"), ts.SyntaxKind.PlusPlusToken),
    f.createBlock(
      [
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("_args"), "push"),
            undefined,
            [
              f.createCallExpression(
                f.createPropertyAccessExpression(arbitraryExpr, "arbitrary"),
                undefined,
                []
              ),
            ]
          )
        ),
      ],
      true
    )
  );

  // const _result = _law.check(..._args);
  const resultDecl = f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          "_result",
          undefined,
          undefined,
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("_law"), "check"),
            undefined,
            [f.createSpreadElement(f.createIdentifier("_args"))]
          )
        ),
      ],
      ts.NodeFlags.Const
    )
  );

  // if (!_result) {
  //   throw new Error(`Law '${_law.name}' failed for: ${JSON.stringify(_args)}`);
  // }
  const throwIfFailed = f.createIfStatement(
    f.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, f.createIdentifier("_result")),
    f.createBlock(
      [
        f.createThrowStatement(
          f.createNewExpression(f.createIdentifier("Error"), undefined, [
            f.createTemplateExpression(f.createTemplateHead("Law '"), [
              f.createTemplateSpan(
                f.createPropertyAccessExpression(f.createIdentifier("_law"), "name"),
                f.createTemplateMiddle("' failed for: ")
              ),
              f.createTemplateSpan(
                f.createCallExpression(
                  f.createPropertyAccessExpression(f.createIdentifier("JSON"), "stringify"),
                  undefined,
                  [f.createIdentifier("_args")]
                ),
                f.createTemplateTail("")
              ),
            ]),
          ])
        ),
      ],
      true
    )
  );

  // for (let _i = 0; _i < <iterations>; _i++) {
  //   <argsDecl> <innerForJ> <resultDecl> <throwIfFailed>
  // }
  const outerForI = f.createForStatement(
    f.createVariableDeclarationList(
      [f.createVariableDeclaration("_i", undefined, undefined, f.createNumericLiteral(0))],
      ts.NodeFlags.Let
    ),
    f.createBinaryExpression(
      f.createIdentifier("_i"),
      ts.SyntaxKind.LessThanToken,
      f.createNumericLiteral(iterations)
    ),
    f.createPostfixUnaryExpression(f.createIdentifier("_i"), ts.SyntaxKind.PlusPlusToken),
    f.createBlock([argsDecl, innerForJ, resultDecl, throwIfFailed], true)
  );

  // it(`satisfies ${_law.name}`, () => { <outerForI> });
  const itCall = f.createExpressionStatement(
    f.createCallExpression(f.createIdentifier("it"), undefined, [
      f.createTemplateExpression(f.createTemplateHead("satisfies "), [
        f.createTemplateSpan(
          f.createPropertyAccessExpression(f.createIdentifier("_law"), "name"),
          f.createTemplateTail("")
        ),
      ]),
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock([outerForI], true)
      ),
    ])
  );

  // for (const _law of _laws) { <itCall> }
  const forOfLaws = f.createForOfStatement(
    undefined,
    f.createVariableDeclarationList([f.createVariableDeclaration("_law")], ts.NodeFlags.Const),
    f.createIdentifier("_laws"),
    f.createBlock([itCall], true)
  );

  // describe(`${targetName} laws`, () => { <lawsDecl> <forOfLaws> });
  const describeCall = f.createExpressionStatement(
    f.createCallExpression(f.createIdentifier("describe"), undefined, [
      f.createStringLiteral(`${targetName} laws`),
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock([lawsDecl, forOfLaws], true)
      ),
    ])
  );

  ts.addSyntheticLeadingComment(
    describeCall,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ` @laws property tests for ${targetName}`,
    true
  );

  const strippedTarget = stripDecorator(ctx, target, decorator);

  return [strippedTarget, describeCall];
}

/**
 * Build an expression node for a dotted identifier reference (e.g. "myModule.eqNumber")
 * without going through the parser. Each segment becomes a nested
 * `ts.factory.createPropertyAccessExpression` chain rooted at a plain identifier.
 */
function dottedExpression(f: ts.NodeFactory, text: string): ts.Expression {
  const parts = text.split(".");
  let expr: ts.Expression = f.createIdentifier(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    expr = f.createPropertyAccessExpression(expr, parts[i]);
  }
  return expr;
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
