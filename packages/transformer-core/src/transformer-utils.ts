/**
 * Pure utility functions used by the MacroTransformer.
 * These have no dependency on transformer state.
 */

import * as ts from "typescript";

const nodePrinter = ts.createPrinter();

/**
 * Safely get the text content of a node.
 * Unlike node.getText(), this works on synthetic nodes that don't have source positions.
 */
export function safeGetNodeText(node: ts.Node, sourceFile?: ts.SourceFile): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  try {
    return node.getText();
  } catch {
    // Fallback for synthetic nodes
    const sf = sourceFile ?? ts.createSourceFile("temp.ts", "", ts.ScriptTarget.Latest);
    return nodePrinter.printNode(ts.EmitHint.Unspecified, node, sf);
  }
}

/**
 * Check if a type is a primitive type (number, string, boolean, etc.)
 */
export function isPrimitiveType(type: ts.Type): boolean {
  const flags = type.flags;
  return !!(
    flags & ts.TypeFlags.Number ||
    flags & ts.TypeFlags.String ||
    flags & ts.TypeFlags.Boolean ||
    flags & ts.TypeFlags.BigInt ||
    flags & ts.TypeFlags.Null ||
    flags & ts.TypeFlags.Undefined ||
    flags & ts.TypeFlags.Void ||
    flags & ts.TypeFlags.Never ||
    flags & ts.TypeFlags.NumberLiteral ||
    flags & ts.TypeFlags.StringLiteral ||
    flags & ts.TypeFlags.BooleanLiteral ||
    flags & ts.TypeFlags.BigIntLiteral
  );
}

/** Callback type for recursive visiting from the transformer. */
export type VisitFn = (node: ts.Node) => ts.Node | ts.Node[];

export function createMacroErrorExpression(
  factory: ts.NodeFactory,
  message: string
): ts.Expression {
  return factory.createCallExpression(
    factory.createParenthesizedExpression(
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock([
          factory.createThrowStatement(
            factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
              factory.createStringLiteral(message),
            ])
          ),
        ])
      )
    ),
    undefined,
    []
  );
}

export function createMacroErrorStatement(factory: ts.NodeFactory, message: string): ts.Statement {
  return factory.createThrowStatement(
    factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
      factory.createStringLiteral(message),
    ])
  );
}

export function updateNodeDecorators(
  factory: ts.NodeFactory,
  node: ts.Node,
  decorators: ts.Decorator[]
): ts.Node {
  const modifiers = decorators.length > 0 ? decorators : undefined;

  if (ts.isClassDeclaration(node)) {
    return factory.updateClassDeclaration(
      node,
      modifiers
        ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
        : node.modifiers?.filter((m) => !ts.isDecorator(m)),
      node.name,
      node.typeParameters,
      node.heritageClauses,
      node.members
    );
  }

  if (ts.isFunctionDeclaration(node)) {
    return factory.updateFunctionDeclaration(
      node,
      modifiers
        ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
        : node.modifiers?.filter((m) => !ts.isDecorator(m)),
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      node.body
    );
  }

  if (ts.isMethodDeclaration(node)) {
    return factory.updateMethodDeclaration(
      node,
      modifiers
        ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
        : node.modifiers?.filter((m) => !ts.isDecorator(m)),
      node.asteriskToken,
      node.name,
      node.questionToken,
      node.typeParameters,
      node.parameters,
      node.type,
      node.body
    );
  }

  if (ts.isInterfaceDeclaration(node)) {
    return factory.updateInterfaceDeclaration(
      node,
      modifiers
        ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
        : node.modifiers?.filter((m) => !ts.isDecorator(m)),
      node.name,
      node.typeParameters,
      node.heritageClauses,
      node.members
    );
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return factory.updateTypeAliasDeclaration(
      node,
      modifiers
        ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
        : node.modifiers?.filter((m) => !ts.isDecorator(m)),
      node.name,
      node.typeParameters,
      node.type
    );
  }

  return node;
}

/**
 * If `body` is a Block of the form `{ const __letyield_N = EXPR; return __letyield_N; }`
 * (ignoring EmptyStatements), return `EXPR` so the caller can collapse an arrow body
 * produced by `arrow-comprehension-preprocess.ts` back into an expression body.
 * Returns `undefined` when the shape doesn't match.
 */
export function tryExtractCompReturnExpr(body: ts.Block): ts.Expression | undefined {
  const stmts = body.statements.filter((s) => !ts.isEmptyStatement(s));
  if (stmts.length !== 2) return undefined;
  const [decl, ret] = stmts;
  if (!ts.isVariableStatement(decl)) return undefined;
  if (decl.declarationList.declarations.length !== 1) return undefined;
  const d = decl.declarationList.declarations[0];
  if (!ts.isIdentifier(d.name)) return undefined;
  if (!d.name.text.startsWith("__letyield_")) return undefined;
  if (!d.initializer) return undefined;
  if (!ts.isReturnStatement(ret)) return undefined;
  if (!ret.expression || !ts.isIdentifier(ret.expression)) return undefined;
  if (ret.expression.text !== d.name.text) return undefined;
  return d.initializer;
}

/**
 * Detect a Block that was synthesized by `arrow-comprehension-preprocess.ts`
 * to wrap an expression-position `let:/yield:` comprehension.
 *
 * The preprocessor emits two nested `{ { ... } }` so TS's error-recovery for
 * `const __letyield_N = let: {...}` consumes the stray `}` from the user's
 * labeled block without closing the enclosing arrow/function body. The inner
 * Block always begins with the broken two-decl VariableStatement whose first
 * declaration is `__letyield_N = let|par|seq|all`.
 */
export function isPreprocessedCompWrapperBlock(block: ts.Block): boolean {
  const first = block.statements[0];
  if (!first || !ts.isVariableStatement(first)) return false;
  const decls = first.declarationList.declarations;
  if (decls.length !== 2) return false;
  const firstDecl = decls[0];
  const secondDecl = decls[1];
  if (!ts.isIdentifier(firstDecl.name)) return false;
  if (!firstDecl.name.text.startsWith("__letyield_")) return false;
  if (!firstDecl.initializer || !ts.isIdentifier(firstDecl.initializer)) return false;
  const init = firstDecl.initializer.text;
  if (init !== "let" && init !== "par" && init !== "seq" && init !== "all") return false;
  return ts.isObjectBindingPattern(secondDecl.name);
}
