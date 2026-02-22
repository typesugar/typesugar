/**
 * MacroContext Implementation - Provides utilities for macro expansion
 */

import * as ts from "typescript";
import { MacroContext, ComptimeValue, MacroDiagnostic } from "./types.js";
import { HygieneContext, globalHygiene } from "./hygiene.js";
import { stripPositions } from "./ast-utils.js";

export class MacroContextImpl implements MacroContext {
  private diagnostics: MacroDiagnostic[] = [];
  private uniqueNameCounter = 0;
  private scope: Map<string, ComptimeValue> = new Map();

  /**
   * Shared printer instance for node-to-string conversion.
   * Creating a printer is expensive; reuse across the lifetime of the context.
   */
  private _printer: ts.Printer | undefined;

  /** Hygiene context for scoped identifier generation */
  public readonly hygiene: HygieneContext;

  constructor(
    public readonly program: ts.Program,
    public readonly typeChecker: ts.TypeChecker,
    public readonly sourceFile: ts.SourceFile,
    public readonly factory: ts.NodeFactory,
    public readonly transformContext: ts.TransformationContext,
    hygiene?: HygieneContext
  ) {
    this.hygiene = hygiene ?? globalHygiene;
  }

  /** Lazily-created shared printer instance */
  get printer(): ts.Printer {
    return (this._printer ??= ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
    }));
  }

  // -------------------------------------------------------------------------
  // Tree-Shaking Annotations
  // -------------------------------------------------------------------------

  markPure<T extends ts.Node>(node: T): T {
    ts.addSyntheticLeadingComment(node, ts.SyntaxKind.MultiLineCommentTrivia, "#__PURE__", false);
    return node;
  }

  // -------------------------------------------------------------------------
  // Node Creation Utilities
  // -------------------------------------------------------------------------

  createIdentifier(name: string): ts.Identifier {
    return this.factory.createIdentifier(name);
  }

  createNumericLiteral(value: number): ts.NumericLiteral {
    return this.factory.createNumericLiteral(value);
  }

  createStringLiteral(value: string): ts.StringLiteral {
    return this.factory.createStringLiteral(value);
  }

  createBooleanLiteral(value: boolean): ts.Expression {
    return value ? this.factory.createTrue() : this.factory.createFalse();
  }

  createArrayLiteral(elements: ts.Expression[]): ts.ArrayLiteralExpression {
    return this.factory.createArrayLiteralExpression(elements);
  }

  createObjectLiteral(
    properties: Array<{ name: string; value: ts.Expression }>
  ): ts.ObjectLiteralExpression {
    const propAssignments = properties.map(({ name, value }) =>
      this.factory.createPropertyAssignment(this.factory.createIdentifier(name), value)
    );
    return this.factory.createObjectLiteralExpression(propAssignments, true);
  }

  parseExpression(code: string): ts.Expression {
    // Create a temporary source file to parse the expression
    const tempSource = ts.createSourceFile(
      "__macro_temp__.ts",
      `const __expr__ = ${code};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    // Check for parse errors
    const diags = (tempSource as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
    if (diags && diags.length > 0) {
      throw new Error(`Failed to parse expression: ${code}`);
    }

    // Extract the expression from the variable declaration
    const statement = tempSource.statements[0];
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations[0];
      if (declaration.initializer) {
        // Strip positions so the printer generates fresh text instead of
        // extracting from the wrong source file
        return stripPositions(declaration.initializer);
      }
    }

    throw new Error(`Failed to parse expression: ${code}`);
  }

  parseStatements(code: string): ts.Statement[] {
    const tempSource = ts.createSourceFile(
      "__macro_temp__.ts",
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    // Strip positions so the printer generates fresh text instead of
    // extracting from the wrong source file
    return Array.from(tempSource.statements).map((stmt) => stripPositions(stmt));
  }

  // -------------------------------------------------------------------------
  // Type Utilities
  // -------------------------------------------------------------------------

  getTypeOf(node: ts.Node): ts.Type {
    return this.typeChecker.getTypeAtLocation(node);
  }

  getTypeString(node: ts.Node): string {
    const type = this.getTypeOf(node);
    return this.typeChecker.typeToString(type);
  }

  isAssignableTo(source: ts.Type, target: ts.Type): boolean {
    return this.typeChecker.isTypeAssignableTo(source, target);
  }

  getPropertiesOfType(type: ts.Type): ts.Symbol[] {
    return this.typeChecker.getPropertiesOfType(type);
  }

  getSymbol(node: ts.Node): ts.Symbol | undefined {
    return this.typeChecker.getSymbolAtLocation(node);
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  reportError(node: ts.Node, message: string): void {
    this.diagnostics.push({
      severity: "error",
      message,
      node,
    });
  }

  reportWarning(node: ts.Node, message: string): void {
    this.diagnostics.push({
      severity: "warning",
      message,
      node,
    });
  }

  getDiagnostics(): MacroDiagnostic[] {
    return [...this.diagnostics];
  }

  clearDiagnostics(): void {
    this.diagnostics = [];
  }

  // -------------------------------------------------------------------------
  // Compile-Time Evaluation
  // -------------------------------------------------------------------------

  evaluate(node: ts.Node): ComptimeValue {
    return this.evaluateNode(node);
  }

  isComptime(node: ts.Node): boolean {
    // Check if a node can be evaluated at compile time
    if (ts.isLiteralExpression(node)) {
      return true;
    }

    // Handle true/false keywords as literal expressions
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return true;
    }

    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.every((e) => this.isComptime(e));
    }

    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.every((p) => {
        if (ts.isPropertyAssignment(p)) {
          return this.isComptime(p.initializer);
        }
        return false;
      });
    }

    if (ts.isBinaryExpression(node)) {
      return this.isComptime(node.left) && this.isComptime(node.right);
    }

    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      return this.isComptime(node.operand);
    }

    if (ts.isConditionalExpression(node)) {
      return (
        this.isComptime(node.condition) &&
        this.isComptime(node.whenTrue) &&
        this.isComptime(node.whenFalse)
      );
    }

    if (ts.isParenthesizedExpression(node)) {
      return this.isComptime(node.expression);
    }

    // Identifiers are comptime only if they refer to const values
    if (ts.isIdentifier(node)) {
      const symbol = this.typeChecker.getSymbolAtLocation(node);
      if (symbol) {
        const declarations = symbol.getDeclarations();
        if (declarations && declarations.length > 0) {
          const decl = declarations[0];
          if (ts.isVariableDeclaration(decl)) {
            const parent = decl.parent;
            if (ts.isVariableDeclarationList(parent)) {
              if (parent.flags & ts.NodeFlags.Const) {
                return decl.initializer ? this.isComptime(decl.initializer) : false;
              }
            }
          }
        }
      }
    }

    return false;
  }

  private evaluateNode(node: ts.Node): ComptimeValue {
    // Numeric literals
    if (ts.isNumericLiteral(node)) {
      return { kind: "number", value: parseFloat(node.text) };
    }

    // String literals
    if (ts.isStringLiteral(node)) {
      return { kind: "string", value: node.text };
    }

    // Boolean literals
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      return { kind: "boolean", value: true };
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      return { kind: "boolean", value: false };
    }

    // Null/undefined
    if (node.kind === ts.SyntaxKind.NullKeyword) {
      return { kind: "null" };
    }
    if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
      return { kind: "undefined" };
    }

    // Array literals
    if (ts.isArrayLiteralExpression(node)) {
      const elements = node.elements.map((e) => this.evaluateNode(e));
      const hasError = elements.find((e) => e.kind === "error");
      if (hasError) return hasError;
      return { kind: "array", elements };
    }

    // Object literals
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map<string, ComptimeValue>();
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const name = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : null;
          if (name) {
            const value = this.evaluateNode(prop.initializer);
            if (value.kind === "error") return value;
            properties.set(name, value);
          }
        }
      }
      return { kind: "object", properties };
    }

    // Parenthesized expressions
    if (ts.isParenthesizedExpression(node)) {
      return this.evaluateNode(node.expression);
    }

    // Binary expressions
    if (ts.isBinaryExpression(node)) {
      return this.evaluateBinaryExpression(node);
    }

    // Prefix unary expressions
    if (ts.isPrefixUnaryExpression(node)) {
      return this.evaluatePrefixUnary(node);
    }

    // Conditional expressions (ternary)
    if (ts.isConditionalExpression(node)) {
      const condition = this.evaluateNode(node.condition);
      if (condition.kind === "error") return condition;
      const condValue = this.comptimeToBoolean(condition);
      if (condValue === null) {
        return { kind: "error", message: "Cannot convert to boolean" };
      }
      return condValue ? this.evaluateNode(node.whenTrue) : this.evaluateNode(node.whenFalse);
    }

    // Template literals (simple case)
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const value = this.evaluateNode(span.expression);
        if (value.kind === "error") return value;
        result += this.comptimeToString(value) + span.literal.text;
      }
      return { kind: "string", value: result };
    }

    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      return { kind: "string", value: node.text };
    }

    // Arrow functions - return as function value for later evaluation
    if (ts.isArrowFunction(node)) {
      return {
        kind: "function",
        fn: (...args: ComptimeValue[]) => {
          // Bind parameters to arguments
          const savedScope = new Map(this.scope);
          node.parameters.forEach((param, i) => {
            if (ts.isIdentifier(param.name)) {
              this.scope.set(
                param.name.text,
                i < args.length ? args[i] : { kind: "undefined" as const }
              );
            }
          });

          try {
            if (ts.isBlock(node.body)) {
              // Evaluate block body: execute statements, return last expression or undefined
              for (const stmt of node.body.statements) {
                if (ts.isReturnStatement(stmt)) {
                  return stmt.expression
                    ? this.evaluateNode(stmt.expression)
                    : ({ kind: "undefined" } as ComptimeValue);
                }
                if (ts.isExpressionStatement(stmt)) {
                  const result = this.evaluateNode(stmt.expression);
                  if (result.kind === "error") return result;
                }
                if (ts.isVariableStatement(stmt)) {
                  for (const decl of stmt.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name) && decl.initializer) {
                      const val = this.evaluateNode(decl.initializer);
                      if (val.kind === "error") return val;
                      this.scope.set(decl.name.text, val);
                    }
                  }
                }
              }
              return { kind: "undefined" } as ComptimeValue;
            }
            return this.evaluateNode(node.body);
          } finally {
            // Restore scope
            this.scope = savedScope;
          }
        },
      };
    }

    // Call expressions - evaluate function calls at compile time
    if (ts.isCallExpression(node)) {
      const fn = this.evaluateNode(node.expression);
      if (fn.kind === "function") {
        const args = node.arguments.map((a) => this.evaluateNode(a));
        const errorArg = args.find((a) => a.kind === "error");
        if (errorArg) return errorArg;
        return fn.fn(...args);
      }
    }

    return {
      kind: "error",
      message: `Cannot evaluate node of kind ${ts.SyntaxKind[node.kind]} at compile time`,
    };
  }

  private evaluateBinaryExpression(node: ts.BinaryExpression): ComptimeValue {
    const op = node.operatorToken.kind;

    // Short-circuit evaluation for && and ||
    // These work with ANY types (not just booleans) and return one of the operands
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = this.evaluateNode(node.left);
      if (left.kind === "error") return left;
      const leftBool = this.comptimeToBoolean(left);
      if (leftBool === null) {
        return { kind: "error", message: "Cannot convert to boolean in &&" };
      }
      // && returns left if falsy, otherwise evaluates and returns right
      if (!leftBool) return left;
      return this.evaluateNode(node.right);
    }

    if (op === ts.SyntaxKind.BarBarToken) {
      const left = this.evaluateNode(node.left);
      if (left.kind === "error") return left;
      const leftBool = this.comptimeToBoolean(left);
      if (leftBool === null) {
        return { kind: "error", message: "Cannot convert to boolean in ||" };
      }
      // || returns left if truthy, otherwise evaluates and returns right
      if (leftBool) return left;
      return this.evaluateNode(node.right);
    }

    // Nullish coalescing (??) - returns left if not null/undefined, else right
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      const left = this.evaluateNode(node.left);
      if (left.kind === "error") return left;
      if (left.kind !== "null" && left.kind !== "undefined") return left;
      return this.evaluateNode(node.right);
    }

    // For all other operators, evaluate both sides
    const left = this.evaluateNode(node.left);
    const right = this.evaluateNode(node.right);

    if (left.kind === "error") return left;
    if (right.kind === "error") return right;

    // Numeric operations
    if (left.kind === "number" && right.kind === "number") {
      switch (op) {
        case ts.SyntaxKind.PlusToken:
          return { kind: "number", value: left.value + right.value };
        case ts.SyntaxKind.MinusToken:
          return { kind: "number", value: left.value - right.value };
        case ts.SyntaxKind.AsteriskToken:
          return { kind: "number", value: left.value * right.value };
        case ts.SyntaxKind.SlashToken:
          return { kind: "number", value: left.value / right.value };
        case ts.SyntaxKind.PercentToken:
          return { kind: "number", value: left.value % right.value };
        case ts.SyntaxKind.AsteriskAsteriskToken:
          return { kind: "number", value: left.value ** right.value };
        case ts.SyntaxKind.LessThanToken:
          return { kind: "boolean", value: left.value < right.value };
        case ts.SyntaxKind.LessThanEqualsToken:
          return { kind: "boolean", value: left.value <= right.value };
        case ts.SyntaxKind.GreaterThanToken:
          return { kind: "boolean", value: left.value > right.value };
        case ts.SyntaxKind.GreaterThanEqualsToken:
          return { kind: "boolean", value: left.value >= right.value };
        case ts.SyntaxKind.EqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return { kind: "boolean", value: left.value === right.value };
        case ts.SyntaxKind.ExclamationEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return { kind: "boolean", value: left.value !== right.value };
        case ts.SyntaxKind.AmpersandToken:
          return { kind: "number", value: left.value & right.value };
        case ts.SyntaxKind.BarToken:
          return { kind: "number", value: left.value | right.value };
        case ts.SyntaxKind.CaretToken:
          return { kind: "number", value: left.value ^ right.value };
        case ts.SyntaxKind.LessThanLessThanToken:
          return { kind: "number", value: left.value << right.value };
        case ts.SyntaxKind.GreaterThanGreaterThanToken:
          return { kind: "number", value: left.value >> right.value };
        case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
          return { kind: "number", value: left.value >>> right.value };
      }
    }

    // String operations
    if (left.kind === "string" && right.kind === "string") {
      switch (op) {
        case ts.SyntaxKind.PlusToken:
          return { kind: "string", value: left.value + right.value };
        case ts.SyntaxKind.EqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return { kind: "boolean", value: left.value === right.value };
        case ts.SyntaxKind.ExclamationEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return { kind: "boolean", value: left.value !== right.value };
        case ts.SyntaxKind.LessThanToken:
          return { kind: "boolean", value: left.value < right.value };
        case ts.SyntaxKind.GreaterThanToken:
          return { kind: "boolean", value: left.value > right.value };
      }
    }

    // String + number concatenation
    if (
      (left.kind === "string" && right.kind === "number") ||
      (left.kind === "number" && right.kind === "string")
    ) {
      if (op === ts.SyntaxKind.PlusToken) {
        return {
          kind: "string",
          value: this.comptimeToString(left) + this.comptimeToString(right),
        };
      }
    }

    // Boolean equality operations (&&/|| are handled above with short-circuit)
    if (left.kind === "boolean" && right.kind === "boolean") {
      switch (op) {
        case ts.SyntaxKind.EqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return { kind: "boolean", value: left.value === right.value };
        case ts.SyntaxKind.ExclamationEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return { kind: "boolean", value: left.value !== right.value };
      }
    }

    return {
      kind: "error",
      message: `Cannot apply operator ${ts.SyntaxKind[op]} to ${left.kind} and ${right.kind}`,
    };
  }

  private evaluatePrefixUnary(node: ts.PrefixUnaryExpression): ComptimeValue {
    const operand = this.evaluateNode(node.operand);
    if (operand.kind === "error") return operand;

    switch (node.operator) {
      case ts.SyntaxKind.MinusToken:
        if (operand.kind === "number") {
          return { kind: "number", value: -operand.value };
        }
        break;
      case ts.SyntaxKind.PlusToken:
        if (operand.kind === "number") {
          return { kind: "number", value: +operand.value };
        }
        break;
      case ts.SyntaxKind.ExclamationToken:
        const boolValue = this.comptimeToBoolean(operand);
        if (boolValue !== null) {
          return { kind: "boolean", value: !boolValue };
        }
        break;
      case ts.SyntaxKind.TildeToken:
        if (operand.kind === "number") {
          return { kind: "number", value: ~operand.value };
        }
        break;
    }

    return {
      kind: "error",
      message: `Cannot apply unary ${ts.SyntaxKind[node.operator]} to ${operand.kind}`,
    };
  }

  private comptimeToBoolean(value: ComptimeValue): boolean | null {
    switch (value.kind) {
      case "boolean":
        return value.value;
      case "number":
        return value.value !== 0;
      case "bigint":
        return value.value !== 0n;
      case "string":
        return value.value !== "";
      case "null":
      case "undefined":
        return false;
      case "array":
      case "object":
      case "function":
        return true;
      default:
        return null;
    }
  }

  private comptimeToString(value: ComptimeValue): string {
    switch (value.kind) {
      case "string":
        return value.value;
      case "number":
        return String(value.value);
      case "boolean":
        return String(value.value);
      case "bigint":
        return `${value.value}n`;
      case "null":
        return "null";
      case "undefined":
        return "undefined";
      case "array":
        return `[${value.elements.map((e) => this.comptimeToString(e)).join(", ")}]`;
      case "object":
        const entries = Array.from(value.properties.entries())
          .map(([k, v]) => `${k}: ${this.comptimeToString(v)}`)
          .join(", ");
        return `{ ${entries} }`;
      case "function":
        return "[Function]";
      case "type":
        return "[Type]";
      case "error":
        return `[Error: ${value.message}]`;
    }
  }

  // -------------------------------------------------------------------------
  // Unique Name Generation
  // -------------------------------------------------------------------------

  generateUniqueName(prefix: string): ts.Identifier {
    // Delegate to the hygiene context when inside a scope for proper
    // scoped name mangling; fall back to the simple counter otherwise.
    if (this.hygiene.isInScope()) {
      return this.hygiene.createIdentifier(prefix);
    }
    const name = `__typemacro_${prefix}_${this.uniqueNameCounter++}__`;
    return this.factory.createIdentifier(name);
  }

  // -------------------------------------------------------------------------
  // Helper: Convert ComptimeValue to TypeScript Expression
  // -------------------------------------------------------------------------

  comptimeValueToExpression(value: ComptimeValue): ts.Expression {
    switch (value.kind) {
      case "number":
        return this.createNumericLiteral(value.value);
      case "string":
        return this.createStringLiteral(value.value);
      case "boolean":
        return this.createBooleanLiteral(value.value);
      case "bigint":
        return this.factory.createBigIntLiteral(value.value.toString());
      case "null":
        return this.factory.createNull();
      case "undefined":
        return this.factory.createIdentifier("undefined");
      case "array":
        return this.createArrayLiteral(
          value.elements.map((e) => this.comptimeValueToExpression(e))
        );
      case "object":
        const props: Array<{ name: string; value: ts.Expression }> = [];
        value.properties.forEach((v, k) => {
          props.push({ name: k, value: this.comptimeValueToExpression(v) });
        });
        return this.createObjectLiteral(props);
      case "error":
        throw new Error(`Cannot convert error value to expression: ${value.message}`);
      default:
        throw new Error(`Cannot convert ${value.kind} to expression`);
    }
  }
}

/**
 * Create a macro context for a given program and source file
 */
export function createMacroContext(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  transformContext: ts.TransformationContext,
  hygiene?: HygieneContext
): MacroContextImpl {
  return new MacroContextImpl(
    program,
    program.getTypeChecker(),
    sourceFile,
    transformContext.factory,
    transformContext,
    hygiene
  );
}

/**
 * Standalone markPure utility for use outside of MacroContext.
 * Use this in places without a MacroContext (e.g., the transformer itself).
 *
 * Bundlers (esbuild, webpack, Rollup) recognize this annotation on call
 * expressions and `new` expressions to indicate they have no side effects
 * and can be dropped if unused.
 */
export function markPure<T extends ts.Node>(node: T): T {
  ts.addSyntheticLeadingComment(node, ts.SyntaxKind.MultiLineCommentTrivia, "#__PURE__", false);
  return node;
}
