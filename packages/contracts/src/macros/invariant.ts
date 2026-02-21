/**
 * @invariant — Class Invariant Attribute Macro
 *
 * Declares a condition that must hold after construction and after
 * every public method call. The invariant check is inserted at the
 * end of every public method body.
 *
 * @example
 * ```typescript
 * @invariant((self) => self.balance >= 0, "Balance must be non-negative")
 * @invariant((self) => self.count === self.items.length)
 * class BankAccount {
 *   balance = 0;
 *   items: string[] = [];
 *   count = 0;
 *
 *   deposit(amount: Positive): void {
 *     this.balance += amount;
 *     this.items.push("deposit");
 *     this.count++;
 *     // Invariant checks inserted here automatically
 *   }
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
import { shouldEmitCheck } from "../config.js";

export const invariantAttribute = defineAttributeMacro({
  name: "invariant",
  description:
    "Class invariant — checked after construction and every public method. Strippable in production.",
  validTargets: ["class"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isClassDeclaration(target)) {
      ctx.reportError(target, "@invariant can only be applied to classes");
      return target;
    }

    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        decorator,
        "@invariant expects 1-2 arguments: @invariant(predicate, message?)"
      );
      return target;
    }

    // If invariants are stripped, just remove the decorator
    if (!shouldEmitCheck("invariant")) {
      return stripDecorator(ctx, target, decorator);
    }

    const predicateArg = args[0];
    const messageArg = args.length >= 2 ? args[1] : undefined;

    // Extract the predicate function body for the check
    // The predicate is (self) => condition
    let predicateBody: ts.Expression | undefined;
    let selfParam: string = "this";

    if (ts.isArrowFunction(predicateArg)) {
      if (predicateArg.parameters.length >= 1) {
        selfParam = predicateArg.parameters[0].name.getText();
      }
      if (ts.isBlock(predicateArg.body)) {
        // Block body — look for return statement
        for (const stmt of predicateArg.body.statements) {
          if (ts.isReturnStatement(stmt) && stmt.expression) {
            predicateBody = stmt.expression;
            break;
          }
        }
      } else {
        // Expression body
        predicateBody = predicateArg.body;
      }
    }

    if (!predicateBody) {
      ctx.reportError(
        decorator,
        "@invariant predicate must be an arrow function: (self) => condition"
      );
      return target;
    }

    // Build the invariant check statement
    const message =
      messageArg && ts.isStringLiteral(messageArg)
        ? messageArg.text
        : `Invariant failed: ${predicateBody.getText?.() ?? "unknown"}`;

    // Replace `self` references with `this` in the predicate
    const checkExpr = replaceSelfWithThis(ctx, predicateBody, selfParam);

    const checkStatement = ctx.factory.createIfStatement(
      ctx.factory.createPrefixUnaryExpression(
        ts.SyntaxKind.ExclamationToken,
        ctx.factory.createParenthesizedExpression(checkExpr)
      ),
      ctx.factory.createBlock([
        ctx.factory.createThrowStatement(
          ctx.factory.createNewExpression(ctx.factory.createIdentifier("Error"), undefined, [
            ctx.factory.createStringLiteral(message),
          ])
        ),
      ])
    );

    // Insert the check at the end of every public method
    const newMembers = target.members.map((member) => {
      if (ts.isMethodDeclaration(member) && !isPrivateOrProtected(member) && member.body) {
        const newBody = ctx.factory.createBlock([...member.body.statements, checkStatement], true);
        return ctx.factory.updateMethodDeclaration(
          member,
          member.modifiers,
          member.asteriskToken,
          member.name,
          member.questionToken,
          member.typeParameters,
          member.parameters,
          member.type,
          newBody
        );
      }

      // Also add to constructor
      if (ts.isConstructorDeclaration(member) && member.body) {
        const newBody = ctx.factory.createBlock([...member.body.statements, checkStatement], true);
        return ctx.factory.updateConstructorDeclaration(
          member,
          member.modifiers,
          member.parameters,
          newBody
        );
      }

      return member;
    });

    // Strip the @invariant decorator and update the class
    const remainingDecorators = ts.getDecorators(target)?.filter((d) => d !== decorator) ?? [];
    const otherModifiers = ts.canHaveModifiers(target) ? (ts.getModifiers(target) ?? []) : [];

    return ctx.factory.updateClassDeclaration(
      target,
      [...remainingDecorators, ...otherModifiers],
      target.name,
      target.typeParameters,
      target.heritageClauses,
      newMembers
    );
  },
});

// ============================================================================
// Helpers
// ============================================================================

function isPrivateOrProtected(member: ts.MethodDeclaration): boolean {
  const modifiers = ts.getModifiers(member);
  if (!modifiers) return false;
  return modifiers.some(
    (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
  );
}

function replaceSelfWithThis(
  ctx: MacroContext,
  expr: ts.Expression,
  selfParam: string
): ts.Expression {
  function visit(node: ts.Node): ts.Node {
    if (ts.isIdentifier(node) && node.text === selfParam) {
      return ctx.factory.createThis();
    }
    return ts.visitEachChild(node, visit, ctx.transformContext);
  }
  return ts.visitNode(expr, visit) as ts.Expression;
}

function stripDecorator(
  ctx: MacroContext,
  target: ts.ClassDeclaration,
  decoratorToRemove: ts.Decorator
): ts.Node {
  const remainingDecorators =
    ts.getDecorators(target)?.filter((d) => d !== decoratorToRemove) ?? [];
  const otherModifiers = ts.canHaveModifiers(target) ? (ts.getModifiers(target) ?? []) : [];

  return ctx.factory.updateClassDeclaration(
    target,
    [...remainingDecorators, ...otherModifiers],
    target.name,
    target.typeParameters,
    target.heritageClauses,
    target.members
  );
}

globalRegistry.register(invariantAttribute);
