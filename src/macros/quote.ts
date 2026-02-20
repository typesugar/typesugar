/**
 * Quasiquoting System for typemacro
 *
 * Provides a `quote` tagged-template expression macro that lets macro authors
 * write AST construction as template code with splice holes, instead of
 * manually calling ts.factory.create*() methods.
 *
 * Inspired by: Rust's `quote!`, Elixir's `quote/unquote`, Lisp quasiquote
 *
 * @example
 * ```typescript
 * import { quote } from "typemacro/quote";
 *
 * // Expression quasiquote — returns ts.Expression
 * const expr = quote(ctx)`${left} + ${right}`;
 *
 * // Statement quasiquote — returns ts.Statement[]
 * const stmts = quoteStatements(ctx)`
 *   const ${name} = ${initializer};
 *   console.log(${name});
 * `;
 *
 * // Type quasiquote — returns ts.TypeNode
 * const typeNode = quoteType(ctx)`Array<${elementType}>`;
 * ```
 *
 * This is NOT a compile-time macro itself — it's a runtime utility for macro
 * authors to use inside their `expand()` functions. The parsing happens at
 * macro expansion time (which is compile time from the user's perspective).
 */

import * as ts from "typescript";
import { MacroContext } from "../core/types.js";
import { MacroContextImpl } from "../core/context.js";
import {
  stripPositions,
  getPrinter,
  getDummySourceFile,
} from "../core/ast-utils.js";

// =============================================================================
// Splice Types
// =============================================================================

/** A splice marker that can appear in quote templates */
export type QuoteSplice =
  | ts.Expression
  | ts.Statement
  | ts.Statement[]
  | ts.TypeNode
  | ts.Identifier
  | string
  | number
  | boolean;

/** Spread marker for splicing arrays of statements */
export class SpreadSplice {
  constructor(public readonly nodes: ts.Statement[]) {}
}

/** Create a spread splice for inserting multiple statements */
export function spread(stmts: ts.Statement[]): SpreadSplice {
  return new SpreadSplice(stmts);
}

/** Identifier splice — forces a string to be treated as an identifier */
export class IdentSplice {
  constructor(public readonly name: string) {}
}

/** Create an identifier splice */
export function ident(name: string): IdentSplice {
  return new IdentSplice(name);
}

/** Raw (unhygienic) identifier splice — uses the exact name without mangling */
export class RawSplice {
  constructor(public readonly name: string) {}
}

/** Create a raw identifier splice (escapes hygiene) */
export function raw(name: string): RawSplice {
  return new RawSplice(name);
}

// =============================================================================
// Quote — Expression Quasiquote
// =============================================================================

/**
 * Quasiquote for expressions. Returns a tagged template function that
 * parses the template and splices in the provided AST nodes.
 *
 * @example
 * ```typescript
 * const result = quote(ctx)`${left} + ${right}`;
 * // Returns a ts.BinaryExpression node
 * ```
 */
export function quote(
  ctx: MacroContext,
): (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => ts.Expression {
  return (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => {
    const code = assembleSpliceTemplate(strings, splices, ctx);
    try {
      return ctx.parseExpression(code);
    } catch (e) {
      throw new Error(
        `quote: Failed to parse expression template: ${code}\n  ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}

/**
 * Quasiquote for statements. Returns a tagged template function that
 * parses the template and returns an array of statements.
 *
 * @example
 * ```typescript
 * const stmts = quoteStatements(ctx)`
 *   const ${name} = ${init};
 *   console.log(${name});
 * `;
 * ```
 */
export function quoteStatements(
  ctx: MacroContext,
): (
  strings: TemplateStringsArray,
  ...splices: QuoteSplice[]
) => ts.Statement[] {
  return (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => {
    const code = assembleSpliceTemplate(strings, splices, ctx);
    try {
      return ctx.parseStatements(code);
    } catch (e) {
      throw new Error(
        `quoteStatements: Failed to parse statement template: ${code}\n  ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}

/**
 * Quasiquote for type nodes. Returns a tagged template function that
 * parses the template and returns a TypeNode.
 *
 * @example
 * ```typescript
 * const typeNode = quoteType(ctx)`Array<${elementType}>`;
 * ```
 */
export function quoteType(
  ctx: MacroContext,
): (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => ts.TypeNode {
  return (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => {
    const code = assembleSpliceTemplate(strings, splices, ctx);
    try {
      return parseTypeNode(code);
    } catch (e) {
      throw new Error(
        `quoteType: Failed to parse type template: ${code}\n  ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}

// =============================================================================
// Block Quote — For multi-statement function/method bodies
// =============================================================================

/**
 * Quasiquote for a block (wrapped in `{ ... }`). Returns a ts.Block node.
 *
 * @example
 * ```typescript
 * const body = quoteBlock(ctx)`
 *   const temp = ${expr};
 *   return temp;
 * `;
 * ```
 */
export function quoteBlock(
  ctx: MacroContext,
): (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => ts.Block {
  return (strings: TemplateStringsArray, ...splices: QuoteSplice[]) => {
    const code = assembleSpliceTemplate(strings, splices, ctx);
    try {
      const stmts = ctx.parseStatements(code);
      return ts.factory.createBlock(stmts, true);
    } catch (e) {
      throw new Error(
        `quoteBlock: Failed to parse block template: ${code}\n  ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}

// =============================================================================
// Template Assembly
// =============================================================================

/**
 * Assemble a template string with spliced AST nodes.
 *
 * Each splice value is converted to its source text representation:
 * - ts.Node → printed via ts.Printer
 * - string → used as-is (treated as source code text)
 * - number/boolean → converted to literal text
 * - IdentSplice → used as identifier name
 * - RawSplice → used as-is (unhygienic)
 * - SpreadSplice → statements joined with newlines
 */
function assembleSpliceTemplate(
  strings: TemplateStringsArray,
  splices: QuoteSplice[],
  ctx: MacroContext,
): string {
  const printer = getPrinter();
  const sourceFile = ctx.sourceFile ?? getDummySourceFile();
  const parts: string[] = [];

  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]);

    if (i < splices.length) {
      const splice = splices[i];
      parts.push(spliceToString(splice, printer, sourceFile));
    }
  }

  return parts.join("");
}

/**
 * Convert a splice value to its source text representation.
 */
function spliceToString(
  splice: QuoteSplice,
  printer: ts.Printer,
  sourceFile: ts.SourceFile,
): string {
  // Handle our custom splice wrapper types
  if (splice instanceof SpreadSplice) {
    return splice.nodes
      .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, sourceFile))
      .join("\n");
  }

  if (splice instanceof IdentSplice) {
    return splice.name;
  }

  if (splice instanceof RawSplice) {
    return splice.name;
  }

  // Primitives
  if (typeof splice === "string") {
    return splice;
  }

  if (typeof splice === "number") {
    return String(splice);
  }

  if (typeof splice === "boolean") {
    return String(splice);
  }

  // TypeScript AST nodes
  if (isNode(splice)) {
    // Determine the appropriate emit hint
    if (ts.isStatement(splice)) {
      return printer.printNode(ts.EmitHint.Unspecified, splice, sourceFile);
    }
    if (ts.isExpression(splice)) {
      return printer.printNode(ts.EmitHint.Expression, splice, sourceFile);
    }
    // Type nodes, identifiers, etc.
    return printer.printNode(ts.EmitHint.Unspecified, splice, sourceFile);
  }

  // Array of statements
  if (Array.isArray(splice)) {
    return (splice as ts.Statement[])
      .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, sourceFile))
      .join("\n");
  }

  return String(splice);
}

/**
 * Type guard: check if a value is a TypeScript AST node.
 */
function isNode(value: unknown): value is ts.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "number"
  );
}

// =============================================================================
// Type Node Parsing
// =============================================================================

/**
 * Parse a type annotation string into a ts.TypeNode.
 */
function parseTypeNode(code: string): ts.TypeNode {
  // SAFE: __T__ is only used for parsing, never emitted into generated code.
  const wrapper = `type __T__ = ${code};`;
  const tempSource = ts.createSourceFile(
    "__quote_type_temp__.ts",
    wrapper,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Check for parse errors
  const diags = (tempSource as unknown as { parseDiagnostics?: unknown[] })
    .parseDiagnostics;
  if (diags && diags.length > 0) {
    throw new Error(`Failed to parse type: ${code}`);
  }

  if (tempSource.statements.length !== 1) {
    throw new Error(`Failed to parse type: ${code}`);
  }

  const stmt = tempSource.statements[0];
  if (ts.isTypeAliasDeclaration(stmt)) {
    return stripPositions(stmt.type);
  }

  throw new Error(`Failed to parse type: ${code}`);
}

// =============================================================================
// Convenience: Expression Builders
// =============================================================================

/**
 * Build a function call expression from a quote-style template.
 *
 * @example
 * ```typescript
 * const call = quoteCall(ctx, "console.log", [strExpr, numExpr]);
 * // Produces: console.log("hello", 42)
 * ```
 */
export function quoteCall(
  ctx: MacroContext,
  callee: string | ts.Expression,
  args: ts.Expression[],
  typeArgs?: ts.TypeNode[],
): ts.CallExpression {
  const calleeExpr =
    typeof callee === "string" ? ctx.parseExpression(callee) : callee;

  return ctx.factory.createCallExpression(calleeExpr, typeArgs, args);
}

/**
 * Build a property access expression.
 *
 * @example
 * ```typescript
 * const access = quotePropAccess(ctx, objExpr, "length");
 * // Produces: obj.length
 * ```
 */
export function quotePropAccess(
  ctx: MacroContext,
  object: ts.Expression,
  property: string,
): ts.PropertyAccessExpression {
  return ctx.factory.createPropertyAccessExpression(
    object,
    ctx.factory.createIdentifier(property),
  );
}

/**
 * Build a method call expression.
 *
 * @example
 * ```typescript
 * const call = quoteMethodCall(ctx, objExpr, "toString", []);
 * // Produces: obj.toString()
 * ```
 */
export function quoteMethodCall(
  ctx: MacroContext,
  object: ts.Expression,
  method: string,
  args: ts.Expression[],
): ts.CallExpression {
  return ctx.factory.createCallExpression(
    quotePropAccess(ctx, object, method),
    undefined,
    args,
  );
}

/**
 * Build a variable declaration statement.
 *
 * @example
 * ```typescript
 * const decl = quoteConst(ctx, "result", expr);
 * // Produces: const result = <expr>;
 * ```
 */
export function quoteConst(
  ctx: MacroContext,
  name: string | ts.Identifier,
  initializer: ts.Expression,
  typeAnnotation?: ts.TypeNode,
): ts.VariableStatement {
  const nameNode =
    typeof name === "string" ? ctx.factory.createIdentifier(name) : name;

  return ctx.factory.createVariableStatement(
    undefined,
    ctx.factory.createVariableDeclarationList(
      [
        ctx.factory.createVariableDeclaration(
          nameNode,
          undefined,
          typeAnnotation,
          initializer,
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

/**
 * Build a `let` variable declaration statement.
 */
export function quoteLet(
  ctx: MacroContext,
  name: string | ts.Identifier,
  initializer?: ts.Expression,
  typeAnnotation?: ts.TypeNode,
): ts.VariableStatement {
  const nameNode =
    typeof name === "string" ? ctx.factory.createIdentifier(name) : name;

  return ctx.factory.createVariableStatement(
    undefined,
    ctx.factory.createVariableDeclarationList(
      [
        ctx.factory.createVariableDeclaration(
          nameNode,
          undefined,
          typeAnnotation,
          initializer,
        ),
      ],
      ts.NodeFlags.Let,
    ),
  );
}

/**
 * Build a return statement.
 */
export function quoteReturn(
  ctx: MacroContext,
  expr?: ts.Expression,
): ts.ReturnStatement {
  return ctx.factory.createReturnStatement(expr);
}

/**
 * Build an if statement.
 */
export function quoteIf(
  ctx: MacroContext,
  condition: ts.Expression,
  thenBlock: ts.Statement | ts.Statement[],
  elseBlock?: ts.Statement | ts.Statement[],
): ts.IfStatement {
  const thenBody = Array.isArray(thenBlock)
    ? ctx.factory.createBlock(thenBlock, true)
    : ts.isBlock(thenBlock)
      ? thenBlock
      : ctx.factory.createBlock([thenBlock], true);

  const elseBody = elseBlock
    ? Array.isArray(elseBlock)
      ? ctx.factory.createBlock(elseBlock, true)
      : ts.isBlock(elseBlock)
        ? elseBlock
        : ctx.factory.createBlock([elseBlock], true)
    : undefined;

  return ctx.factory.createIfStatement(condition, thenBody, elseBody);
}

/**
 * Build an arrow function expression.
 */
export function quoteArrow(
  ctx: MacroContext,
  params: Array<string | ts.ParameterDeclaration>,
  body: ts.Expression | ts.Block,
  typeParams?: ts.TypeParameterDeclaration[],
  returnType?: ts.TypeNode,
): ts.ArrowFunction {
  const paramDecls = params.map((p) =>
    typeof p === "string"
      ? ctx.factory.createParameterDeclaration(
          undefined,
          undefined,
          ctx.factory.createIdentifier(p),
        )
      : p,
  );

  const bodyNode = ts.isBlock(body) ? body : body;

  return ctx.factory.createArrowFunction(
    undefined,
    typeParams,
    paramDecls,
    returnType,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    bodyNode,
  );
}

/**
 * Build a function declaration.
 */
export function quoteFunction(
  ctx: MacroContext,
  name: string,
  params: Array<{
    name: string;
    type?: ts.TypeNode;
    optional?: boolean;
  }>,
  body: ts.Statement[],
  options?: {
    typeParams?: ts.TypeParameterDeclaration[];
    returnType?: ts.TypeNode;
    exported?: boolean;
  },
): ts.FunctionDeclaration {
  const modifiers = options?.exported
    ? [ctx.factory.createModifier(ts.SyntaxKind.ExportKeyword)]
    : undefined;

  const paramDecls = params.map((p) =>
    ctx.factory.createParameterDeclaration(
      undefined,
      undefined,
      ctx.factory.createIdentifier(p.name),
      p.optional
        ? ctx.factory.createToken(ts.SyntaxKind.QuestionToken)
        : undefined,
      p.type,
    ),
  );

  return ctx.factory.createFunctionDeclaration(
    modifiers,
    undefined,
    ctx.factory.createIdentifier(name),
    options?.typeParams,
    paramDecls,
    options?.returnType,
    ctx.factory.createBlock(body, true),
  );
}
