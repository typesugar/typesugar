/**
 * @contract — Attribute Macro for Function Contracts
 *
 * Activates `requires:` and `ensures:` labeled block parsing inside
 * the decorated function. Generates runtime checks (strippable) and
 * attempts compile-time proofs.
 *
 * @example
 * ```typescript
 * @contract
 * function withdraw(account: Account, amount: Positive): Balance {
 *   requires: {
 *     account.balance >= amount;
 *     !account.frozen;
 *   }
 *   ensures: (result) => {
 *     result === old(account.balance) - amount;
 *   }
 *   account.balance -= amount;
 *   return Balance.refine(account.balance);
 * }
 * ```
 */

import * as ts from "typescript";
import {
  defineAttributeMacro,
  globalRegistry,
  MacroContext,
  type AttributeTarget,
} from "@typesugar/core";
import { shouldEmitCheck, getContractConfig } from "../config.js";
import { parseContractBlocks } from "../parser/contract-block.js";
import { extractOldCaptures, generateOldCaptureStatements } from "./old.js";
import { tryProve } from "../prover/index.js";
import type { ContractCondition } from "../parser/predicate.js";

export const contractAttribute = defineAttributeMacro({
  name: "contract",
  description:
    "Enable requires:/ensures: contract blocks on a function. " +
    "Generates runtime checks (strippable) and attempts compile-time proofs.",
  validTargets: ["function", "method"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target) && !ts.isMethodDeclaration(target)) {
      ctx.reportError(target, "@contract can only be applied to functions and methods");
      return target;
    }

    const fn = target;
    const config = getContractConfig();

    // Parse requires:/ensures: blocks from the function body
    const parsed = parseContractBlocks(fn.body);

    // Collect all old() captures from ensures blocks
    const allOldCaptures: ts.Statement[] = [];
    const postChecks: ts.Statement[] = [];

    // --- Precondition checks ---
    const preChecks: ts.Statement[] = [];
    for (const condition of parsed.requires) {
      const check = generateConditionCheck(
        ctx,
        condition,
        "precondition",
        fn,
        config.proveAtCompileTime
      );
      if (check) preChecks.push(check);
    }

    // --- Postcondition checks ---
    for (const ensuresBlock of parsed.ensures) {
      for (const condition of ensuresBlock.conditions) {
        // Extract old() captures from the condition
        const { rewritten, captures } = extractOldCaptures(ctx, condition.expression);
        allOldCaptures.push(...generateOldCaptureStatements(ctx, captures));

        // Generate the post-check with rewritten expression (old replaced)
        const rewrittenCondition: ContractCondition = {
          ...condition,
          expression: rewritten,
        };
        const check = generateConditionCheck(
          ctx,
          rewrittenCondition,
          "postcondition",
          fn,
          config.proveAtCompileTime
        );
        if (check) postChecks.push(check);
      }
    }

    // --- Reconstruct function body ---
    const factory = ctx.factory;
    let newBodyStatements: ts.Statement[];

    if (postChecks.length > 0) {
      // Need to wrap body to capture return value
      // Check if the function has a non-void return type
      const hasReturn = parsed.body.some(containsReturnStatement);

      if (hasReturn) {
        // Wrap body in IIFE to capture result, then check postconditions
        const resultVar = ctx.generateUniqueName("result");

        const wrappedBody = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                resultVar,
                undefined,
                undefined,
                factory.createCallExpression(
                  factory.createParenthesizedExpression(
                    factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      undefined,
                      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      factory.createBlock(parsed.body, true)
                    )
                  ),
                  undefined,
                  []
                )
              ),
            ],
            ts.NodeFlags.Const
          )
        );

        // Replace `result` references in postconditions with the result variable
        const resultPostChecks = postChecks.map((check) =>
          replaceResultReferences(ctx, check, resultVar, parsed.ensures)
        );

        newBodyStatements = [
          ...preChecks,
          ...allOldCaptures,
          wrappedBody,
          ...resultPostChecks,
          factory.createReturnStatement(resultVar),
        ];
      } else {
        // No return — just append post-checks after body
        newBodyStatements = [...preChecks, ...allOldCaptures, ...parsed.body, ...postChecks];
      }
    } else {
      // No postconditions — just prepend prechecks
      newBodyStatements = [...preChecks, ...parsed.body];
    }

    const newBody = factory.createBlock(newBodyStatements, true);

    // Reconstruct the function without the @contract decorator
    // Use `target` for decorator access since it satisfies HasDecorators
    const decorators = ts.canHaveDecorators(target)
      ? (ts.getDecorators(target) ?? []).filter((d) => d !== _decorator)
      : [];
    const modifiers = ts.canHaveModifiers(target) ? (ts.getModifiers(target) ?? []) : [];
    const allModifiers = [...decorators, ...modifiers];

    if (ts.isFunctionDeclaration(fn)) {
      return factory.updateFunctionDeclaration(
        fn,
        allModifiers.length > 0 ? allModifiers : undefined,
        fn.asteriskToken,
        fn.name,
        fn.typeParameters,
        fn.parameters,
        fn.type,
        newBody
      );
    }

    if (ts.isMethodDeclaration(fn)) {
      return factory.updateMethodDeclaration(
        fn,
        allModifiers.length > 0 ? allModifiers : undefined,
        fn.asteriskToken,
        fn.name,
        fn.questionToken,
        fn.typeParameters,
        fn.parameters,
        fn.type,
        newBody
      );
    }

    return target;
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a runtime check statement for a contract condition.
 * Returns undefined if the condition is proven or stripping is enabled.
 */
function generateConditionCheck(
  ctx: MacroContext,
  condition: ContractCondition,
  type: "precondition" | "postcondition",
  fn: ts.FunctionDeclaration | ts.MethodDeclaration,
  proveAtCompileTime: boolean
): ts.Statement | undefined {
  if (!shouldEmitCheck(type)) return undefined;

  // Try compile-time proof
  if (proveAtCompileTime) {
    const proof = tryProve(ctx, condition, fn);
    if (proof.proven) return undefined;
  }

  // Try constant evaluation
  if (ctx.isComptime(condition.expression)) {
    const result = ctx.evaluate(condition.expression);
    if (result.kind === "boolean" && result.value === true) return undefined;
    if (result.kind === "boolean" && result.value === false) {
      ctx.reportError(
        condition.expression,
        `${type === "precondition" ? "Precondition" : "Postcondition"} is statically false: ${condition.sourceText}`
      );
    }
  }

  const label = type === "precondition" ? "Precondition" : "Postcondition";
  const message = condition.message ?? `${label} failed: ${condition.sourceText}`;

  // Generate: if (!(condition)) throw new Error(message);
  const factory = ctx.factory;
  return factory.createIfStatement(
    factory.createPrefixUnaryExpression(
      ts.SyntaxKind.ExclamationToken,
      factory.createParenthesizedExpression(condition.expression)
    ),
    factory.createBlock([
      factory.createThrowStatement(
        factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
          factory.createStringLiteral(message),
        ])
      ),
    ])
  );
}

/**
 * Check if a statement list contains any return statements.
 */
function containsReturnStatement(stmt: ts.Statement): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (ts.isReturnStatement(node)) {
      found = true;
      return;
    }
    // Don't descend into nested functions
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return found;
}

/**
 * Replace references to the ensures result parameter with the actual
 * result variable name.
 */
function replaceResultReferences(
  ctx: MacroContext,
  statement: ts.Statement,
  resultVar: ts.Identifier,
  ensuresBlocks: Array<{ resultParam?: string }>
): ts.Statement {
  const resultParams = ensuresBlocks
    .map((b) => b.resultParam)
    .filter((p): p is string => p !== undefined);

  if (resultParams.length === 0) return statement;

  function visit(node: ts.Node): ts.Node {
    if (ts.isIdentifier(node) && resultParams.includes(node.text)) {
      return resultVar;
    }
    return ts.visitEachChild(node, visit, ctx.transformContext);
  }

  return ts.visitNode(statement, visit) as ts.Statement;
}

globalRegistry.register(contractAttribute);
