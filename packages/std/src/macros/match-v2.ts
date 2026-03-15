/**
 * Fluent Pattern Matching — Waves 1–3 (PEP-008)
 *
 * Implements the `.case().if().then().else()` fluent chain for the `match()` macro.
 * This module is called from the existing match macro when a chain call is detected.
 *
 * Supported patterns:
 * - Wave 1: Literals, wildcard (`_`), variable binding
 * - Wave 2: Array patterns (`[a, b]`, `[head, ...tail]`, `[]`),
 *           Object patterns (`{ a, b }`, `{ name: n }`, `{ kind: "circle" }`),
 *           Nested patterns (`{ user: { name } }`, `[{ x }, { y }]`),
 *           Rest/spread patterns for both arrays and objects
 * - Wave 3: Type constructor patterns (`String(s)`, `Date(d)`, `Array(a)`),
 *           OR patterns (`.or()`), AS patterns (`.as()`),
 *           Regex patterns (`/regex/` with `.as()` capture group binding)
 *
 * Compilation target: IIFE with scrutinee evaluated once.
 *
 * @example
 * ```typescript
 * match(value)
 *   .case(String(s)).then(s.length)
 *   .case(Date(d)).then(d.toISOString())
 *   .case(200).or(201).or(204).then("ok")
 *   .case([x, y]).as(p).then(p)
 *   .case(/^(\w+)@(\w+)$/).as([_, user, domain]).then({ user, domain })
 *   .else("unknown")
 * ```
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";

// ============================================================================
// Chain Parsing
// ============================================================================

interface ChainLink {
  method: string;
  args: readonly ts.Expression[];
  node: ts.CallExpression;
}

interface CaseArm {
  pattern: ts.Expression;
  alternatives: ts.Expression[];
  guard?: ts.Expression;
  result: ts.Expression;
  asPattern?: ts.Expression;
}

// ============================================================================
// Pattern Types
// ============================================================================

interface ArrayElementPattern {
  pattern: PatternInfo;
  isRest: boolean;
}

interface ObjectPropertyPattern {
  key: string;
  pattern: PatternInfo;
  isRest: boolean;
}

/**
 * Defines how an extractor pattern checks and binds values.
 *
 * - `sum-variant`: Tagged union variant (e.g. Some, Left). Checks a discriminant
 *   field and extracts payload fields.
 * - `product`: Structural type (e.g. Point). Checks required fields exist and
 *   maps positional bindings to field names.
 * - `custom`: User-defined Destructure instance. Generates an `extract()` call
 *   with undefined check.
 */
interface ExtractorDef {
  kind: "sum-variant" | "product" | "custom";
  discriminantField?: string;
  discriminantValue?: string | boolean;
  payloadFields?: string[];
  productFields?: string[];
  zeroArg: boolean;
}

type PatternInfo =
  | { kind: "literal"; node: ts.Expression }
  | { kind: "wildcard" }
  | { kind: "variable"; name: string }
  | { kind: "array"; elements: ArrayElementPattern[]; hasRest: boolean }
  | { kind: "object"; properties: ObjectPropertyPattern[]; hasRest: boolean }
  | { kind: "type-constructor"; constructorName: string; binding: PatternInfo }
  | { kind: "extractor"; extractorName: string; bindings: PatternInfo[]; def: ExtractorDef }
  | { kind: "regex"; node: ts.Expression }
  | { kind: "unsupported"; node: ts.Expression };

// ============================================================================
// Extractor Registry
// ============================================================================

/**
 * Built-in extractors for standard FP sum types.
 * These generate inlined structural checks (zero-cost — no runtime Destructure call).
 */
const KNOWN_EXTRACTORS: Record<string, ExtractorDef> = {
  Some: {
    kind: "sum-variant",
    discriminantField: "_tag",
    discriminantValue: "Some",
    payloadFields: ["value"],
    zeroArg: false,
  },
  None: {
    kind: "sum-variant",
    discriminantField: "_tag",
    discriminantValue: "None",
    zeroArg: true,
  },
  Left: {
    kind: "sum-variant",
    discriminantField: "_tag",
    discriminantValue: "Left",
    payloadFields: ["value"],
    zeroArg: false,
  },
  Right: {
    kind: "sum-variant",
    discriminantField: "_tag",
    discriminantValue: "Right",
    payloadFields: ["value"],
    zeroArg: false,
  },
  Ok: {
    kind: "sum-variant",
    discriminantField: "ok",
    discriminantValue: true,
    payloadFields: ["value"],
    zeroArg: false,
  },
  Err: {
    kind: "sum-variant",
    discriminantField: "ok",
    discriminantValue: false,
    payloadFields: ["error"],
    zeroArg: false,
  },
  Cons: {
    kind: "sum-variant",
    discriminantField: "_tag",
    discriminantValue: "Cons",
    payloadFields: ["head", "tail"],
    zeroArg: false,
  },
  Nil: { kind: "sum-variant", discriminantField: "_tag", discriminantValue: "Nil", zeroArg: true },
};

const registeredProductExtractors: Map<string, string[]> = new Map();
const registeredCustomExtractors: Set<string> = new Set();

/**
 * Register a product type extractor for pattern matching.
 * Maps positional bindings to field names in declaration order.
 *
 * @example
 * ```typescript
 * registerProductExtractor("Point", ["x", "y"]);
 * // Now match(p).case(Point(x, y)).then(x + y) works
 * ```
 */
export function registerProductExtractor(name: string, fields: string[]): void {
  registeredProductExtractors.set(name, fields);
}

/**
 * Register a custom Destructure extractor for pattern matching.
 * The extractor must have a static `extract(input): Output | undefined` method.
 *
 * @example
 * ```typescript
 * registerCustomExtractor("Email");
 * // Now match(s).case(Email({ user, domain })).then(...) works
 * ```
 */
export function registerCustomExtractor(name: string): void {
  registeredCustomExtractors.add(name);
}

/**
 * Clear all registered extractors. Useful for test isolation.
 */
export function clearRegisteredExtractors(): void {
  registeredProductExtractors.clear();
  registeredCustomExtractors.clear();
}

/**
 * Walk from the outermost chain CallExpression inward to collect all links.
 * Returns links in source order (left-to-right).
 */
function parseChain(outermost: ts.CallExpression): { root: ts.CallExpression; links: ChainLink[] } {
  const links: ChainLink[] = [];
  let current: ts.Expression = outermost;

  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const call = current;
    const propAccess = call.expression as ts.PropertyAccessExpression;
    links.push({
      method: propAccess.name.text,
      args: call.arguments,
      node: call,
    });
    current = propAccess.expression;
  }

  if (!ts.isCallExpression(current)) {
    throw new Error("Fluent match chain does not root in a call expression");
  }

  links.reverse();
  return { root: current, links };
}

/**
 * Parse chain links into structured case arms and an optional else clause.
 *
 * Grammar:
 *   chain := match(scrutinee)
 *            (.case(pattern) [.or(alt)]* [.as(binding)] [.if(guard)] .then(result))*
 *            [.else(default)]
 */
function parseArms(
  ctx: MacroContext,
  links: ChainLink[]
): { arms: CaseArm[]; elseResult?: ts.Expression } {
  const arms: CaseArm[] = [];
  let currentPattern: ts.Expression | undefined;
  let currentAlternatives: ts.Expression[] = [];
  let currentGuard: ts.Expression | undefined;
  let currentAsPattern: ts.Expression | undefined;
  let elseResult: ts.Expression | undefined;

  for (const link of links) {
    switch (link.method) {
      case "case":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .case() requires a pattern argument");
          break;
        }
        currentPattern = link.args[0];
        currentAlternatives = [];
        currentGuard = undefined;
        currentAsPattern = undefined;
        break;

      case "or":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .or() requires a pattern argument");
          break;
        }
        currentAlternatives.push(link.args[0]);
        break;

      case "as":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .as() requires a binding argument");
          break;
        }
        currentAsPattern = link.args[0];
        break;

      case "if":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .if() requires a guard expression");
          break;
        }
        currentGuard = link.args[0];
        break;

      case "then":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .then() requires a result expression");
          break;
        }
        if (currentPattern === undefined) {
          ctx.reportError(link.node, "match: .then() without preceding .case()");
          break;
        }
        arms.push({
          pattern: currentPattern,
          alternatives: currentAlternatives,
          guard: currentGuard,
          result: link.args[0],
          asPattern: currentAsPattern,
        });
        currentPattern = undefined;
        currentAlternatives = [];
        currentGuard = undefined;
        currentAsPattern = undefined;
        break;

      case "else":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .else() requires a default expression");
          break;
        }
        elseResult = link.args[0];
        break;

      default:
        ctx.reportError(link.node, `match: unknown chain method '.${link.method}()'`);
    }
  }

  return { arms, elseResult };
}

// ============================================================================
// Pattern Analysis
// ============================================================================

function analyzePattern(pattern: ts.Expression): PatternInfo {
  // Literals
  if (ts.isNumericLiteral(pattern)) {
    return { kind: "literal", node: pattern };
  }
  if (ts.isStringLiteral(pattern)) {
    return { kind: "literal", node: pattern };
  }
  if (pattern.kind === ts.SyntaxKind.TrueKeyword || pattern.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "literal", node: pattern };
  }
  if (pattern.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "literal", node: pattern };
  }
  if (ts.isPrefixUnaryExpression(pattern) && ts.isNumericLiteral(pattern.operand)) {
    return { kind: "literal", node: pattern };
  }

  // Identifiers: wildcard, undefined literal, zero-arg extractors, variable binding
  if (ts.isIdentifier(pattern)) {
    if (pattern.text === "_") {
      return { kind: "wildcard" };
    }
    if (pattern.text === "undefined") {
      return { kind: "literal", node: pattern };
    }
    const zeroArgDef = KNOWN_EXTRACTORS[pattern.text];
    if (zeroArgDef && zeroArgDef.zeroArg) {
      return { kind: "extractor", extractorName: pattern.text, bindings: [], def: zeroArgDef };
    }
    return { kind: "variable", name: pattern.text };
  }

  // Array patterns: [a, b], [head, ...tail], []
  if (ts.isArrayLiteralExpression(pattern)) {
    const elements: ArrayElementPattern[] = [];
    let hasRest = false;

    for (const elem of pattern.elements) {
      if (ts.isSpreadElement(elem)) {
        hasRest = true;
        elements.push({
          pattern: analyzePattern(elem.expression),
          isRest: true,
        });
      } else {
        elements.push({
          pattern: analyzePattern(elem),
          isRest: false,
        });
      }
    }

    return { kind: "array", elements, hasRest };
  }

  // Object patterns: { a, b }, { name: n }, { kind: "circle", radius: r }
  if (ts.isObjectLiteralExpression(pattern)) {
    const properties: ObjectPropertyPattern[] = [];
    let hasRest = false;

    for (const prop of pattern.properties) {
      if (ts.isSpreadAssignment(prop)) {
        hasRest = true;
        const name = ts.isIdentifier(prop.expression) ? prop.expression.text : "__rest";
        properties.push({
          key: name,
          pattern: { kind: "variable", name },
          isRest: true,
        });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        // { name } → binding to 'name'
        properties.push({
          key: prop.name.text,
          pattern: { kind: "variable", name: prop.name.text },
          isRest: false,
        });
      } else if (ts.isPropertyAssignment(prop)) {
        const keyName = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;

        if (keyName === undefined) {
          continue;
        }

        // Recursively analyze the value — could be literal, identifier, nested object/array
        const valuePat = analyzePattern(prop.initializer);
        properties.push({
          key: keyName,
          pattern: valuePat,
          isRest: false,
        });
      }
    }

    return { kind: "object", properties, hasRest };
  }

  // CallExpression: Type constructors or extractor patterns
  if (ts.isCallExpression(pattern) && ts.isIdentifier(pattern.expression)) {
    const name = pattern.expression.text;

    // Check extractor registries before falling back to type-constructor
    const knownDef = KNOWN_EXTRACTORS[name];
    const productFields = registeredProductExtractors.get(name);
    const isCustom = registeredCustomExtractors.has(name);

    if (knownDef && !knownDef.zeroArg) {
      const bindings =
        pattern.arguments.length > 0 ? Array.from(pattern.arguments).map(analyzePattern) : [];
      return { kind: "extractor", extractorName: name, bindings, def: knownDef };
    }

    if (productFields) {
      const def: ExtractorDef = { kind: "product", productFields, zeroArg: false };
      const bindings =
        pattern.arguments.length > 0 ? Array.from(pattern.arguments).map(analyzePattern) : [];
      return { kind: "extractor", extractorName: name, bindings, def };
    }

    if (isCustom) {
      const def: ExtractorDef = { kind: "custom", zeroArg: false };
      const bindings =
        pattern.arguments.length > 0 ? Array.from(pattern.arguments).map(analyzePattern) : [];
      return { kind: "extractor", extractorName: name, bindings, def };
    }

    // Fall through to type-constructor for String, Date, etc.
    const binding =
      pattern.arguments.length >= 1
        ? analyzePattern(pattern.arguments[0])
        : ({ kind: "wildcard" } as const);
    return { kind: "type-constructor", constructorName: name, binding };
  }

  // Regex patterns: /regex/
  if (pattern.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    return { kind: "regex", node: pattern };
  }

  return { kind: "unsupported", node: pattern };
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Map of built-in type constructor names to their `typeof` check strings.
 */
const TYPEOF_MAP: Record<string, string> = {
  String: "string",
  Number: "number",
  Boolean: "boolean",
  BigInt: "bigint",
  Symbol: "symbol",
  Function: "function",
};

/**
 * Generate the IIFE that implements the match expression.
 *
 * For simple cases (single literal + else, no guards), generates a ternary
 * expression instead of a full IIFE for zero-cost output.
 */
export function expandFluentMatch(
  ctx: MacroContext,
  chainExpr: ts.CallExpression,
  rootArgs: readonly ts.Expression[]
): ts.Expression {
  const { root, links } = parseChain(chainExpr);
  const scrutinee = rootArgs[0];

  if (!scrutinee) {
    ctx.reportError(chainExpr, "match: requires a scrutinee argument");
    return chainExpr;
  }

  const { arms, elseResult } = parseArms(ctx, links);

  if (arms.length === 0 && elseResult === undefined) {
    ctx.reportError(chainExpr, "match: chain has no .case().then() arms");
    return chainExpr;
  }

  // Optimization: single literal arm + else, no guard, no or, no as → ternary
  if (arms.length === 1 && elseResult !== undefined) {
    const arm = arms[0];
    if (arm.alternatives.length === 0 && !arm.asPattern) {
      const pattern = analyzePattern(arm.pattern);
      if (pattern.kind === "literal" && !arm.guard) {
        return generateTernary(ctx, scrutinee, arm, pattern.node, elseResult);
      }
    }
  }

  return generateIIFE(ctx, scrutinee, arms, elseResult);
}

function generateTernary(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arm: CaseArm,
  literalNode: ts.Expression,
  elseResult: ts.Expression
): ts.Expression {
  const f = ctx.factory;
  const condition = f.createBinaryExpression(
    scrutinee,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    literalNode
  );
  return f.createConditionalExpression(
    condition,
    f.createToken(ts.SyntaxKind.QuestionToken),
    arm.result,
    f.createToken(ts.SyntaxKind.ColonToken),
    elseResult
  );
}

// ============================================================================
// Pattern Code Generation (recursive for nested patterns)
// ============================================================================

/**
 * Collect all variable bindings from a pattern tree (for nested patterns).
 * Returns binding statements that destructure from the given accessor expression.
 */
function collectBindings(
  f: ts.NodeFactory,
  pattern: PatternInfo,
  accessor: ts.Expression
): ts.Statement[] {
  switch (pattern.kind) {
    case "variable":
      return [
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [
              f.createVariableDeclaration(
                f.createIdentifier(pattern.name),
                undefined,
                undefined,
                accessor
              ),
            ],
            ts.NodeFlags.Const
          )
        ),
      ];

    case "array": {
      const stmts: ts.Statement[] = [];
      const nonRestElements = pattern.elements.filter((e) => !e.isRest);
      const restElement = pattern.elements.find((e) => e.isRest);

      for (let i = 0; i < nonRestElements.length; i++) {
        const elem = nonRestElements[i];
        if (elem.pattern.kind === "wildcard") continue;

        const elemAccess = f.createElementAccessExpression(accessor, i);

        if (elem.pattern.kind === "variable") {
          stmts.push(
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    f.createIdentifier(elem.pattern.name),
                    undefined,
                    undefined,
                    elemAccess
                  ),
                ],
                ts.NodeFlags.Const
              )
            )
          );
        } else if (elem.pattern.kind === "literal") {
          // Literal in array position — no binding, checked via condition
        } else {
          stmts.push(...collectBindings(f, elem.pattern, elemAccess));
        }
      }

      if (restElement && restElement.pattern.kind === "variable") {
        // const tail = accessor.slice(nonRestElements.length)
        const sliceCall = f.createCallExpression(
          f.createPropertyAccessExpression(accessor, "slice"),
          undefined,
          [f.createNumericLiteral(nonRestElements.length)]
        );
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  f.createIdentifier(restElement.pattern.name),
                  undefined,
                  undefined,
                  sliceCall
                ),
              ],
              ts.NodeFlags.Const
            )
          )
        );
      }

      return stmts;
    }

    case "object": {
      const stmts: ts.Statement[] = [];
      const nonRestProps = pattern.properties.filter((p) => !p.isRest);
      const restProp = pattern.properties.find((p) => p.isRest);

      for (const prop of nonRestProps) {
        const propAccess = f.createPropertyAccessExpression(accessor, prop.key);

        if (prop.pattern.kind === "variable") {
          stmts.push(
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    f.createIdentifier(prop.pattern.name),
                    undefined,
                    undefined,
                    propAccess
                  ),
                ],
                ts.NodeFlags.Const
              )
            )
          );
        } else if (prop.pattern.kind === "literal") {
          // Literal match — no binding, already checked via condition
        } else {
          stmts.push(...collectBindings(f, prop.pattern, propAccess));
        }
      }

      if (restProp && restProp.pattern.kind === "variable") {
        const excludeKeys = nonRestProps.map((p) => p.key);
        const restName = restProp.pattern.name;

        const bindingElements = [
          ...excludeKeys.map((k) =>
            f.createBindingElement(
              undefined,
              f.createIdentifier(k),
              f.createIdentifier(`_excl_${k}`)
            )
          ),
          f.createBindingElement(
            f.createToken(ts.SyntaxKind.DotDotDotToken),
            undefined,
            f.createIdentifier(restName)
          ),
        ];

        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  f.createObjectBindingPattern(bindingElements),
                  undefined,
                  undefined,
                  accessor
                ),
              ],
              ts.NodeFlags.Const
            )
          )
        );
      }

      return stmts;
    }

    case "type-constructor":
      return collectBindings(f, pattern.binding, accessor);

    case "extractor": {
      const { def, bindings } = pattern;
      const stmts: ts.Statement[] = [];

      if (def.kind === "sum-variant") {
        const payloadFields = def.payloadFields ?? [];
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = payloadFields[i];
          if (!field) continue;
          const fieldAccess = f.createPropertyAccessExpression(accessor, field);
          stmts.push(...collectBindings(f, binding, fieldAccess));
        }
      } else if (def.kind === "product") {
        const fields = def.productFields ?? [];
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = fields[i];
          if (!field) continue;
          const fieldAccess = f.createPropertyAccessExpression(accessor, field);
          stmts.push(...collectBindings(f, binding, fieldAccess));
        }
      } else if (def.kind === "custom") {
        // Custom extractors: bindings apply to the extracted result.
        // The temp variable for the result is set up in generateArmStatements;
        // here we collect from the first binding against that temp.
        // This path is handled in generateArmStatements for custom extractors.
      }

      return stmts;
    }

    case "regex":
      return [];

    default:
      return [];
  }
}

/**
 * Build the structural condition expression for a pattern.
 * Returns undefined for patterns that always match (wildcard, variable).
 */
function buildCondition(
  f: ts.NodeFactory,
  pattern: PatternInfo,
  accessor: ts.Expression
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "literal":
      return f.createBinaryExpression(
        accessor,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        pattern.node
      );

    case "wildcard":
    case "variable":
      return undefined;

    case "array": {
      const parts: ts.Expression[] = [];

      // Array.isArray(accessor)
      parts.push(
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
          undefined,
          [accessor]
        )
      );

      const nonRestElements = pattern.elements.filter((e) => !e.isRest);
      const hasRest = pattern.hasRest;

      // Length check
      if (hasRest) {
        if (nonRestElements.length > 0) {
          parts.push(
            f.createBinaryExpression(
              f.createPropertyAccessExpression(accessor, "length"),
              ts.SyntaxKind.GreaterThanEqualsToken,
              f.createNumericLiteral(nonRestElements.length)
            )
          );
        }
      } else {
        parts.push(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(accessor, "length"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createNumericLiteral(nonRestElements.length)
          )
        );
      }

      // Literal element checks
      for (let i = 0; i < nonRestElements.length; i++) {
        const elem = nonRestElements[i];
        if (elem.pattern.kind === "literal") {
          parts.push(
            f.createBinaryExpression(
              f.createElementAccessExpression(accessor, i),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              elem.pattern.node
            )
          );
        } else if (elem.pattern.kind !== "wildcard" && elem.pattern.kind !== "variable") {
          const nested = buildCondition(
            f,
            elem.pattern,
            f.createElementAccessExpression(accessor, i)
          );
          if (nested) parts.push(nested);
        }
      }

      return parts.reduce((a, b) =>
        f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
      );
    }

    case "object": {
      const parts: ts.Expression[] = [];
      const nonRestProps = pattern.properties.filter((p) => !p.isRest);

      // typeof accessor === "object" && accessor !== null
      parts.push(
        f.createBinaryExpression(
          f.createTypeOfExpression(accessor),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          f.createStringLiteral("object")
        )
      );
      parts.push(
        f.createBinaryExpression(
          accessor,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          f.createNull()
        )
      );

      for (const prop of nonRestProps) {
        parts.push(
          f.createBinaryExpression(
            f.createStringLiteral(prop.key),
            ts.SyntaxKind.InKeyword,
            accessor
          )
        );

        if (prop.pattern.kind === "literal") {
          parts.push(
            f.createBinaryExpression(
              f.createPropertyAccessExpression(accessor, prop.key),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              prop.pattern.node
            )
          );
        } else if (prop.pattern.kind !== "wildcard" && prop.pattern.kind !== "variable") {
          const nested = buildCondition(
            f,
            prop.pattern,
            f.createPropertyAccessExpression(accessor, prop.key)
          );
          if (nested) parts.push(nested);
        }
      }

      return parts.reduce((a, b) =>
        f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
      );
    }

    case "type-constructor": {
      const { constructorName } = pattern;

      if (constructorName in TYPEOF_MAP) {
        return f.createBinaryExpression(
          f.createTypeOfExpression(accessor),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          f.createStringLiteral(TYPEOF_MAP[constructorName])
        );
      }

      if (constructorName === "Object") {
        return f.createBinaryExpression(
          f.createBinaryExpression(
            f.createTypeOfExpression(accessor),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("object")
          ),
          ts.SyntaxKind.AmpersandAmpersandToken,
          f.createBinaryExpression(
            accessor,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            f.createNull()
          )
        );
      }

      if (constructorName === "Array") {
        return f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
          undefined,
          [accessor]
        );
      }

      // Default: instanceof check for user-defined or other built-in classes
      return f.createBinaryExpression(
        accessor,
        ts.SyntaxKind.InstanceOfKeyword,
        f.createIdentifier(constructorName)
      );
    }

    case "extractor": {
      const { def, bindings } = pattern;

      if (def.kind === "sum-variant") {
        const discField = def.discriminantField ?? "_tag";
        const discValue = def.discriminantValue;

        const discCheck = f.createBinaryExpression(
          f.createPropertyAccessExpression(accessor, discField),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          typeof discValue === "boolean"
            ? discValue
              ? f.createTrue()
              : f.createFalse()
            : f.createStringLiteral(discValue as string)
        );

        // Recurse into nested patterns on payload fields
        const nestedParts: ts.Expression[] = [];
        const payloadFields = def.payloadFields ?? [];
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = payloadFields[i];
          if (!field || binding.kind === "wildcard" || binding.kind === "variable") continue;
          const nested = buildCondition(
            f,
            binding,
            f.createPropertyAccessExpression(accessor, field)
          );
          if (nested) nestedParts.push(nested);
        }

        if (nestedParts.length === 0) return discCheck;
        return [discCheck, ...nestedParts].reduce((a, b) =>
          f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
        );
      }

      if (def.kind === "product") {
        // Inlined structural check: verify all required fields exist
        const fields = def.productFields ?? [];
        const checks: ts.Expression[] = fields.map((field) =>
          f.createBinaryExpression(f.createStringLiteral(field), ts.SyntaxKind.InKeyword, accessor)
        );

        // Recurse into nested patterns
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = fields[i];
          if (!field || binding.kind === "wildcard" || binding.kind === "variable") continue;
          const nested = buildCondition(
            f,
            binding,
            f.createPropertyAccessExpression(accessor, field)
          );
          if (nested) checks.push(nested);
        }

        if (checks.length === 0) return undefined;
        return checks.reduce((a, b) =>
          f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
        );
      }

      // Custom extractors: condition is handled in generateArmStatements
      // with extract() call + undefined check
      return undefined;
    }

    case "regex":
      // Regex conditions are handled in generateRegexArmStatements
      return undefined;

    case "unsupported":
      return undefined;
  }
}

// ============================================================================
// AS Pattern Binding Helper
// ============================================================================

/**
 * Generate binding statements for an `.as()` pattern.
 * For identifiers: `const p = accessor;`
 * For array patterns: destructure from accessor (used for regex capture groups).
 */
function generateAsBindings(
  f: ts.NodeFactory,
  asPattern: ts.Expression,
  accessor: ts.Expression
): ts.Statement[] {
  if (ts.isIdentifier(asPattern)) {
    if (asPattern.text === "_") return [];
    return [
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              f.createIdentifier(asPattern.text),
              undefined,
              undefined,
              accessor
            ),
          ],
          ts.NodeFlags.Const
        )
      ),
    ];
  }

  // Array/object AS patterns — analyze and collect bindings
  const analyzed = analyzePattern(asPattern);
  return collectBindings(f, analyzed, accessor);
}

// ============================================================================
// OR Pattern Generation
// ============================================================================

/**
 * Generate statements for an OR pattern arm: `.case(A).or(B).or(C).then(result)`
 * Produces: `if (condA || condB || condC) return result;`
 */
function generateOrArmStatements(
  ctx: MacroContext,
  f: ts.NodeFactory,
  arm: CaseArm,
  scrutineeRef: ts.Expression
): ts.Statement[] {
  const allPatterns = [arm.pattern, ...arm.alternatives];
  const conditions: ts.Expression[] = [];

  for (const pat of allPatterns) {
    const analyzed = analyzePattern(pat);
    const cond = buildCondition(f, analyzed, scrutineeRef);
    if (cond) {
      conditions.push(cond);
    }
  }

  if (conditions.length === 0) {
    return [f.createReturnStatement(arm.result)];
  }

  const combined = conditions.reduce((a, b) =>
    f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b)
  );

  if (arm.guard) {
    const check = f.createBinaryExpression(
      f.createParenthesizedExpression(combined),
      ts.SyntaxKind.AmpersandAmpersandToken,
      arm.guard
    );
    return [f.createIfStatement(check, f.createReturnStatement(arm.result))];
  }

  return [f.createIfStatement(combined, f.createReturnStatement(arm.result))];
}

// ============================================================================
// Regex Pattern Generation
// ============================================================================

/**
 * Generate statements for a regex pattern arm:
 * `.case(/regex/).as([_, user, domain]).then({ user, domain })`
 *
 * Produces:
 * ```
 * {
 *   const __r = __m.match(/regex/);
 *   if (__r !== null) {
 *     const [_, user, domain] = __r;
 *     return { user, domain };
 *   }
 * }
 * ```
 */
function generateRegexArmStatements(
  ctx: MacroContext,
  f: ts.NodeFactory,
  pattern: PatternInfo & { kind: "regex" },
  arm: CaseArm,
  scrutineeRef: ts.Expression
): ts.Statement[] {
  const regexResultId = ctx.generateUniqueName("r");

  // const __r = __m.match(/regex/);
  const matchCall = f.createCallExpression(
    f.createPropertyAccessExpression(scrutineeRef, "match"),
    undefined,
    [pattern.node]
  );
  const regexDecl = f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [f.createVariableDeclaration(regexResultId, undefined, undefined, matchCall)],
      ts.NodeFlags.Const
    )
  );

  const regexRef = f.createIdentifier(regexResultId.text);

  // Inner body: AS bindings from regex result + guard + return
  const innerBody: ts.Statement[] = [];

  if (arm.asPattern) {
    innerBody.push(...generateAsBindings(f, arm.asPattern, regexRef));
  }

  if (arm.guard) {
    innerBody.push(f.createIfStatement(arm.guard, f.createReturnStatement(arm.result)));
  } else {
    innerBody.push(f.createReturnStatement(arm.result));
  }

  // if (__r !== null) { ... }
  const nullCheck = f.createBinaryExpression(
    regexRef,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    f.createNull()
  );
  const ifStmt = f.createIfStatement(nullCheck, f.createBlock(innerBody, true));

  return [f.createBlock([regexDecl, ifStmt], true)];
}

// ============================================================================
// Custom Extractor Arm Generation
// ============================================================================

/**
 * Generate statements for a custom Destructure extractor pattern.
 * Calls `ExtractorName.extract(scrutinee)`, checks for undefined,
 * then binds the result and recurses into nested patterns.
 *
 * Generated shape:
 * ```
 * {
 *   const __ext = ExtractorName.extract(__m);
 *   if (__ext !== undefined) {
 *     // bindings from nested patterns applied to __ext
 *     return result;
 *   }
 * }
 * ```
 */
function generateCustomExtractorArm(
  ctx: MacroContext,
  f: ts.NodeFactory,
  pattern: PatternInfo & { kind: "extractor" },
  scrutineeRef: ts.Expression,
  guard: ts.Expression | undefined,
  result: ts.Expression,
  asBindings: ts.Statement[]
): ts.Statement[] {
  const extName = pattern.extractorName;
  const tempName = ctx.generateUniqueName("ext");

  // const __ext = ExtractorName.extract(__m)
  const extractCall = f.createCallExpression(
    f.createPropertyAccessExpression(f.createIdentifier(extName), "extract"),
    undefined,
    [scrutineeRef]
  );
  const extDecl = f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [f.createVariableDeclaration(tempName, undefined, undefined, extractCall)],
      ts.NodeFlags.Const
    )
  );

  const extRef = f.createIdentifier(tempName.text);

  // Collect bindings from the first nested pattern against __ext
  const innerBindings: ts.Statement[] = [];
  if (pattern.bindings.length === 1) {
    innerBindings.push(...collectBindings(f, pattern.bindings[0], extRef));
  } else if (pattern.bindings.length > 1) {
    // Multiple positional bindings: treat __ext as tuple-like
    for (let i = 0; i < pattern.bindings.length; i++) {
      const binding = pattern.bindings[i];
      const elemAccess = f.createElementAccessExpression(extRef, i);
      innerBindings.push(...collectBindings(f, binding, elemAccess));
    }
  }

  const innerBody: ts.Statement[] = [...asBindings, ...innerBindings];

  // Build nested conditions for non-trivial inner patterns
  let nestedCondition: ts.Expression | undefined;
  if (pattern.bindings.length === 1) {
    nestedCondition = buildCondition(f, pattern.bindings[0], extRef);
  }

  if (guard && nestedCondition) {
    innerBody.push(
      f.createIfStatement(
        f.createBinaryExpression(nestedCondition, ts.SyntaxKind.AmpersandAmpersandToken, guard),
        f.createReturnStatement(result)
      )
    );
  } else if (guard) {
    innerBody.push(f.createIfStatement(guard, f.createReturnStatement(result)));
  } else if (nestedCondition) {
    innerBody.push(f.createIfStatement(nestedCondition, f.createReturnStatement(result)));
  } else {
    innerBody.push(f.createReturnStatement(result));
  }

  // if (__ext !== undefined) { ... }
  const nullCheck = f.createBinaryExpression(
    extRef,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    f.createIdentifier("undefined")
  );
  const ifStmt = f.createIfStatement(nullCheck, f.createBlock(innerBody, true));

  return [f.createBlock([extDecl, ifStmt], true)];
}

// ============================================================================
// Arm Statement Generation
// ============================================================================

/**
 * Generate statements for a single match arm (pattern + optional guard + result).
 * Handles all pattern kinds including array, object, nested, type-constructor,
 * and extractor patterns. Supports optional AS pattern binding.
 */
function generateArmStatements(
  ctx: MacroContext,
  f: ts.NodeFactory,
  pattern: PatternInfo,
  scrutineeRef: ts.Expression,
  guard: ts.Expression | undefined,
  result: ts.Expression,
  asPattern?: ts.Expression
): ts.Statement[] {
  const asBindings = asPattern ? generateAsBindings(f, asPattern, scrutineeRef) : [];

  switch (pattern.kind) {
    case "literal": {
      const condition = f.createBinaryExpression(
        scrutineeRef,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        pattern.node
      );
      if (asBindings.length > 0) {
        const bodyStatements: ts.Statement[] = [...asBindings];
        if (guard) {
          bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
        } else {
          bodyStatements.push(f.createReturnStatement(result));
        }
        return [f.createIfStatement(condition, f.createBlock(bodyStatements, true))];
      }
      const check = guard
        ? f.createBinaryExpression(condition, ts.SyntaxKind.AmpersandAmpersandToken, guard)
        : condition;
      return [f.createIfStatement(check, f.createReturnStatement(result))];
    }

    case "wildcard": {
      if (asBindings.length > 0) {
        const bodyStatements: ts.Statement[] = [...asBindings];
        if (guard) {
          bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
        } else {
          bodyStatements.push(f.createReturnStatement(result));
        }
        return [f.createBlock(bodyStatements, true)];
      }
      if (guard) {
        return [f.createIfStatement(guard, f.createReturnStatement(result))];
      }
      return [f.createReturnStatement(result)];
    }

    case "variable": {
      const binding = f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              f.createIdentifier(pattern.name),
              undefined,
              undefined,
              scrutineeRef
            ),
          ],
          ts.NodeFlags.Const
        )
      );
      const bodyStatements: ts.Statement[] = [...asBindings, binding];
      if (guard) {
        bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
      } else {
        bodyStatements.push(f.createReturnStatement(result));
      }
      return [f.createBlock(bodyStatements, true)];
    }

    case "array":
    case "object":
    case "type-constructor": {
      const condition = buildCondition(f, pattern, scrutineeRef);
      const bindings = collectBindings(f, pattern, scrutineeRef);

      const bodyStatements: ts.Statement[] = [...asBindings, ...bindings];
      if (guard) {
        bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
      } else {
        bodyStatements.push(f.createReturnStatement(result));
      }

      const body = f.createBlock(bodyStatements, true);

      if (condition) {
        return [f.createIfStatement(condition, body)];
      }
      return [body];
    }

    case "extractor": {
      const { def } = pattern;

      if (def.kind === "custom") {
        return generateCustomExtractorArm(ctx, f, pattern, scrutineeRef, guard, result, asBindings);
      }

      // Sum-variant and product extractors: inlined structural checks (zero-cost)
      const condition = buildCondition(f, pattern, scrutineeRef);
      const bindings = collectBindings(f, pattern, scrutineeRef);

      const bodyStatements: ts.Statement[] = [...asBindings, ...bindings];
      if (guard) {
        bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
      } else {
        bodyStatements.push(f.createReturnStatement(result));
      }

      const body = f.createBlock(bodyStatements, true);
      if (condition) {
        return [f.createIfStatement(condition, body)];
      }
      return [body];
    }

    case "regex":
      // Handled separately via generateRegexArmStatements
      return [];

    case "unsupported":
      ctx.reportError(
        pattern.node,
        `match: unsupported pattern kind (only literals, _, identifiers, arrays, objects, type constructors, regex, and extractors supported)`
      );
      return [];
  }
}

// ============================================================================
// IIFE Generation
// ============================================================================

function generateIIFE(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = ctx.generateUniqueName("m");

  const statements: ts.Statement[] = [];

  // const __m = scrutinee;
  statements.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(scrutineeName, undefined, undefined, scrutinee)],
        ts.NodeFlags.Const
      )
    )
  );

  for (const arm of arms) {
    const scrutineeRef = f.createIdentifier(scrutineeName.text);

    // OR patterns: build || chain of conditions
    if (arm.alternatives.length > 0) {
      statements.push(...generateOrArmStatements(ctx, f, arm, scrutineeRef));
      continue;
    }

    const pattern = analyzePattern(arm.pattern);

    // Regex patterns: special block with temp variable
    if (pattern.kind === "regex") {
      statements.push(...generateRegexArmStatements(ctx, f, pattern, arm, scrutineeRef));
      continue;
    }

    // Normal patterns (possibly with AS binding)
    const armStatements = generateArmStatements(
      ctx,
      f,
      pattern,
      scrutineeRef,
      arm.guard,
      arm.result,
      arm.asPattern
    );
    statements.push(...armStatements);
  }

  // else clause or MatchError
  if (elseResult !== undefined) {
    statements.push(f.createReturnStatement(elseResult));
  } else {
    statements.push(
      f.createThrowStatement(
        f.createNewExpression(f.createIdentifier("MatchError"), undefined, [
          f.createIdentifier(scrutineeName.text),
        ])
      )
    );
  }

  // (() => { ... })()
  const arrowBody = f.createBlock(statements, true);
  const arrow = f.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    arrowBody
  );
  const paren = f.createParenthesizedExpression(arrow);
  return f.createCallExpression(paren, undefined, []);
}
