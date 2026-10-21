/**
 * @invariant — Class Invariant Attribute Macro
 *
 * Declares a condition that must hold after construction and after
 * every public instance method / setter call. The check runs on every
 * normal exit (any `return`, or falling off the end); not on a throw, and
 * not for static members or getters.
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

    if (!ts.isArrowFunction(predicateArg) && !ts.isFunctionExpression(predicateArg)) {
      ctx.reportError(
        decorator,
        "@invariant predicate must be an arrow function: (self) => condition"
      );
      return target;
    }
    if (messageArg && !ts.isStringLiteralLike(messageArg)) {
      ctx.reportError(messageArg, "@invariant message must be a string literal");
      return target;
    }

    const message = messageArg
      ? (messageArg as ts.StringLiteralLike).text
      : `Invariant failed: ${safeText(predicateArg)}`;

    // The check CALLS the user's predicate with the instance —
    // `if (!(pred)(this)) throw new InvariantError(msg)` — instead of
    // textually replacing `self` with `this`, which renamed property names
    // and shadowed bindings, broke `this` inside nested functions, and only
    // looked at the first `return` of a block body (deep review 2026-10, #25).
    const invariantError = ctx.ensureImport("InvariantError", "@typesugar/contracts");
    const makeCheck = (): ts.Statement =>
      ctx.factory.createIfStatement(
        ctx.factory.createPrefixUnaryExpression(
          ts.SyntaxKind.ExclamationToken,
          ctx.factory.createCallExpression(
            ctx.factory.createParenthesizedExpression(predicateArg),
            undefined,
            [ctx.factory.createThis()]
          )
        ),
        ctx.factory.createBlock([
          ctx.factory.createThrowStatement(
            ctx.factory.createNewExpression(invariantError, undefined, [
              ctx.factory.createStringLiteral(message),
            ])
          ),
        ])
      );

    // Check on every normal exit of each public INSTANCE method and setter:
    //   let __threw = false;
    //   try { <body> } catch (e) { __threw = true; throw e; }
    //   finally { if (!__threw) <check> }
    // The old expansion appended the check after the body — dead code after
    // any `return` — and also instrumented static methods, where `this` is
    // the class and the check always threw (deep review 2026-10, #9).
    //
    // The method's leading `requires:`/`ensures:` blocks stay first, outside
    // the try: @contract (or the labels' auto-detection) expands the method
    // AFTER this class macro, and only reads contract blocks that are
    // top-level statements of the body. Wrapped inside the try they were
    // left behind, and old() in them was an error. Kept first, the method
    // checks its preconditions, runs the (invariant-checked) body, then its
    // postconditions. A JS label is syntax, so the label name is what
    // identifies it (as parseContractBlocks does).
    const wrap = (body: ts.Block): ts.Block => {
      const threw = ctx.generateUniqueName("threw");
      const err = ctx.generateUniqueName("e");
      let lead = 0;
      while (lead < body.statements.length && isContractBlock(body.statements[lead])) lead++;
      return ctx.factory.createBlock(
        [
          ...body.statements.slice(0, lead),
          ctx.factory.createVariableStatement(
            undefined,
            ctx.factory.createVariableDeclarationList(
              [
                ctx.factory.createVariableDeclaration(
                  threw,
                  undefined,
                  undefined,
                  ctx.factory.createFalse()
                ),
              ],
              ts.NodeFlags.Let
            )
          ),
          ctx.factory.createTryStatement(
            ctx.factory.createBlock(body.statements.slice(lead), true),
            ctx.factory.createCatchClause(
              err,
              ctx.factory.createBlock(
                [
                  ctx.factory.createExpressionStatement(
                    ctx.factory.createAssignment(threw, ctx.factory.createTrue())
                  ),
                  ctx.factory.createThrowStatement(err),
                ],
                true
              )
            ),
            ctx.factory.createBlock(
              [
                ctx.factory.createIfStatement(
                  ctx.factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, threw),
                  ctx.factory.createBlock([makeCheck()], true)
                ),
              ],
              true
            )
          ),
        ],
        true
      );
    };

    let sawConstructor = false;
    const newMembers: ts.ClassElement[] = target.members.map((member) => {
      if (ts.isMethodDeclaration(member) && member.body && isPublicInstance(member)) {
        return ctx.factory.updateMethodDeclaration(
          member,
          member.modifiers,
          member.asteriskToken,
          member.name,
          member.questionToken,
          member.typeParameters,
          member.parameters,
          member.type,
          wrap(member.body)
        );
      }

      if (ts.isSetAccessorDeclaration(member) && member.body && isPublicInstance(member)) {
        return ctx.factory.updateSetAccessorDeclaration(
          member,
          member.modifiers,
          member.name,
          member.parameters,
          wrap(member.body)
        );
      }

      // Constructor: check once construction (field initializers + body) is
      // complete. Appended rather than try-wrapped so a `super(...)` call stays
      // a top-level statement of the constructor.
      if (ts.isConstructorDeclaration(member) && member.body) {
        sawConstructor = true;
        return ctx.factory.updateConstructorDeclaration(
          member,
          member.modifiers,
          member.parameters,
          ctx.factory.createBlock([...member.body.statements, makeCheck()], true)
        );
      }

      return member;
    });

    // No constructor: synthesize one so the state produced by the field
    // initializers is checked too.
    if (!sawConstructor) {
      const ext = target.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
      const base = ext?.types[0]?.expression;
      if (base) {
        const args = ctx.generateUniqueName("args");
        const paramsType = ts.isIdentifier(base)
          ? ctx.factory.createTypeReferenceNode("ConstructorParameters", [
              ctx.factory.createTypeQueryNode(base),
            ])
          : ctx.factory.createArrayTypeNode(
              ctx.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
            );
        newMembers.unshift(
          ctx.factory.createConstructorDeclaration(
            undefined,
            [
              ctx.factory.createParameterDeclaration(
                undefined,
                ctx.factory.createToken(ts.SyntaxKind.DotDotDotToken),
                args,
                undefined,
                paramsType
              ),
            ],
            ctx.factory.createBlock(
              [
                ctx.factory.createExpressionStatement(
                  ctx.factory.createCallExpression(ctx.factory.createSuper(), undefined, [
                    ctx.factory.createSpreadElement(args),
                  ])
                ),
                makeCheck(),
              ],
              true
            )
          )
        );
      } else {
        newMembers.unshift(
          ctx.factory.createConstructorDeclaration(
            undefined,
            [],
            ctx.factory.createBlock([makeCheck()], true)
          )
        );
      }
    }

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

/** A `requires:` / `ensures:` labeled statement (a contract block). */
function isContractBlock(stmt: ts.Statement): boolean {
  return (
    ts.isLabeledStatement(stmt) && (stmt.label.text === "requires" || stmt.label.text === "ensures")
  );
}

/** Public (no private/protected modifier, no `#name`), non-static member. */
function isPublicInstance(member: ts.MethodDeclaration | ts.SetAccessorDeclaration): boolean {
  if (ts.isPrivateIdentifier(member.name)) return false;
  const modifiers = ts.getModifiers(member) ?? [];
  return !modifiers.some(
    (m) =>
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.StaticKeyword
  );
}

function safeText(node: ts.Node): string {
  try {
    const text = node.getText?.();
    if (text) return text;
  } catch {
    // Synthesized nodes have no source text.
  }
  return "<predicate>";
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
