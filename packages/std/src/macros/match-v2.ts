/**
 * Fluent Pattern Matching — Waves 1–5 (PEP-008)
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
 * - Wave 5: Exhaustiveness analysis, dead arm elimination, switch optimization,
 *           unreachable pattern detection
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
  | { kind: "unsupported"; node: ts.Expression; reason?: string };

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
        if (currentPattern === undefined) {
          ctx.reportError(link.node, "match: .or() must follow .case()");
          break;
        }
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .or() requires a pattern argument");
          break;
        }
        currentAlternatives.push(link.args[0]);
        break;

      case "as":
        if (currentPattern === undefined) {
          ctx.reportError(link.node, "match: .as() must follow .case()");
          break;
        }
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .as() requires a binding argument");
          break;
        }
        currentAsPattern = link.args[0];
        break;

      case "if":
        if (currentPattern === undefined) {
          ctx.reportError(link.node, "match: .if() must follow .case()");
          break;
        }
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
      if (ts.isOmittedExpression(elem)) {
        elements.push({ pattern: { kind: "wildcard" }, isRest: false });
      } else if (ts.isSpreadElement(elem)) {
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
          return {
            kind: "unsupported",
            node: pattern,
            reason: "computed property keys are not supported in object patterns",
          };
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

    // Zero-arg extractors (e.g. None, Nil) should not be called with arguments
    if (knownDef && knownDef.zeroArg && pattern.arguments.length > 0) {
      return {
        kind: "unsupported",
        node: pattern,
        reason: `${name} is a zero-arg extractor and cannot be called with arguments`,
      };
    }

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
// Wave 5: Type Analysis
// ============================================================================

export interface ScrutineeAnalysis {
  kind: "literal-union" | "boolean" | "discriminated-union" | "non-enumerable" | "unknown";
  literalMembers?: Set<string>;
  discriminantField?: string;
  variantValues?: Set<string>;
}

function getLiteralValueFromType(type: ts.Type): string | undefined {
  if (type.isStringLiteral()) return JSON.stringify(type.value);
  if (type.isNumberLiteral()) return String(type.value);
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as { intrinsicName?: string }).intrinsicName;
  }
  return undefined;
}

export function analyzeScrutineeType(checker: ts.TypeChecker, type: ts.Type): ScrutineeAnalysis {
  if (type.flags & ts.TypeFlags.Boolean) {
    return { kind: "boolean", literalMembers: new Set(["true", "false"]) };
  }

  if (type.isUnion()) {
    const members = type.types;

    const allBoolLiterals =
      members.every((t) => t.flags & ts.TypeFlags.BooleanLiteral) && members.length === 2;
    if (allBoolLiterals) {
      return { kind: "boolean", literalMembers: new Set(["true", "false"]) };
    }

    const allLiterals = members.every((t) => getLiteralValueFromType(t) !== undefined);
    if (allLiterals) {
      const litMembers = new Set<string>();
      for (const t of members) {
        const v = getLiteralValueFromType(t);
        if (v !== undefined) litMembers.add(v);
      }
      return { kind: "literal-union", literalMembers: litMembers };
    }

    const disc = findDiscriminant(checker, members);
    if (disc) {
      return {
        kind: "discriminated-union",
        discriminantField: disc.field,
        variantValues: disc.values,
      };
    }

    return { kind: "non-enumerable" };
  }

  const litVal = getLiteralValueFromType(type);
  if (litVal !== undefined) {
    return { kind: "literal-union", literalMembers: new Set([litVal]) };
  }

  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.BigInt)) {
    return { kind: "non-enumerable" };
  }

  if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return { kind: "non-enumerable" };
  }

  return { kind: "unknown" };
}

function findDiscriminant(
  checker: ts.TypeChecker,
  memberTypes: ts.Type[]
): { field: string; values: Set<string> } | undefined {
  if (!memberTypes.every((t) => t.flags & ts.TypeFlags.Object || t.isIntersection())) {
    return undefined;
  }

  const firstProps = checker.getPropertiesOfType(memberTypes[0]);

  for (const prop of firstProps) {
    const propName = prop.getName();
    let allHaveLiteral = true;
    const values = new Set<string>();

    for (const memberType of memberTypes) {
      const memberProp = checker.getPropertyOfType(memberType, propName);
      if (!memberProp) {
        allHaveLiteral = false;
        break;
      }

      const propType = checker.getTypeOfSymbol(memberProp);
      const litVal = getLiteralValueFromType(propType);
      if (litVal === undefined) {
        allHaveLiteral = false;
        break;
      }
      values.add(litVal);
    }

    if (allHaveLiteral && values.size === memberTypes.length) {
      return { field: propName, values };
    }
  }

  return undefined;
}

// ============================================================================
// Wave 5: Exhaustiveness Checking
// ============================================================================

function getPatternLiteralKey(pattern: PatternInfo): string | undefined {
  if (pattern.kind !== "literal") return undefined;
  const node = pattern.node;
  if (ts.isStringLiteral(node)) return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    return "-" + node.operand.text;
  }
  return undefined;
}

function patternCoversAll(pattern: PatternInfo): boolean {
  return pattern.kind === "wildcard" || pattern.kind === "variable";
}

function checkExhaustiveness(
  ctx: MacroContext,
  chainExpr: ts.CallExpression,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  hasElse: boolean
): void {
  if (hasElse) return;

  for (const arm of arms) {
    if (arm.guard) continue;
    const pattern = analyzePattern(arm.pattern);
    if (patternCoversAll(pattern)) return;
    for (const alt of arm.alternatives) {
      if (patternCoversAll(analyzePattern(alt))) return;
    }
  }

  let analysis: ScrutineeAnalysis | undefined;
  try {
    const type = ctx.getTypeOf(scrutinee);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return;
    analysis = analyzeScrutineeType(ctx.typeChecker, type);
  } catch {
    return;
  }

  if (!analysis) return;

  switch (analysis.kind) {
    case "literal-union":
    case "boolean": {
      if (!analysis.literalMembers) return;
      const covered = new Set<string>();
      for (const arm of arms) {
        if (arm.guard) continue;
        const pattern = analyzePattern(arm.pattern);
        const key = getPatternLiteralKey(pattern);
        if (key !== undefined) covered.add(key);
        for (const alt of arm.alternatives) {
          const altKey = getPatternLiteralKey(analyzePattern(alt));
          if (altKey !== undefined) covered.add(altKey);
        }
      }

      const missing = [...analysis.literalMembers].filter((m) => !covered.has(m));
      if (missing.length > 0) {
        ctx.reportError(
          chainExpr,
          `Non-exhaustive match — missing cases: ${missing.join(", ")}. Add the missing cases or use .else() / _ to handle remaining values.`
        );
      }
      break;
    }

    case "discriminated-union": {
      if (!analysis.variantValues || !analysis.discriminantField) return;
      const covered = new Set<string>();

      for (const arm of arms) {
        if (arm.guard) continue;
        const pattern = analyzePattern(arm.pattern);

        if (pattern.kind === "object") {
          for (const prop of pattern.properties) {
            if (prop.key === analysis.discriminantField && prop.pattern.kind === "literal") {
              const key = getPatternLiteralKey(prop.pattern);
              if (key !== undefined) covered.add(key);
            }
          }
        }

        if (pattern.kind === "extractor" && pattern.def.kind === "sum-variant") {
          const discValue = pattern.def.discriminantValue;
          if (discValue !== undefined) {
            covered.add(
              typeof discValue === "boolean" ? String(discValue) : JSON.stringify(discValue)
            );
          }
        }
      }

      const missing = [...analysis.variantValues].filter((m) => !covered.has(m));
      if (missing.length > 0) {
        ctx.reportError(
          chainExpr,
          `Non-exhaustive match — missing variants: ${missing.join(", ")} (discriminant: "${analysis.discriminantField}"). Add the missing cases or use .else() / _ to handle remaining values.`
        );
      }
      break;
    }

    case "non-enumerable": {
      ctx.reportError(
        chainExpr,
        `Non-exhaustive match — scrutinee type is not enumerable. Add .else() or a _ wildcard to handle all remaining values.`
      );
      break;
    }

    case "unknown":
      break;
  }
}

// ============================================================================
// Wave 5: Dead Arm & Unreachable Pattern Detection
// ============================================================================

function checkUnreachablePatterns(ctx: MacroContext, arms: CaseArm[]): void {
  const seenLiterals = new Set<string>();
  let seenCatchAll = false;

  for (const arm of arms) {
    const pattern = analyzePattern(arm.pattern);

    if (seenCatchAll && !arm.guard) {
      ctx.reportWarning(
        arm.pattern,
        "Unreachable pattern — preceding wildcard/variable pattern catches all values"
      );
      continue;
    }

    if (pattern.kind === "literal" && !arm.guard) {
      const key = getPatternLiteralKey(pattern);
      if (key !== undefined && seenLiterals.has(key)) {
        ctx.reportWarning(
          arm.pattern,
          `Unreachable pattern — value ${key} is already matched by an earlier arm`
        );
      }
      if (key !== undefined) seenLiterals.add(key);
    }

    // Also check OR alternatives for duplicates
    for (const alt of arm.alternatives) {
      const altPattern = analyzePattern(alt);
      if (altPattern.kind === "literal" && !arm.guard) {
        const altKey = getPatternLiteralKey(altPattern);
        if (altKey !== undefined && seenLiterals.has(altKey)) {
          ctx.reportWarning(alt, `Duplicate pattern in .or() — value ${altKey} is already matched`);
        }
        if (altKey !== undefined) seenLiterals.add(altKey);
      }
      if (patternCoversAll(altPattern) && !arm.guard) {
        seenCatchAll = true;
      }
    }

    if (patternCoversAll(pattern) && !arm.guard) {
      seenCatchAll = true;
    }
  }
}

/**
 * Check if a pattern's type domain has zero overlap with the scrutinee type.
 * Reports compile errors for impossible patterns.
 */
function checkDeadArms(
  ctx: MacroContext,
  chainExpr: ts.CallExpression,
  scrutinee: ts.Expression,
  arms: CaseArm[]
): void {
  let analysis: ScrutineeAnalysis | undefined;
  try {
    const type = ctx.getTypeOf(scrutinee);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return;
    analysis = analyzeScrutineeType(ctx.typeChecker, type);
  } catch {
    return;
  }

  if (!analysis || analysis.kind === "unknown" || analysis.kind === "non-enumerable") return;

  if (
    (analysis.kind === "literal-union" || analysis.kind === "boolean") &&
    analysis.literalMembers
  ) {
    for (const arm of arms) {
      if (arm.guard) continue;
      const pattern = analyzePattern(arm.pattern);
      if (pattern.kind !== "literal") continue;
      const key = getPatternLiteralKey(pattern);
      if (key !== undefined && !analysis.literalMembers.has(key)) {
        ctx.reportError(
          arm.pattern,
          `Pattern ${key} can never match type ${[...analysis.literalMembers].join(" | ")}`
        );
      }
    }
  }
}

// ============================================================================
// Wave 5: Switch Optimization
// ============================================================================

const SWITCH_THRESHOLD = 7;

export function isAllPureLiteralArms(arms: CaseArm[]): boolean {
  return arms.every(
    (arm) =>
      arm.alternatives.length === 0 &&
      !arm.guard &&
      !arm.asPattern &&
      analyzePattern(arm.pattern).kind === "literal"
  );
}

function scrutineeShortName(ctx: MacroContext, scrutinee: ts.Expression): ts.Identifier {
  const preferred = ts.isIdentifier(scrutinee) ? `_${scrutinee.text}` : "_m";
  return ctx.tryShortName(preferred);
}

function generateSwitchIIFE(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = scrutineeShortName(ctx, scrutinee);

  const clauses: ts.CaseOrDefaultClause[] = [];

  for (const arm of arms) {
    const pattern = analyzePattern(arm.pattern);
    if (pattern.kind !== "literal") continue;
    clauses.push(f.createCaseClause(pattern.node, [f.createReturnStatement(arm.result)]));
  }

  if (elseResult !== undefined) {
    clauses.push(f.createDefaultClause([f.createReturnStatement(elseResult)]));
  } else {
    clauses.push(
      f.createDefaultClause([
        f.createThrowStatement(
          f.createNewExpression(f.createIdentifier("MatchError"), undefined, [
            f.createIdentifier(scrutineeName.text),
          ])
        ),
      ])
    );
  }

  const switchStmt = f.createSwitchStatement(
    f.createIdentifier(scrutineeName.text),
    f.createCaseBlock(clauses)
  );

  const stmts: ts.Statement[] = [
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(scrutineeName, undefined, undefined, scrutinee)],
        ts.NodeFlags.Const
      )
    ),
    switchStmt,
  ];

  const arrowBody = f.createBlock(stmts, true);
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

// ============================================================================
// PEP-019 Wave 3: Discriminant Pattern Detection & Switch Optimization
// ============================================================================

interface DiscriminantArmInfo {
  discriminantValue: ts.Expression;
  additionalProps: ObjectPropertyPattern[];
  arm: CaseArm;
  objectPattern: PatternInfo & { kind: "object" };
}

interface DiscriminantMatch {
  discriminantKey: string;
  arms: DiscriminantArmInfo[];
  catchAllArm?: CaseArm;
  hasMixedProps: boolean;
}

/**
 * Detect whether all arms share a common discriminant property in object patterns.
 *
 * Returns the analysis if:
 * - All non-catch-all arms are object patterns
 * - Each has exactly one literal property (the discriminant)
 * - The literal property key is the same across all arms
 * - No arm uses OR alternatives
 * - A trailing wildcard/variable arm is allowed as catch-all
 */
function analyzeDiscriminantPattern(arms: CaseArm[]): DiscriminantMatch | undefined {
  if (arms.length < 2) return undefined;

  const discArms: DiscriminantArmInfo[] = [];
  let catchAllArm: CaseArm | undefined;
  let discriminantKey: string | undefined;

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    if (arm.alternatives.length > 0) return undefined;

    const pattern = analyzePattern(arm.pattern);

    if (pattern.kind === "wildcard" || pattern.kind === "variable") {
      if (i === arms.length - 1) {
        catchAllArm = arm;
        continue;
      }
      return undefined;
    }

    if (pattern.kind !== "object") return undefined;

    let discProp: ObjectPropertyPattern | undefined;
    const additionalProps: ObjectPropertyPattern[] = [];

    for (const p of pattern.properties) {
      if (p.isRest) {
        additionalProps.push(p);
        continue;
      }
      if (p.pattern.kind === "literal") {
        if (discProp) return undefined;
        discProp = p;
      } else {
        additionalProps.push(p);
      }
    }

    if (!discProp) return undefined;

    if (discriminantKey === undefined) {
      discriminantKey = discProp.key;
    } else if (discProp.key !== discriminantKey) {
      return undefined;
    }

    discArms.push({
      discriminantValue: (discProp.pattern as PatternInfo & { kind: "literal" }).node,
      additionalProps,
      arm,
      objectPattern: pattern as PatternInfo & { kind: "object" },
    });
  }

  if (!discriminantKey || discArms.length < 2) return undefined;

  return {
    discriminantKey,
    arms: discArms,
    catchAllArm,
    hasMixedProps: discArms.some((a) => a.additionalProps.length > 0),
  };
}

/**
 * Build the body statements for a single case clause in a discriminant switch.
 * Handles additional property bindings, AS patterns, and guards.
 */
function buildDiscriminantCaseBody(
  ctx: MacroContext,
  f: ts.NodeFactory,
  discArm: DiscriminantArmInfo,
  scrutineeRef: () => ts.Identifier
): ts.Statement[] {
  const stmts: ts.Statement[] = [];

  for (const prop of discArm.additionalProps) {
    if (prop.isRest) continue;
    const propAccess = f.createPropertyAccessExpression(scrutineeRef(), prop.key);
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
    } else if (prop.pattern.kind !== "literal" && prop.pattern.kind !== "wildcard") {
      stmts.push(...collectBindings(f, prop.pattern, propAccess));
    }
  }

  if (discArm.arm.asPattern) {
    stmts.push(...generateAsBindings(f, discArm.arm.asPattern, scrutineeRef()));
  }

  if (discArm.arm.guard) {
    stmts.push(f.createIfStatement(discArm.arm.guard, f.createReturnStatement(discArm.arm.result)));
    stmts.push(f.createBreakStatement());
  } else {
    stmts.push(f.createReturnStatement(discArm.arm.result));
  }

  return stmts;
}

/**
 * Generate a switch-based IIFE for discriminant pattern matching.
 *
 * When the scrutinee type might be null/undefined, wraps the switch in
 * a `typeof === "object" && != null` guard. When the type is known to be
 * a discriminated union (all members are objects), emits a bare switch
 * with the fallback as the default clause.
 */
function generateDiscriminantSwitchIIFE(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  dm: DiscriminantMatch,
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = scrutineeShortName(ctx, scrutinee);
  const scrutineeRef = () => f.createIdentifier(scrutineeName.text);

  let needsNullGuard = true;
  try {
    const type = ctx.getTypeOf(scrutinee);
    if (!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
      const analysis = analyzeScrutineeType(ctx.typeChecker, type);
      if (analysis.kind === "discriminated-union") {
        needsNullGuard = false;
      }
    }
  } catch {
    // keep guard for safety
  }

  const caseClauses: ts.CaseOrDefaultClause[] = [];
  for (const discArm of dm.arms) {
    caseClauses.push(
      f.createCaseClause(
        discArm.discriminantValue,
        buildDiscriminantCaseBody(ctx, f, discArm, scrutineeRef)
      )
    );
  }

  const fallbackStmts: ts.Statement[] = [];
  if (dm.catchAllArm) {
    const pat = analyzePattern(dm.catchAllArm.pattern);
    if (pat.kind === "variable") {
      fallbackStmts.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [
              f.createVariableDeclaration(
                f.createIdentifier(pat.name),
                undefined,
                undefined,
                scrutineeRef()
              ),
            ],
            ts.NodeFlags.Const
          )
        )
      );
    }
    if (dm.catchAllArm.asPattern) {
      fallbackStmts.push(...generateAsBindings(f, dm.catchAllArm.asPattern, scrutineeRef()));
    }
    if (dm.catchAllArm.guard) {
      fallbackStmts.push(
        f.createIfStatement(dm.catchAllArm.guard, f.createReturnStatement(dm.catchAllArm.result))
      );
      fallbackStmts.push(f.createBreakStatement());
    } else {
      fallbackStmts.push(f.createReturnStatement(dm.catchAllArm.result));
    }
  } else if (elseResult !== undefined) {
    fallbackStmts.push(f.createReturnStatement(elseResult));
  } else {
    fallbackStmts.push(
      f.createThrowStatement(
        f.createNewExpression(f.createIdentifier("MatchError"), undefined, [scrutineeRef()])
      )
    );
  }

  const stmts: ts.Statement[] = [
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(scrutineeName, undefined, undefined, scrutinee)],
        ts.NodeFlags.Const
      )
    ),
  ];

  if (needsNullGuard) {
    // Use early-return guard instead of wrapping the switch in an if block.
    // Wrapping in if { switch } breaks TypeScript's discriminated union narrowing
    // because TS can't narrow through the typeof guard into the switch cases.
    const notObjectGuard = f.createBinaryExpression(
      f.createBinaryExpression(
        f.createTypeOfExpression(scrutineeRef()),
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        f.createStringLiteral("object")
      ),
      ts.SyntaxKind.BarBarToken,
      f.createBinaryExpression(scrutineeRef(), ts.SyntaxKind.EqualsEqualsToken, f.createNull())
    );
    // Early return: if not an object or null, go to fallback
    const fallbackExpr =
      elseResult ??
      f.createCallExpression(
        f.createPropertyAccessExpression(
          f.createNewExpression(f.createIdentifier("MatchError"), undefined, [scrutineeRef()]),
          "throw"
        ),
        undefined,
        []
      );
    stmts.push(f.createIfStatement(notObjectGuard, f.createBlock(fallbackStmts, true)));
    // Now the switch is at top level — TS can narrow discriminated unions
    caseClauses.push(f.createDefaultClause(fallbackStmts));
    const switchStmt = f.createSwitchStatement(
      f.createPropertyAccessExpression(scrutineeRef(), dm.discriminantKey),
      f.createCaseBlock(caseClauses)
    );
    stmts.push(switchStmt);
  } else {
    caseClauses.push(f.createDefaultClause(fallbackStmts));
    const switchStmt = f.createSwitchStatement(
      f.createPropertyAccessExpression(scrutineeRef(), dm.discriminantKey),
      f.createCaseBlock(caseClauses)
    );
    stmts.push(switchStmt);
  }

  const arrowBody = f.createBlock(stmts, true);
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

// ============================================================================
// Wave 5: Dead Arm Elimination (Output Optimization)
// ============================================================================

/**
 * If the scrutinee is a single literal type, we can emit only the matching
 * arm's result directly — no IIFE, no branching, no checks.
 */
function tryDirectEmit(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression | undefined {
  let analysis: ScrutineeAnalysis | undefined;
  try {
    const type = ctx.getTypeOf(scrutinee);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return undefined;
    analysis = analyzeScrutineeType(ctx.typeChecker, type);
  } catch {
    return undefined;
  }

  if (!analysis) return undefined;

  if (analysis.kind === "literal-union" && analysis.literalMembers?.size === 1) {
    const singleValue = [...analysis.literalMembers][0];
    for (const arm of arms) {
      if (arm.guard) continue;
      const pattern = analyzePattern(arm.pattern);
      const key = getPatternLiteralKey(pattern);
      if (key === singleValue) return arm.result;
      if (patternCoversAll(pattern)) return arm.result;
    }
    if (elseResult !== undefined) return elseResult;
  }

  return undefined;
}

/**
 * For union scrutinees, check if after all preceding arms the remaining type
 * is fully covered by the current arm, allowing unconditional emit.
 * Returns the index of the first arm that can be emitted unconditionally
 * (covers all remaining type slots), or -1 if none.
 */
function findFullyCoveredArmIndex(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[]
): number {
  let analysis: ScrutineeAnalysis | undefined;
  try {
    const type = ctx.getTypeOf(scrutinee);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return -1;
    analysis = analyzeScrutineeType(ctx.typeChecker, type);
  } catch {
    return -1;
  }

  if (!analysis) return -1;

  if (
    (analysis.kind === "literal-union" || analysis.kind === "boolean") &&
    analysis.literalMembers
  ) {
    const remaining = new Set(analysis.literalMembers);
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      if (arm.guard) continue;
      const pattern = analyzePattern(arm.pattern);
      const key = getPatternLiteralKey(pattern);
      if (key !== undefined) remaining.delete(key);
      for (const alt of arm.alternatives) {
        const altKey = getPatternLiteralKey(analyzePattern(alt));
        if (altKey !== undefined) remaining.delete(altKey);
      }
      if (remaining.size === 0) {
        return i;
      }
    }
  }

  return -1;
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
  const { links } = parseChain(chainExpr);
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

  // Wave 5: Exhaustiveness check (type-driven, gracefully degrades)
  checkExhaustiveness(ctx, chainExpr, scrutinee, arms, elseResult !== undefined);

  // Wave 5: Dead arm detection (type-driven)
  checkDeadArms(ctx, chainExpr, scrutinee, arms);

  // Wave 5: Unreachable pattern detection (pattern-driven)
  checkUnreachablePatterns(ctx, arms);

  // Wave 5: Direct emit for single-literal scrutinee types
  const directResult = tryDirectEmit(ctx, scrutinee, arms, elseResult);
  if (directResult !== undefined) return directResult;

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

  // Wave 5: Switch optimization for 7+ pure literal arms
  if (arms.length >= SWITCH_THRESHOLD && isAllPureLiteralArms(arms)) {
    return generateSwitchIIFE(ctx, scrutinee, arms, elseResult);
  }

  // PEP-019 Wave 3: Discriminant switch for object patterns sharing a discriminant key
  const discMatch = analyzeDiscriminantPattern(arms);
  if (discMatch) {
    return generateDiscriminantSwitchIIFE(ctx, scrutinee, discMatch, elseResult);
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
  accessor: ts.Expression,
  skipObjectGuard = false
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

      if (!skipObjectGuard) {
        // typeof accessor === "object" && accessor !== null
        parts.push(
          f.createBinaryExpression(
            f.createTypeOfExpression(accessor),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("object")
          )
        );
        parts.push(
          f.createBinaryExpression(accessor, ts.SyntaxKind.ExclamationEqualsToken, f.createNull())
        );
      }

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
          f.createBinaryExpression(accessor, ts.SyntaxKind.ExclamationEqualsToken, f.createNull())
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
 *
 * If any alternative is a wildcard or variable (always matches), the entire
 * OR is unconditional. Variable bindings inside OR alternatives are not
 * supported — only literals and wildcards are valid OR operands.
 */
function generateOrArmStatements(
  ctx: MacroContext,
  f: ts.NodeFactory,
  arm: CaseArm,
  scrutineeRef: ts.Expression,
  skipObjectGuard = false
): ts.Statement[] {
  const allPatterns = [arm.pattern, ...arm.alternatives];
  const conditions: ts.Expression[] = [];
  let hasUnconditional = false;

  for (const pat of allPatterns) {
    const analyzed = analyzePattern(pat);
    if (patternCoversAll(analyzed)) {
      hasUnconditional = true;
      break;
    }
    const cond = buildCondition(f, analyzed, scrutineeRef, skipObjectGuard);
    if (cond) {
      conditions.push(cond);
    }
  }

  if (hasUnconditional || conditions.length === 0) {
    if (arm.guard) {
      return [f.createIfStatement(arm.guard, f.createReturnStatement(arm.result))];
    }
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
  const regexResultId = ctx.tryShortName("_r");

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
  const tempName = ctx.tryShortName("_ext");

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
  asPattern?: ts.Expression,
  skipObjectGuard = false
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
      const condition = buildCondition(f, pattern, scrutineeRef, skipObjectGuard);
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
      const condition = buildCondition(f, pattern, scrutineeRef, skipObjectGuard);
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
        pattern.reason
          ? `match: ${pattern.reason}`
          : `match: unsupported pattern kind (only literals, _, identifiers, arrays, objects, type constructors, regex, and extractors supported)`
      );
      return [];
  }
}

// ============================================================================
// IIFE Generation
// ============================================================================

/**
 * Check if a type is guaranteed to be a non-null object (no null, undefined, or primitives).
 * When true, per-arm `typeof === "object" && != null` guards can be skipped.
 */
function isGuaranteedObject(ctx: MacroContext, scrutinee: ts.Expression): boolean {
  try {
    const type = ctx.getTypeOf(scrutinee);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;

    const checkSingleType = (t: ts.Type): boolean => {
      if (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return false;
      if (
        t.flags &
        (ts.TypeFlags.String |
          ts.TypeFlags.Number |
          ts.TypeFlags.BigInt |
          ts.TypeFlags.Boolean |
          ts.TypeFlags.StringLiteral |
          ts.TypeFlags.NumberLiteral |
          ts.TypeFlags.BigIntLiteral |
          ts.TypeFlags.BooleanLiteral)
      )
        return false;
      if (t.flags & ts.TypeFlags.Object) return true;
      if (t.isUnion()) return t.types.every(checkSingleType);
      if (t.isIntersection()) return t.types.some(checkSingleType);
      return false;
    };
    return checkSingleType(type);
  } catch {
    return false;
  }
}

function generateIIFE(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = scrutineeShortName(ctx, scrutinee);

  const statements: ts.Statement[] = [];

  // Skip per-arm typeof/null guards when scrutinee is guaranteed to be a non-null object
  const skipObjectGuard = isGuaranteedObject(ctx, scrutinee);

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

  // Wave 5: Find the arm index where the type is fully narrowed
  const fullyCoveredIdx = findFullyCoveredArmIndex(ctx, scrutinee, arms);

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const scrutineeRef = f.createIdentifier(scrutineeName.text);

    // Wave 5: Emit unconditional return when type is fully narrowed
    // Still generate bindings for AS patterns and complex patterns that need destructuring
    if (fullyCoveredIdx !== -1 && i >= fullyCoveredIdx && !arm.guard) {
      if (arm.asPattern) {
        const asBindings = generateAsBindings(f, arm.asPattern, scrutineeRef);
        statements.push(...asBindings);
      }
      const armPattern = analyzePattern(arm.pattern);
      if (armPattern.kind !== "literal" && armPattern.kind !== "wildcard") {
        const bindings = collectBindings(f, armPattern, scrutineeRef);
        statements.push(...bindings);
      }
      statements.push(f.createReturnStatement(arm.result));
      continue;
    }

    // OR patterns: build || chain of conditions
    if (arm.alternatives.length > 0) {
      statements.push(...generateOrArmStatements(ctx, f, arm, scrutineeRef, skipObjectGuard));
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
      arm.asPattern,
      skipObjectGuard
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
