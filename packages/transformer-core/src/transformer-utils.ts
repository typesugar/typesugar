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
