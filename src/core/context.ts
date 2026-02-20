/**
 * MacroContext Implementation - Provides utilities for macro expansion
 */

import * as ts from "typescript";
import { MacroContext, ComptimeValue, MacroDiagnostic } from "./types.js";
import { HygieneContext, globalHygiene } from "./hygiene.js";
import type { MacroExpansionCache } from "./cache.js";
import { stripPositions } from "./ast-utils.js";

// Pre-allocated sentinel values for common comptime results.
// Avoids allocating a new object on every boolean/null/undefined evaluation.
const COMPTIME_TRUE: ComptimeValue = Object.freeze({
  kind: "boolean",
  value: true,
}) as ComptimeValue;
const COMPTIME_FALSE: ComptimeValue = Object.freeze({
  kind: "boolean",
  value: false,
}) as ComptimeValue;
const COMPTIME_NULL: ComptimeValue = Object.freeze({
  kind: "null",
}) as ComptimeValue;
const COMPTIME_UNDEFINED: ComptimeValue = Object.freeze({
  kind: "undefined",
}) as ComptimeValue;

export class MacroContextImpl implements MacroContext {
  private diagnostics: MacroDiagnostic[] = [];
  private uniqueNameCounter = 0;

  /**
   * Shared printer instance for node-to-string conversion.
   * Creating a printer is expensive; reuse across the lifetime of the context.
   */
  private _printer: ts.Printer | undefined;

  /** Hygiene context for scoped identifier generation */
  public readonly hygiene: HygieneContext;

  /** Optional disk-backed expansion cache for cross-compilation caching */
  public readonly expansionCache?: MacroExpansionCache;

  constructor(
    public readonly program: ts.Program,
    public readonly typeChecker: ts.TypeChecker,
    public readonly sourceFile: ts.SourceFile,
    public readonly factory: ts.NodeFactory,
    public readonly transformContext: ts.TransformationContext,
    hygiene?: HygieneContext,
    expansionCache?: MacroExpansionCache,
  ) {
    this.hygiene = hygiene ?? globalHygiene;
    this.expansionCache = expansionCache;
  }

  /** Lazily-created shared printer instance */
  get printer(): ts.Printer {
    return (this._printer ??= ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
    }));
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
    properties: Array<{ name: string; value: ts.Expression }>,
  ): ts.ObjectLiteralExpression {
    const propAssignments = properties.map(({ name, value }) =>
      this.factory.createPropertyAssignment(
        this.factory.createIdentifier(name),
        value,
      ),
    );
    return this.factory.createObjectLiteralExpression(propAssignments, true);
  }

  parseExpression(code: string): ts.Expression {
    // Create a temporary source file to parse the expression
    const wrapper = `const __expr__ = ${code};`;
    const tempSource = ts.createSourceFile(
      "__macro_temp__.ts",
      wrapper,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    // Check for parse errors — ts.createSourceFile never throws, it just
    // records diagnostics and produces partial/error nodes.
    const diags = (tempSource as unknown as { parseDiagnostics?: unknown[] })
      .parseDiagnostics;
    if (diags && diags.length > 0) {
      throw new Error(`Failed to parse expression: ${code}`);
    }

    // The wrapper should produce exactly one statement
    if (tempSource.statements.length !== 1) {
      throw new Error(`Failed to parse expression: ${code}`);
    }

    // Extract the expression from the variable declaration
    const statement = tempSource.statements[0];
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations[0];
      if (declaration.initializer) {
        // Strip source positions so the node can be printed against any source file.
        // Parsed nodes carry positions from the temp source file; without this,
        // ts.Printer would look up text in the wrong file and produce garbage.
        return stripPositions(declaration.initializer) as ts.Expression;
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
      ts.ScriptKind.TS,
    );
    return Array.from(tempSource.statements).map(
      (s) => stripPositions(s) as ts.Statement,
    );
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
  //
  // Performance-critical path. Key optimizations:
  // - SyntaxKind-based dispatch via switch instead of chained ts.isXxx() guards
  // - Reuse pre-allocated sentinel objects for common results
  // - Avoid intermediate allocations where possible
  // -------------------------------------------------------------------------

  evaluate(node: ts.Node): ComptimeValue {
    return this.evaluateNode(node);
  }

  isComptime(node: ts.Node): boolean {
    switch (node.kind) {
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.TrueKeyword:
      case ts.SyntaxKind.FalseKeyword:
      case ts.SyntaxKind.NullKeyword:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        return true;

      case ts.SyntaxKind.ArrayLiteralExpression: {
        const arr = node as ts.ArrayLiteralExpression;
        for (let i = 0; i < arr.elements.length; i++) {
          if (!this.isComptime(arr.elements[i])) return false;
        }
        return true;
      }

      case ts.SyntaxKind.ObjectLiteralExpression: {
        const obj = node as ts.ObjectLiteralExpression;
        for (let i = 0; i < obj.properties.length; i++) {
          const p = obj.properties[i];
          if (!ts.isPropertyAssignment(p) || !this.isComptime(p.initializer))
            return false;
        }
        return true;
      }

      case ts.SyntaxKind.BinaryExpression: {
        const bin = node as ts.BinaryExpression;
        return this.isComptime(bin.left) && this.isComptime(bin.right);
      }

      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.isComptime((node as ts.PrefixUnaryExpression).operand);

      case ts.SyntaxKind.PostfixUnaryExpression:
        return this.isComptime((node as ts.PostfixUnaryExpression).operand);

      case ts.SyntaxKind.ConditionalExpression: {
        const cond = node as ts.ConditionalExpression;
        return (
          this.isComptime(cond.condition) &&
          this.isComptime(cond.whenTrue) &&
          this.isComptime(cond.whenFalse)
        );
      }

      case ts.SyntaxKind.ParenthesizedExpression:
        return this.isComptime((node as ts.ParenthesizedExpression).expression);

      case ts.SyntaxKind.Identifier: {
        const symbol = this.typeChecker.getSymbolAtLocation(node);
        if (symbol) {
          const declarations = symbol.getDeclarations();
          if (declarations && declarations.length > 0) {
            const decl = declarations[0];
            if (ts.isVariableDeclaration(decl)) {
              const parent = decl.parent;
              if (
                ts.isVariableDeclarationList(parent) &&
                parent.flags & ts.NodeFlags.Const
              ) {
                return decl.initializer
                  ? this.isComptime(decl.initializer)
                  : false;
              }
            }
          }
        }
        return false;
      }

      default:
        return false;
    }
  }

  private evaluateNode(node: ts.Node): ComptimeValue {
    switch (node.kind) {
      case ts.SyntaxKind.NumericLiteral:
        return { kind: "number", value: +(node as ts.NumericLiteral).text };

      case ts.SyntaxKind.StringLiteral:
        return { kind: "string", value: (node as ts.StringLiteral).text };

      case ts.SyntaxKind.TrueKeyword:
        return COMPTIME_TRUE;

      case ts.SyntaxKind.FalseKeyword:
        return COMPTIME_FALSE;

      case ts.SyntaxKind.NullKeyword:
        return COMPTIME_NULL;

      case ts.SyntaxKind.UndefinedKeyword:
        return COMPTIME_UNDEFINED;

      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        return {
          kind: "string",
          value: (node as ts.NoSubstitutionTemplateLiteral).text,
        };

      case ts.SyntaxKind.ParenthesizedExpression:
        return this.evaluateNode(
          (node as ts.ParenthesizedExpression).expression,
        );

      case ts.SyntaxKind.ArrayLiteralExpression:
        return this.evaluateArrayLiteral(node as ts.ArrayLiteralExpression);

      case ts.SyntaxKind.ObjectLiteralExpression:
        return this.evaluateObjectLiteral(node as ts.ObjectLiteralExpression);

      case ts.SyntaxKind.BinaryExpression:
        return this.evaluateBinaryExpression(node as ts.BinaryExpression);

      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.evaluatePrefixUnary(node as ts.PrefixUnaryExpression);

      case ts.SyntaxKind.ConditionalExpression:
        return this.evaluateConditional(node as ts.ConditionalExpression);

      case ts.SyntaxKind.TemplateExpression:
        return this.evaluateTemplate(node as ts.TemplateExpression);

      case ts.SyntaxKind.ArrowFunction:
        return this.evaluateArrowFunction(node as ts.ArrowFunction);

      case ts.SyntaxKind.CallExpression:
        return this.evaluateCallExpression(node as ts.CallExpression);

      default:
        return {
          kind: "error",
          message: `Cannot evaluate node of kind ${ts.SyntaxKind[node.kind]} at compile time`,
        };
    }
  }

  private evaluateArrayLiteral(node: ts.ArrayLiteralExpression): ComptimeValue {
    const elements: ComptimeValue[] = new Array(node.elements.length);
    for (let i = 0; i < node.elements.length; i++) {
      const el = this.evaluateNode(node.elements[i]);
      if (el.kind === "error") return el;
      elements[i] = el;
    }
    return { kind: "array", elements };
  }

  private evaluateObjectLiteral(
    node: ts.ObjectLiteralExpression,
  ): ComptimeValue {
    const properties = new Map<string, ComptimeValue>();
    for (let i = 0; i < node.properties.length; i++) {
      const prop = node.properties[i];
      if (ts.isPropertyAssignment(prop)) {
        const nameNode = prop.name;
        const name =
          nameNode.kind === ts.SyntaxKind.Identifier
            ? (nameNode as ts.Identifier).text
            : nameNode.kind === ts.SyntaxKind.StringLiteral
              ? (nameNode as ts.StringLiteral).text
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

  private evaluateConditional(node: ts.ConditionalExpression): ComptimeValue {
    const condition = this.evaluateNode(node.condition);
    if (condition.kind === "error") return condition;
    const condValue = this.comptimeToBoolean(condition);
    if (condValue === null) {
      return { kind: "error", message: "Cannot convert to boolean" };
    }
    return condValue
      ? this.evaluateNode(node.whenTrue)
      : this.evaluateNode(node.whenFalse);
  }

  private evaluateTemplate(node: ts.TemplateExpression): ComptimeValue {
    let result = node.head.text;
    for (let i = 0; i < node.templateSpans.length; i++) {
      const span = node.templateSpans[i];
      const value = this.evaluateNode(span.expression);
      if (value.kind === "error") return value;
      result += this.comptimeToString(value) + span.literal.text;
    }
    return { kind: "string", value: result };
  }

  private evaluateArrowFunction(node: ts.ArrowFunction): ComptimeValue {
    return {
      kind: "function",
      fn: (..._args: ComptimeValue[]) => {
        if (ts.isBlock(node.body)) {
          return {
            kind: "error",
            message: "Block body arrow functions not yet supported",
          };
        }
        return this.evaluateNode(node.body);
      },
    };
  }

  private evaluateCallExpression(node: ts.CallExpression): ComptimeValue {
    const fn = this.evaluateNode(node.expression);
    if (fn.kind === "function") {
      const args: ComptimeValue[] = new Array(node.arguments.length);
      for (let i = 0; i < node.arguments.length; i++) {
        args[i] = this.evaluateNode(node.arguments[i]);
        if (args[i].kind === "error") return args[i];
      }
      return fn.fn(...args);
    }
    return {
      kind: "error",
      message: `Cannot evaluate node of kind ${ts.SyntaxKind[node.kind]} at compile time`,
    };
  }

  private evaluateBinaryExpression(node: ts.BinaryExpression): ComptimeValue {
    const left = this.evaluateNode(node.left);
    if (left.kind === "error") return left;
    const right = this.evaluateNode(node.right);
    if (right.kind === "error") return right;

    const op = node.operatorToken.kind;

    // Fast path: both operands are numbers (most common case)
    if (left.kind === "number" && right.kind === "number") {
      const lv = left.value;
      const rv = right.value;
      switch (op) {
        case ts.SyntaxKind.PlusToken:
          return { kind: "number", value: lv + rv };
        case ts.SyntaxKind.MinusToken:
          return { kind: "number", value: lv - rv };
        case ts.SyntaxKind.AsteriskToken:
          return { kind: "number", value: lv * rv };
        case ts.SyntaxKind.SlashToken:
          return { kind: "number", value: lv / rv };
        case ts.SyntaxKind.PercentToken:
          return { kind: "number", value: lv % rv };
        case ts.SyntaxKind.AsteriskAsteriskToken:
          return { kind: "number", value: lv ** rv };
        case ts.SyntaxKind.LessThanToken:
          return lv < rv ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.LessThanEqualsToken:
          return lv <= rv ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.GreaterThanToken:
          return lv > rv ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.GreaterThanEqualsToken:
          return lv >= rv ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.EqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return lv === rv ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.ExclamationEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return lv !== rv ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.AmpersandToken:
          return { kind: "number", value: lv & rv };
        case ts.SyntaxKind.BarToken:
          return { kind: "number", value: lv | rv };
        case ts.SyntaxKind.CaretToken:
          return { kind: "number", value: lv ^ rv };
        case ts.SyntaxKind.LessThanLessThanToken:
          return { kind: "number", value: lv << rv };
        case ts.SyntaxKind.GreaterThanGreaterThanToken:
          return { kind: "number", value: lv >> rv };
        case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
          return { kind: "number", value: lv >>> rv };
      }
    }

    // String operations
    if (left.kind === "string" && right.kind === "string") {
      switch (op) {
        case ts.SyntaxKind.PlusToken:
          return { kind: "string", value: left.value + right.value };
        case ts.SyntaxKind.EqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return left.value === right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.ExclamationEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return left.value !== right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.LessThanToken:
          return left.value < right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.GreaterThanToken:
          return left.value > right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
      }
    }

    // String + number concatenation
    if (op === ts.SyntaxKind.PlusToken) {
      if (
        (left.kind === "string" && right.kind === "number") ||
        (left.kind === "number" && right.kind === "string")
      ) {
        return {
          kind: "string",
          value: this.comptimeToString(left) + this.comptimeToString(right),
        };
      }
    }

    // Boolean operations
    if (left.kind === "boolean" && right.kind === "boolean") {
      switch (op) {
        case ts.SyntaxKind.AmpersandAmpersandToken:
          return left.value && right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.BarBarToken:
          return left.value || right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.EqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return left.value === right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
        case ts.SyntaxKind.ExclamationEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return left.value !== right.value ? COMPTIME_TRUE : COMPTIME_FALSE;
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
          return operand; // +n is a no-op for numbers
        }
        break;
      case ts.SyntaxKind.ExclamationToken: {
        const boolValue = this.comptimeToBoolean(operand);
        if (boolValue !== null) {
          return boolValue ? COMPTIME_FALSE : COMPTIME_TRUE;
        }
        break;
      }
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
        return value.value ? "true" : "false";
      case "null":
        return "null";
      case "undefined":
        return "undefined";
      case "array":
        return `[${value.elements.map((e) => this.comptimeToString(e)).join(", ")}]`;
      case "object": {
        const entries = Array.from(value.properties.entries())
          .map(([k, v]) => `${k}: ${this.comptimeToString(v)}`)
          .join(", ");
        return `{ ${entries} }`;
      }
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
      case "null":
        return this.factory.createNull();
      case "undefined":
        return this.factory.createIdentifier("undefined");
      case "array":
        return this.createArrayLiteral(
          value.elements.map((e) => this.comptimeValueToExpression(e)),
        );
      case "object":
        const props: Array<{ name: string; value: ts.Expression }> = [];
        value.properties.forEach((v, k) => {
          props.push({ name: k, value: this.comptimeValueToExpression(v) });
        });
        return this.createObjectLiteral(props);
      case "error":
        throw new Error(
          `Cannot convert error value to expression: ${value.message}`,
        );
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
  hygiene?: HygieneContext,
  expansionCache?: MacroExpansionCache,
): MacroContextImpl {
  return new MacroContextImpl(
    program,
    program.getTypeChecker(),
    sourceFile,
    transformContext.factory,
    transformContext,
    hygiene,
    expansionCache,
  );
}
