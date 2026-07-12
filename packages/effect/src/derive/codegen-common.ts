/**
 * Shared AST-construction helpers for the Effect derive macros.
 *
 * `hash.ts`, `equal.ts`, and `schema.ts` all generate the same handful of
 * shapes — an exported typeclass-instance `const` whose value is an object
 * literal with a single symbol-keyed method, and (for sum types) a
 * `switch` over a discriminant field. Rather than duplicate the
 * `ts.factory.create*` scaffolding three times, they share it here.
 *
 * Per the repo CLAUDE.md rule, everything is built with `ts.factory.create*`
 * directly — no code strings, no `parseStatements`/`parseExpression`.
 *
 * @module
 */

import * as ts from "typescript";

/** `<name>` identifier. */
export function ident(name: string): ts.Identifier {
  return ts.factory.createIdentifier(name);
}

/** `<ns>.<name>` property access (e.g. `Hash.combine`). */
export function member(ns: string, name: string): ts.PropertyAccessExpression {
  return ts.factory.createPropertyAccessExpression(ident(ns), name);
}

/** `<obj>.<name>` property access (e.g. `self.id`). */
export function propOf(obj: ts.Expression, name: string): ts.PropertyAccessExpression {
  return ts.factory.createPropertyAccessExpression(obj, name);
}

/** `<fn>(<args>)` call. */
export function call(fn: ts.Expression, args: ts.Expression[]): ts.CallExpression {
  return ts.factory.createCallExpression(fn, undefined, args);
}

/** `return <expr>;` */
export function ret(expr: ts.Expression): ts.ReturnStatement {
  return ts.factory.createReturnStatement(expr);
}

/** A single parameter `<name>: <type>`. */
export function param(name: string, type: ts.TypeNode | undefined): ts.ParameterDeclaration {
  return ts.factory.createParameterDeclaration(
    undefined,
    undefined,
    ident(name),
    undefined,
    type,
    undefined
  );
}

/** `<left>.<right><typeArgs?>` type reference (e.g. `Hash.Hash<User>`). */
export function qualifiedTypeRef(
  left: string,
  right: string,
  typeArgs?: ts.TypeNode[]
): ts.TypeReferenceNode {
  return ts.factory.createTypeReferenceNode(
    ts.factory.createQualifiedName(ident(left), right),
    typeArgs
  );
}

/** `<name><typeArgs?>` type reference (e.g. `User`). */
export function typeRef(name: string, typeArgs?: ts.TypeNode[]): ts.TypeReferenceNode {
  return ts.factory.createTypeReferenceNode(ident(name), typeArgs);
}

/** `export const <name>: <type?> = <init>;` */
export function exportedConst(
  name: string,
  type: ts.TypeNode | undefined,
  init: ts.Expression
): ts.VariableStatement {
  return ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [ts.factory.createVariableDeclaration(ident(name), undefined, type, init)],
      ts.NodeFlags.Const
    )
  );
}

/** Specification of the single symbol-keyed method carried by an instance object literal. */
export interface InstanceMethodSpec {
  /** The computed-property key expression, e.g. `Hash.symbol`. */
  readonly symbolExpr: ts.Expression;
  readonly params: readonly ts.ParameterDeclaration[];
  readonly returnType: ts.TypeNode;
  readonly body: readonly ts.Statement[];
}

/**
 * `export const <name>: <instanceType> = { [<sym>](<params>): <ret> { <body> } };`
 *
 * The one shape every Effect typeclass instance in this package takes:
 * a single object literal exposing one method under a computed
 * (well-known-symbol) key.
 */
export function exportedSymbolInstance(
  name: string,
  instanceType: ts.TypeNode,
  method: InstanceMethodSpec
): ts.VariableStatement {
  const methodDecl = ts.factory.createMethodDeclaration(
    undefined,
    undefined,
    ts.factory.createComputedPropertyName(method.symbolExpr),
    undefined,
    undefined,
    [...method.params],
    method.returnType,
    ts.factory.createBlock([...method.body], true)
  );

  const obj = ts.factory.createObjectLiteralExpression([methodDecl], true);
  return exportedConst(name, instanceType, obj);
}

/** One `case "<tag>": <statements>` of a discriminant switch. */
export interface SwitchCaseSpec {
  readonly tag: string;
  readonly statements: readonly ts.Statement[];
}

/**
 * `switch (<discriminant>) { case "<tag>": <stmts> ... default: <default> }`
 *
 * Shared by the sum-type variants of `hash.ts` and `equal.ts`. Each case
 * is expected to `return` (there are no fallthrough breaks), matching how
 * the derived instances dispatch on the discriminant.
 */
export function discriminantSwitch(
  discriminant: ts.Expression,
  cases: readonly SwitchCaseSpec[],
  defaultStatements: readonly ts.Statement[]
): ts.SwitchStatement {
  const caseClauses = cases.map((c) =>
    ts.factory.createCaseClause(ts.factory.createStringLiteral(c.tag), [...c.statements])
  );
  const defaultClause = ts.factory.createDefaultClause([...defaultStatements]);
  return ts.factory.createSwitchStatement(
    discriminant,
    ts.factory.createCaseBlock([...caseClauses, defaultClause])
  );
}
