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
  isSyntheticNode,
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
  // Functions/methods containing `requires:`/`ensures:` labeled blocks are
  // treated as if decorated with @contract, so the documented block form works
  // without an explicit decorator. Only active when @typesugar/contracts is
  // loaded (which is what registers this macro). The labels in arrow
  // functions, function expressions, constructors and accessors are reported
  // as errors by the transformer (they are not contract targets).
  triggerLabels: ["requires", "ensures"],
  syntaxModule: "@typesugar/contracts/syntax",

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
    const parsed = parseContractBlocks(fn.body, (node, message, severity) =>
      severity === "error" ? ctx.reportError(node, message) : ctx.reportWarning(node, message)
    );

    if (fn.asteriskToken && (parsed.requires.length > 0 || parsed.ensures.length > 0)) {
      // A generator's body cannot be wrapped (yield is not allowed in the
      // capturing arrow) and its "result" is an iterator, not a value; the
      // old expansion produced a SyntaxError (deep review 2026-10, #4).
      ctx.reportError(
        fn,
        "@contract does not support generator functions: requires:/ensures: blocks " +
          "in a generator are not checked. Move the checks into a non-generator wrapper."
      );
      return target;
    }

    const isAsync = (ts.getModifiers(fn) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    const paramNames = new Set(
      fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : []))
    );

    // --- Precondition checks (entry state: parameter facts are valid) ---
    const preChecks: ts.Statement[] = [];
    for (const condition of parsed.requires) {
      const check = generateConditionCheck(ctx, condition, "precondition", fn, {
        prove: config.proveAtCompileTime,
      });
      if (check) preChecks.push(check);
    }

    // --- Postcondition checks ---
    // Parameter facts describe the ENTRY state. They are only usable at exit
    // for parameters that cannot have changed: never assigned in the body
    // and of an immutable primitive type (an array's `.length` can change),
    // and not shadowed by the result binding (deep review 2026-10, #34).
    const unstableParams = collectUnstableParams(ctx, fn);

    const allOldCaptures: ts.Statement[] = [];
    const postBlocks: ts.Statement[] = [];
    const resultVar = ctx.generateUniqueName("result");

    for (const ensuresBlock of parsed.ensures) {
      // The block form's implicit `result` must not hijack a parameter that
      // is itself called `result`: then `result` keeps meaning the parameter.
      const bindName =
        ensuresBlock.implicitResult && paramNames.has("result")
          ? undefined
          : ensuresBlock.resultParam;
      const exclude = new Set(unstableParams);
      if (bindName) exclude.add(bindName);

      const checks: ts.Statement[] = [];
      for (const condition of ensuresBlock.conditions) {
        const { rewritten, captures } = extractOldCaptures(ctx, condition.expression);
        const check = generateConditionCheck(
          ctx,
          { ...condition, expression: rewritten },
          "postcondition",
          fn,
          { prove: config.proveAtCompileTime, exclude }
        );
        if (check) {
          checks.push(check);
          allOldCaptures.push(...generateOldCaptureStatements(ctx, captures));
        }
      }
      if (checks.length === 0) continue;

      // Bind the result under the name the conditions use, in a block of its
      // own: `{ const result = __r; if (!(...)) throw ...; }`. Binding (rather
      // than renaming identifiers) keeps property names, shorthand properties
      // and shadowed bindings intact (deep review 2026-10, #25).
      const binding = bindName
        ? [
            ctx.factory.createVariableStatement(
              undefined,
              ctx.factory.createVariableDeclarationList(
                [ctx.factory.createVariableDeclaration(bindName, undefined, undefined, resultVar)],
                ts.NodeFlags.Const
              )
            ),
          ]
        : [];
      postBlocks.push(ctx.factory.createBlock([...binding, ...checks], true));
    }

    // --- Reconstruct function body ---
    const factory = ctx.factory;
    let newBodyStatements: ts.Statement[];

    if (postBlocks.length > 0) {
      // Run the body in an arrow IIFE (keeps `this`, `arguments`, `super`) to
      // capture the return value, then check the postconditions. For an
      // async function the IIFE is async and awaited, so postconditions see
      // the resolved value, not the Promise (deep review 2026-10, #4).
      const iife = factory.createCallExpression(
        factory.createParenthesizedExpression(
          factory.createArrowFunction(
            isAsync ? [factory.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined,
            undefined,
            [],
            // Carry the declared return type onto the IIFE so the captured
            // result keeps its precise type (a tuple is not widened).
            fn.type,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            factory.createBlock(parsed.body, true)
          )
        ),
        undefined,
        []
      );
      const wrappedBody = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              resultVar,
              undefined,
              undefined,
              isAsync ? factory.createAwaitExpression(iife) : iife
            ),
          ],
          ts.NodeFlags.Const
        )
      );

      newBodyStatements = [
        ...preChecks,
        ...allOldCaptures,
        wrappedBody,
        ...postBlocks,
        factory.createReturnStatement(resultVar),
      ];
    } else {
      newBodyStatements = [...preChecks, ...allOldCaptures, ...parsed.body];
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
  opts: { prove: boolean; exclude?: ReadonlySet<string> }
): ts.Statement | undefined {
  if (!shouldEmitCheck(type)) return undefined;

  // Try compile-time proof
  if (opts.prove) {
    const proof = tryProve(ctx, condition, fn, { exclude: opts.exclude });
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
  const errorClass = ctx.ensureImport(
    type === "precondition" ? "PreconditionError" : "PostconditionError",
    "@typesugar/contracts"
  );

  // Generate: if (!(condition)) throw new PreconditionError(message);
  const factory = ctx.factory;
  return factory.createIfStatement(
    factory.createPrefixUnaryExpression(
      ts.SyntaxKind.ExclamationToken,
      factory.createParenthesizedExpression(condition.expression)
    ),
    factory.createBlock([
      factory.createThrowStatement(
        factory.createNewExpression(errorClass, undefined, [factory.createStringLiteral(message)])
      ),
    ])
  );
}

/**
 * Parameters whose entry-state refinement facts may not hold at exit:
 * assigned anywhere in the body (including nested closures — conservative),
 * or not of an immutable primitive type.
 */
function collectUnstableParams(
  ctx: MacroContext,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration
): Set<string> {
  const names = new Set<string>();
  const params = fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p] : []));
  for (const p of params) {
    const name = (p.name as ts.Identifier).text;
    if (isSyntheticNode(p)) {
      names.add(name);
      continue;
    }
    const type = ctx.typeChecker.getTypeAtLocation(p);
    if (!isImmutablePrimitive(type)) names.add(name);
  }

  const targets = new Set(params.map((p) => (p.name as ts.Identifier).text));
  const markTarget = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (targets.has(node.text)) names.add(node.text);
      return;
    }
    // Property names in a destructuring target are not assigned.
    if (ts.isPropertyAccessExpression(node)) return;
    if (ts.isPropertyAssignment(node)) return markTarget(node.initializer);
    ts.forEachChild(node, markTarget);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      markTarget(node.left);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      markTarget(node.operand);
    } else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (!ts.isVariableDeclarationList(node.initializer)) markTarget(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return names;
}

function isImmutablePrimitive(type: ts.Type): boolean {
  const PRIMITIVE =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.BooleanLike;
  if (type.flags & PRIMITIVE) return true;
  // Refined<number, B> = number & { [brand] }: primitive if a member is.
  if (type.isIntersection()) return type.types.some((t) => (t.flags & PRIMITIVE) !== 0);
  return false;
}

globalRegistry.register(contractAttribute);
