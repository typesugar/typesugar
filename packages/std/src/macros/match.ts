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
import {
  defineExpressionMacro,
  globalRegistry,
  isSyntheticNode,
  type MacroContext,
  TS9202,
  TS9216,
  TS9226,
} from "@typesugar/core";
import {
  extractorErrorReported,
  resolveExtractor,
  SELF_PAYLOAD,
  type ExtractorDef,
  type PayloadTyping,
} from "./match-extractors.js";

// ============================================================================
// Chain Parsing
// ============================================================================

interface ChainLink {
  method: string;
  args: readonly ts.Expression[];
  node: ts.CallExpression;
}

/** @internal shared with match-switch.ts */
export interface CaseArm {
  pattern: ts.Expression;
  alternatives: ts.Expression[];
  guard?: ts.Expression;
  result: ts.Expression;
  asPattern?: ts.Expression;
}

// ============================================================================
// Pattern Types
// ============================================================================

/** @internal shared with match-switch.ts */
export interface ArrayElementPattern {
  pattern: PatternInfo;
  isRest: boolean;
}

/** @internal shared with match-switch.ts */
export interface ObjectPropertyPattern {
  key: string;
  pattern: PatternInfo;
  isRest: boolean;
}

// ExtractorDef and SELF_PAYLOAD live in match-extractors.ts (Destructure instances).
export { SELF_PAYLOAD, type ExtractorDef } from "./match-extractors.js";

/** @internal shared with match-switch.ts */
export type PatternInfo =
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
 * The context of the match being expanded, for resolving extractor names to
 * `Destructure` instances (match-extractors.ts). Set by
 * {@link withBuiltinExtractorsFor} around each expansion.
 */
let extractorContext: MacroContext | undefined;

/**
 * The extractor `name` stands for: the `Destructure` instance in scope for
 * it (match-extractors.ts). There are no name-based built-ins: Some/None,
 * Left/Right, Cons/Nil and Valid/Invalid are instances shipped by
 * @typesugar/fp next to the types, and any other type brings its own.
 */
function extractorFor(name: ts.Identifier): ExtractorDef | undefined {
  return extractorContext ? resolveExtractor(extractorContext, name) : undefined;
}

/** Built-ins a type-constructor pattern tests without `instanceof`. */
const NON_INSTANCEOF_CONSTRUCTORS = new Set([
  "String",
  "Number",
  "Boolean",
  "BigInt",
  "Symbol",
  "Function",
  "Object",
  "Array",
]);

/**
 * Why `Name(...)`, which has no `Destructure` instance, can't be a
 * type-constructor pattern, or undefined when it can. That pattern is a type
 * test, `value instanceof Name`, binding the whole value to its one argument:
 * a second argument would be silently dropped (and whatever it names left
 * unbound, or captured from an outer scope), and a `Name` that is not a class
 * makes the `instanceof` throw or test nothing. Whether it is a class is
 * decided through the checker (the symbol, alias-resolved: a class, or a
 * value with construct signatures such as `Date`), not by name.
 */
function typeConstructorProblem(pattern: ts.CallExpression): string | undefined {
  const callee = pattern.expression as ts.Identifier;
  const name = callee.text;
  if (extractorErrorReported(callee)) return undefined; // already an error
  const noInstance =
    `no Destructure instance for ${name} is in scope, so ${name}(...) is a type test ` +
    `(\`value instanceof ${name}\`) that binds the whole value to one name`;
  if (pattern.arguments.length > 1) {
    return (
      `${name}(...) has ${pattern.arguments.length} arguments, but ${noInstance}. ` +
      `Bind the whole value, ${name}(v), and read its fields; or give ${name} a Destructure ` +
      `instance (@derive(Destructure) on its declaration) to bind them in the pattern.`
    );
  }
  if (NON_INSTANCEOF_CONSTRUCTORS.has(name)) return undefined;
  const ctx = extractorContext;
  if (!ctx || isSyntheticNode(callee)) return undefined;
  const checker = ctx.typeChecker;
  let sym: ts.Symbol | undefined;
  try {
    sym = checker.getSymbolAtLocation(callee);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    if (sym && sym.flags & ts.SymbolFlags.Class) return undefined;
    const valueType =
      sym && sym.flags & ts.SymbolFlags.Value
        ? checker.getTypeOfSymbolAtLocation(sym, callee)
        : undefined;
    if (valueType && valueType.getConstructSignatures().length > 0) return undefined;
  } catch (e) {
    // Degrade to the type test, visibly (CLAUDE.md).
    ctx.reportWarning(
      callee,
      `match: could not check that ${name} is a class (${e instanceof Error ? e.message : String(e)}); ` +
        `${name}(...) is compiled to \`instanceof ${name}\`.`
    );
    return undefined;
  }
  return sym
    ? `${name} is not a class, and ${noInstance}, which needs a class (or a built-in ` +
        `constructor such as Date). Give ${name} a Destructure instance (@derive(Destructure) ` +
        `on its declaration) to match its fields.`
    : `${name} is not in scope: ${name}(...) needs a class, or a Destructure instance for ${name}.`;
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

/** `NaN` never equals itself — literal checks on it must use `Number.isNaN`. */
/** @internal shared with match-switch.ts */
export function isNaNLiteral(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && node.text === "NaN";
}

/**
 * The runtime test for a literal pattern: `accessor === lit`, or
 * `Number.isNaN(accessor)` for `NaN`.
 */
/** @internal shared with match-switch.ts */
export function literalCheck(
  f: ts.NodeFactory,
  accessor: ts.Expression,
  lit: ts.Expression
): ts.Expression {
  if (isNaNLiteral(lit)) {
    return f.createCallExpression(
      f.createPropertyAccessExpression(f.createIdentifier("Number"), "isNaN"),
      undefined,
      [accessor]
    );
  }
  return f.createBinaryExpression(accessor, ts.SyntaxKind.EqualsEqualsEqualsToken, lit);
}

/** Does a pattern bind any names (so it can't appear inside an `.or()`)? */
function patternHasBindings(p: PatternInfo): boolean {
  switch (p.kind) {
    case "variable":
      return true;
    case "array":
      return p.elements.some((e) => patternHasBindings(e.pattern));
    case "object":
      return p.properties.some((pr) => patternHasBindings(pr.pattern));
    case "type-constructor":
      return patternHasBindings(p.binding);
    case "extractor":
      return p.bindings.some(patternHasBindings);
    default:
      return false;
  }
}

/** @internal shared with match-switch.ts */
export function analyzePattern(pattern: ts.Expression): PatternInfo {
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
  if (
    ts.isPrefixUnaryExpression(pattern) &&
    (ts.isNumericLiteral(pattern.operand) ||
      (ts.isIdentifier(pattern.operand) && pattern.operand.text === "Infinity"))
  ) {
    return { kind: "literal", node: pattern };
  }

  // Identifiers: wildcard, undefined/NaN/Infinity literals, zero-arg extractors, variable binding
  if (ts.isIdentifier(pattern)) {
    if (pattern.text === "_") {
      return { kind: "wildcard" };
    }
    // Global value identifiers are literals, never bindings — `.case(NaN)`
    // must not become `const NaN = _v` (deep review #16).
    if (pattern.text === "undefined" || pattern.text === "NaN" || pattern.text === "Infinity") {
      return { kind: "literal", node: pattern };
    }
    const zeroArgDef = extractorFor(pattern);
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
    const knownDef = extractorFor(pattern.expression);

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
      const extracted = knownDef.payloadFields ?? knownDef.productFields;
      if (extracted && bindings.length > extracted.length) {
        return {
          kind: "unsupported",
          node: pattern,
          reason: `${name}(...) binds ${bindings.length} values, but its extractor yields ${extracted.length}`,
        };
      }
      return { kind: "extractor", extractorName: name, bindings, def: knownDef };
    }

    // Fall through to type-constructor for String, Date, etc.
    const problem = typeConstructorProblem(pattern);
    if (problem) return { kind: "unsupported", node: pattern, reason: problem };
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
  /**
   * `"null"` / `"undefined"` keys for nullish members of a discriminated union
   * (`Shape | null`). For literal unions they are folded into `literalMembers`.
   */
  nullishMembers?: Set<string>;
}

/** @internal shared with match-switch.ts */
export function getLiteralValueFromType(type: ts.Type): string | undefined {
  if (type.isStringLiteral()) return JSON.stringify(type.value);
  if (type.isNumberLiteral()) return String(type.value);
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as { intrinsicName?: string }).intrinsicName;
  }
  return undefined;
}

/** @internal shared with match-switch.ts */
export function nullishKeyOfType(type: ts.Type): string | undefined {
  if (type.flags & ts.TypeFlags.Null) return "null";
  if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return "undefined";
  return undefined;
}

export function analyzeScrutineeType(checker: ts.TypeChecker, type: ts.Type): ScrutineeAnalysis {
  if (type.flags & ts.TypeFlags.Boolean) {
    return { kind: "boolean", literalMembers: new Set(["true", "false"]) };
  }

  if (type.isUnion()) {
    // Nullish members (`| null`, `| undefined`) are enumerable values too —
    // split them off so `"a" | "b" | undefined` stays a literal union and
    // `Shape | null` stays a discriminated union (deep review #13).
    const nullish = new Set<string>();
    const members: ts.Type[] = [];
    for (const t of type.types) {
      const nk = nullishKeyOfType(t);
      if (nk) nullish.add(nk);
      else members.push(t);
    }

    const allBoolLiterals =
      members.every((t) => t.flags & ts.TypeFlags.BooleanLiteral) && members.length === 2;
    if (allBoolLiterals && nullish.size === 0) {
      return { kind: "boolean", literalMembers: new Set(["true", "false"]) };
    }

    const allLiterals = members.every((t) => getLiteralValueFromType(t) !== undefined);
    if (allLiterals) {
      const litMembers = new Set<string>();
      for (const t of members) {
        const v = getLiteralValueFromType(t);
        if (v !== undefined) litMembers.add(v);
      }
      for (const nk of nullish) litMembers.add(nk);
      return { kind: "literal-union", literalMembers: litMembers };
    }

    const disc = members.length >= 2 ? findDiscriminant(checker, members) : undefined;
    if (disc) {
      return {
        kind: "discriminated-union",
        discriminantField: disc.field,
        variantValues: disc.values,
        nullishMembers: nullish.size > 0 ? nullish : undefined,
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

/**
 * Type of the scrutinee, or undefined when the checker can't (or mustn't) be
 * asked. A macro-generated scrutinee is skipped before calling the checker
 * (CLAUDE.md: synthetic nodes are outside the checker's contract); a checker
 * that throws on real source is reported ONCE per scrutinee as a warning, so
 * the user sees that exhaustiveness/optimizations were skipped (deep review
 * #32) instead of the analysis silently disappearing.
 */
const scrutineeTypeCache = new WeakMap<ts.Node, { type?: ts.Type }>();

/** @internal shared with match-switch.ts */
export function getScrutineeType(ctx: MacroContext, scrutinee: ts.Expression): ts.Type | undefined {
  const cached = scrutineeTypeCache.get(scrutinee);
  if (cached) return cached.type;
  let type: ts.Type | undefined;
  if (!isSyntheticNode(scrutinee)) {
    try {
      type = ctx.getTypeOf(scrutinee);
    } catch (e) {
      ctx.reportWarning(
        scrutinee,
        `match: could not determine the scrutinee's type (${e instanceof Error ? e.message : String(e)}); ` +
          `exhaustiveness checking and type-driven optimizations were skipped for this match.`
      );
    }
  }
  scrutineeTypeCache.set(scrutinee, { type });
  return type;
}

/** Scrutinee analysis, or undefined for any/unknown/unavailable types. */
/** @internal shared with match-switch.ts */
export function getScrutineeAnalysis(
  ctx: MacroContext,
  scrutinee: ts.Expression
): ScrutineeAnalysis | undefined {
  const type = getScrutineeType(ctx, scrutinee);
  if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return undefined;
  try {
    return analyzeScrutineeType(ctx.typeChecker, type);
  } catch (e) {
    ctx.reportWarning(
      scrutinee,
      `match: type analysis of the scrutinee failed (${e instanceof Error ? e.message : String(e)}); ` +
        `exhaustiveness checking and type-driven optimizations were skipped for this match.`
    );
    return undefined;
  }
}

// ============================================================================
// Wave 5: Exhaustiveness Checking
// ============================================================================

/** @internal shared with match-switch.ts */
export function getPatternLiteralKey(pattern: PatternInfo): string | undefined {
  if (pattern.kind !== "literal") return undefined;
  const node = pattern.node;
  if (ts.isStringLiteral(node)) return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node)) return String(Number(node.text));
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(node)) return node.text; // undefined | NaN | Infinity
  if (ts.isPrefixUnaryExpression(node)) {
    if (ts.isNumericLiteral(node.operand)) return String(-Number(node.operand.text));
    if (ts.isIdentifier(node.operand)) return "-" + node.operand.text;
  }
  return undefined;
}

/** @internal shared with match-switch.ts */
export function patternCoversAll(pattern: PatternInfo): boolean {
  return pattern.kind === "wildcard" || pattern.kind === "variable";
}

/**
 * Literal keys (in `getLiteralValueFromType` form) a pattern covers
 * COMPLETELY, given the scrutinee's enumerable members. Literals cover
 * themselves; an unconstrained `String(s)` / `Number(n)` / `Boolean(b)`
 * covers every member of that primitive kind (deep review #13).
 */
function coveredLiteralKeys(pattern: PatternInfo, members: Set<string>): string[] {
  const key = getPatternLiteralKey(pattern);
  if (key !== undefined) return [key];
  if (pattern.kind === "type-constructor" && patternCoversAll(pattern.binding)) {
    const all = [...members];
    switch (pattern.constructorName) {
      case "String":
        return all.filter((m) => m.startsWith('"'));
      case "Boolean":
        return all.filter((m) => m === "true" || m === "false");
      case "Number":
        return all.filter(
          (m) =>
            !m.startsWith('"') && m !== "true" && m !== "false" && m !== "null" && m !== "undefined"
        );
    }
  }
  return [];
}

/**
 * Discriminant value a pattern covers COMPLETELY for a discriminated union:
 * `{ kind: "a" }` (other props only bind), `Some(x)`, or a nullish literal.
 * `{ kind: "a", extra: 1 }` covers nothing — it only matches part of "a".
 */
function coveredVariantKey(pattern: PatternInfo, discriminantField: string): string | undefined {
  if (pattern.kind === "object") {
    let key: string | undefined;
    for (const prop of pattern.properties) {
      if (prop.isRest) continue;
      if (prop.key === discriminantField && prop.pattern.kind === "literal") {
        key = getPatternLiteralKey(prop.pattern);
      } else if (!patternCoversAll(prop.pattern)) {
        return undefined;
      }
    }
    return key;
  }
  if (pattern.kind === "extractor" && pattern.def.kind === "sum-variant") {
    // fp's `None`/`Nil` are `null`: they cover the null member.
    if (pattern.def.test === "null") return "null";
    if (pattern.def.discriminantField !== discriminantField) return undefined;
    if (!pattern.bindings.every(patternCoversAll)) return undefined;
    const discValue = pattern.def.discriminantValue;
    if (discValue === undefined) return undefined;
    return typeof discValue === "boolean" ? String(discValue) : JSON.stringify(discValue);
  }
  if (pattern.kind === "literal") {
    const key = getPatternLiteralKey(pattern);
    if (key === "null" || key === "undefined") return key;
  }
  return undefined;
}

function checkExhaustiveness(
  ctx: MacroContext,
  chainExpr: ts.CallExpression,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  hasElse: boolean
): void {
  if (hasElse) return;
  const patterns = arms
    .filter((arm) => !arm.guard)
    .flatMap((arm) => [arm.pattern, ...arm.alternatives].map(analyzePattern));
  reportMissingCases(ctx, chainExpr, findMissingCases(ctx, scrutinee, patterns), ".else() / _");
}

/**
 * What a set of unguarded patterns leaves uncovered of the scrutinee's type.
 * `complete` also when the type can't be analysed (any/unknown/unavailable),
 * which the callers treat as "nothing to report".
 * @internal shared with the `match:` switch (match-switch.ts)
 */
export type MatchCoverage =
  /** `unanalysed`: the type couldn't be analysed, so nothing is reported — and nothing proven. */
  | { kind: "complete"; unanalysed?: true }
  | { kind: "missing"; what: "cases" | "variants"; missing: string }
  | { kind: "not-enumerable" };

/** @internal shared with the `match:` switch (match-switch.ts) */
export function findMissingCases(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  patterns: readonly PatternInfo[]
): MatchCoverage {
  if (patterns.some(patternCoversAll)) return { kind: "complete" };
  // A product extractor (`@destructure always -> x, y`) whose bindings bind
  // everything matches every value.
  if (
    patterns.some(
      (p) => p.kind === "extractor" && p.def.test === "always" && p.bindings.every(patternCoversAll)
    )
  ) {
    return { kind: "complete" };
  }

  // Untagged extractor tests (fp's Option/List/Either/Validated): `not-null`
  // + `null` cover everything; `has k` tests cover the scrutinee's union when
  // every non-nullish member has a required `k` from the set (and a nullish
  // member, if any, is covered by a `null` test).
  const fpCovered = new Set<string>();
  const hasKeys = new Set<string>();
  for (const p of patterns) {
    if (p.kind !== "extractor" || !p.def.test || !p.bindings.every(patternCoversAll)) continue;
    if (typeof p.def.test === "string") fpCovered.add(p.def.test);
    else hasKeys.add(p.def.test.hasKey);
  }
  if (fpCovered.has("not-null") && fpCovered.has("null")) return { kind: "complete" };
  if (hasKeys.size > 0 && coveredByKeyTests(ctx, scrutinee, hasKeys, fpCovered.has("null"))) {
    return { kind: "complete" };
  }

  const analysis = getScrutineeAnalysis(ctx, scrutinee);
  if (!analysis) return { kind: "complete", unanalysed: true };

  switch (analysis.kind) {
    case "literal-union":
    case "boolean": {
      if (!analysis.literalMembers) return { kind: "complete", unanalysed: true };
      const covered = new Set<string>();
      for (const p of patterns) {
        for (const k of coveredLiteralKeys(p, analysis.literalMembers)) covered.add(k);
      }
      const missing = [...analysis.literalMembers].filter((m) => !covered.has(m));
      return missing.length > 0
        ? { kind: "missing", what: "cases", missing: missing.join(", ") }
        : { kind: "complete" };
    }

    case "discriminated-union": {
      if (!analysis.variantValues || !analysis.discriminantField) {
        return { kind: "complete", unanalysed: true };
      }
      const covered = new Set<string>();
      for (const p of patterns) {
        const key = coveredVariantKey(p, analysis.discriminantField);
        if (key !== undefined) covered.add(key);
      }
      const expected = [...analysis.variantValues, ...(analysis.nullishMembers ?? [])];
      const missing = expected.filter((m) => !covered.has(m));
      return missing.length > 0
        ? {
            kind: "missing",
            what: "variants",
            missing: `${missing.join(", ")} (discriminant: "${analysis.discriminantField}")`,
          }
        : { kind: "complete" };
    }

    case "non-enumerable":
      return { kind: "not-enumerable" };

    case "unknown":
      return { kind: "complete", unanalysed: true };
  }
}

/**
 * The index of the first unguarded arm after which the unguarded arms so far
 * PROVABLY cover the scrutinee's type (-1 if none): from there on, the arm
 * needs no test and nothing after it — no later arm, no `.else()`, no
 * `MatchError` — can run. "Provably" is {@link findMissingCases} saying
 * complete for a type it could analyse: a literal union whose members are
 * all matched, a discriminated union whose variants are, `null` + `not-null`
 * extractors (Some/None, Cons/Nil), `has` extractors covering every member
 * (Left/Right, Valid/Invalid), derived variant extractors covering every tag.
 * An arm that is itself a catch-all (`_`, a binding) is left to the normal
 * path, which already ends there. A value outside the static type (an `any`
 * cast) takes the last arm, as in TypeScript's own exhaustive switch.
 */
function findCoveringArmIndex(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[]
): number {
  const patterns: PatternInfo[] = [];
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    if (arm.guard) continue;
    const own = [arm.pattern, ...arm.alternatives].map(analyzePattern);
    if (own.some(patternCoversAll)) return -1;
    patterns.push(...own);
    const coverage = findMissingCases(ctx, scrutinee, patterns);
    if (coverage.kind === "complete" && !coverage.unanalysed) return i;
  }
  return -1;
}

/** Does every member of the scrutinee's union have a required key from `keys`? */
function coveredByKeyTests(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  keys: ReadonlySet<string>,
  nullCovered: boolean
): boolean {
  const type = getScrutineeType(ctx, scrutinee);
  if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  const members = type.isUnion() ? type.types : [type];
  try {
    return members.every((m) => {
      if (m.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
        return nullCovered;
      }
      return [...keys].some((k) => {
        const prop = ctx.typeChecker.getPropertyOfType(m, k);
        return prop !== undefined && (prop.flags & ts.SymbolFlags.Optional) === 0;
      });
    });
  } catch {
    return false;
  }
}

/**
 * Emit TS9226 for an incomplete {@link MatchCoverage}; `fallback` names the
 * construct that covers the rest (`.else() / _`, `default:`).
 * @internal shared with the `match:` switch (match-switch.ts)
 */
export function reportMissingCases(
  ctx: MacroContext,
  at: ts.Node,
  coverage: MatchCoverage,
  fallback: string
): void {
  if (coverage.kind === "missing") {
    ctx
      .diagnostic(TS9226)
      .at(at)
      .withArgs({ what: coverage.what, missing: coverage.missing })
      .help(`Add the missing cases or use ${fallback} to handle remaining values.`)
      .emit();
  } else if (coverage.kind === "not-enumerable") {
    ctx
      .diagnostic(TS9226)
      .at(at)
      .withArgs({ what: "a fallback", missing: "the scrutinee type is not enumerable" })
      .help(
        fallback === ".else() / _"
          ? "Add .else() or a _ wildcard to handle all remaining values."
          : `Add ${fallback} to handle all remaining values.`
      )
      .emit();
  }
}

// ============================================================================
// Wave 5: Dead Arm & Unreachable Pattern Detection
// ============================================================================

/** @internal shared with match-switch.ts */
export function checkUnreachablePatterns(ctx: MacroContext, arms: CaseArm[]): void {
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
  const analysis = getScrutineeAnalysis(ctx, scrutinee);
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
  return arms.every((arm) => {
    if (arm.alternatives.length > 0 || arm.guard || arm.asPattern) return false;
    const pattern = analyzePattern(arm.pattern);
    // `case NaN:` never matches (switch uses ===) — keep NaN on the if-chain path.
    return pattern.kind === "literal" && !isNaNLiteral(pattern.node);
  });
}

function scrutineeShortName(ctx: MacroContext, scrutinee: ts.Expression): ts.Identifier {
  const preferred = ts.isIdentifier(scrutinee) ? `_${scrutinee.text}` : "_m";
  return ctx.tryShortName(preferred);
}

// ============================================================================
// IIFE wrapper (await / yield aware)
// ============================================================================

/**
 * Does `node` contain an `await`/`yield` that belongs to the ENCLOSING
 * function (i.e. not inside a nested function/class body)? Such expressions
 * change meaning — or become a SyntaxError — when moved into an arrow IIFE.
 */
function containsOwnKeyword(node: ts.Node, kind: "await" | "yield"): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      kind === "await" &&
      (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier))
    ) {
      found = true;
      return;
    }
    if (kind === "yield" && ts.isYieldExpression(n)) {
      found = true;
      return;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Wrap match statements in an IIFE: `(() => { ... })()`, or
 * `await (async () => { ... })()` when any moved expression (scrutinee,
 * guards, results, else) awaits (deep review #4). A `yield` cannot be moved
 * into an arrow at all, so it is reported as an error.
 */
function wrapInIIFE(
  ctx: MacroContext,
  chainExpr: ts.Expression,
  statements: ts.Statement[],
  moved: readonly (ts.Node | undefined)[]
): ts.Expression {
  const f = ctx.factory;
  const present = moved.filter((n): n is ts.Node => n !== undefined);
  if (present.some((n) => containsOwnKeyword(n, "yield"))) {
    ctx.reportError(
      chainExpr,
      "match: `yield` inside a match arm, guard, else or scrutinee is not supported — the match " +
        "compiles to an arrow IIFE, which cannot yield. Compute the value with `yield` before the match."
    );
  }
  const isAsync = present.some((n) => containsOwnKeyword(n, "await"));
  const arrow = f.createArrowFunction(
    isAsync ? [f.createToken(ts.SyntaxKind.AsyncKeyword)] : undefined,
    undefined,
    [],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(statements, true)
  );
  const call = f.createCallExpression(f.createParenthesizedExpression(arrow), undefined, []);
  return isAsync ? f.createAwaitExpression(call) : call;
}

/** Every expression a match moves into its generated function body. */
function movedExpressions(
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): (ts.Node | undefined)[] {
  return [scrutinee, elseResult, ...arms.flatMap((a) => [a.guard, a.result])];
}

function createMatchErrorThrow(ctx: MacroContext, value: ts.Expression): ts.Statement {
  const f = ctx.factory;
  return f.createThrowStatement(
    f.createNewExpression(ctx.ensureImport("MatchError", "@typesugar/std"), undefined, [value])
  );
}

function generateSwitchIIFE(
  ctx: MacroContext,
  chainExpr: ts.Expression,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = scrutineeShortName(ctx, scrutinee);

  const clauses: ts.CaseOrDefaultClause[] = [];
  // With the literal union covered, the covering arm is the `default:` and
  // there is no MatchError (as in the conditional chain and the IIFE).
  const coveringIdx = elseResult === undefined ? findCoveringArmIndex(ctx, scrutinee, arms) : -1;

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const pattern = analyzePattern(arm.pattern);
    if (pattern.kind !== "literal") continue;
    if (i === coveringIdx) {
      clauses.push(f.createDefaultClause([f.createReturnStatement(arm.result)]));
      break;
    }
    clauses.push(f.createCaseClause(pattern.node, [f.createReturnStatement(arm.result)]));
  }

  if (elseResult !== undefined) {
    clauses.push(f.createDefaultClause([f.createReturnStatement(elseResult)]));
  } else if (coveringIdx === -1) {
    clauses.push(
      f.createDefaultClause([createMatchErrorThrow(ctx, f.createIdentifier(scrutineeName.text))])
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

  return wrapInIIFE(ctx, chainExpr, stmts, movedExpressions(scrutinee, arms, elseResult));
}

// ============================================================================
// PEP-019 Wave 3: Discriminant Pattern Detection & Switch Optimization
// ============================================================================

interface DiscriminantArmInfo {
  /** Key (getPatternLiteralKey form) of the discriminant value, for grouping. */
  discriminantKey: string;
  discriminantValue: ts.Expression;
  arm: CaseArm;
  /** The arm's object pattern with the discriminant property removed / neutralised. */
  residualPattern: PatternInfo & { kind: "object" };
}

interface DiscriminantMatch {
  discriminantKey: string;
  arms: DiscriminantArmInfo[];
  catchAllArm?: CaseArm;
}

/**
 * Detect whether all arms share a common discriminant property in object patterns.
 *
 * Returns the analysis if:
 * - All non-catch-all arms are object patterns
 * - Each has exactly one top-level literal property (the discriminant)
 * - The literal property key is the same across all arms
 * - No arm uses OR alternatives, and no discriminant is `NaN`
 * - A trailing wildcard/variable arm is allowed as catch-all
 *
 * Extra properties may be any pattern (nested literals, arrays, extractors,
 * guards): each arm is still tested in full inside its case clause, and a
 * non-matching arm FALLS THROUGH to the next arm with the same discriminant
 * and then to the catch-all/else after the switch (deep review #1-#3).
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
    for (const p of pattern.properties) {
      if (!p.isRest && p.pattern.kind === "literal") {
        if (discProp) return undefined;
        discProp = p;
      }
    }

    if (!discProp) return undefined;
    const lit = (discProp.pattern as PatternInfo & { kind: "literal" }).node;
    if (isNaNLiteral(lit)) return undefined;
    const litKey = getPatternLiteralKey(discProp.pattern);
    if (litKey === undefined) return undefined;

    if (discriminantKey === undefined) {
      discriminantKey = discProp.key;
    } else if (discProp.key !== discriminantKey) {
      return undefined;
    }

    // The case label already tests the discriminant. Drop it from the
    // residual pattern — unless a rest binding needs it in its exclude list,
    // in which case keep it as a wildcard (binds nothing, tests only `in`).
    const hasRest = pattern.properties.some((p) => p.isRest);
    const residualProps = hasRest
      ? pattern.properties.map((p) =>
          p === discProp ? { ...p, pattern: { kind: "wildcard" } as PatternInfo } : p
        )
      : pattern.properties.filter((p) => p !== discProp);

    discArms.push({
      discriminantKey: litKey,
      discriminantValue: lit,
      arm,
      residualPattern: { kind: "object", properties: residualProps, hasRest: pattern.hasRest },
    });
  }

  if (!discriminantKey || discArms.length < 2) return undefined;

  return { discriminantKey, arms: discArms, catchAllArm };
}

/**
 * Generate a switch-based IIFE for discriminant pattern matching:
 *
 * ```
 * const _s = scrutinee;
 * if (typeof _s === "object" && _s !== null) {   // only when _s may be non-object
 *   switch (_s.kind) {
 *     case "circle": {
 *       { if (<residual test>) { <bindings>; if (guard) return r1; } }   // arm 1
 *       { <bindings>; return r2; }                                       // arm 2, same tag
 *       break;
 *     }
 *     ...
 *   }
 * }
 * <catch-all arm> ; return else / throw MatchError
 * ```
 *
 * Every arm body is its own block (no `const` collisions between arms, #1);
 * an arm whose guard or residual test fails falls through to the next arm
 * with the same tag and then to the code after the switch (#2, #3).
 */
function generateDiscriminantSwitchIIFE(
  ctx: MacroContext,
  chainExpr: ts.Expression,
  scrutinee: ts.Expression,
  dm: DiscriminantMatch,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = scrutineeShortName(ctx, scrutinee);
  const scrutineeRef = () => f.createIdentifier(scrutineeName.text);

  const analysis = getScrutineeAnalysis(ctx, scrutinee);
  const needsNullGuard = !(
    analysis?.kind === "discriminated-union" && analysis.nullishMembers === undefined
  );

  // Group arms by discriminant value, preserving source order. Arms with
  // different tags are mutually exclusive, so grouping keeps first-match.
  const groups = new Map<string, DiscriminantArmInfo[]>();
  for (const discArm of dm.arms) {
    const g = groups.get(discArm.discriminantKey);
    if (g) g.push(discArm);
    else groups.set(discArm.discriminantKey, [discArm]);
  }

  const caseClauses: ts.CaseOrDefaultClause[] = [];
  for (const group of groups.values()) {
    const body: ts.Statement[] = [];
    for (const discArm of group) {
      const armStmts = generateArmStatements(
        ctx,
        f,
        discArm.residualPattern,
        scrutineeRef(),
        discArm.arm.guard,
        discArm.arm.result,
        discArm.arm.asPattern,
        true
      );
      // Each arm in its own block so same-named bindings can't collide (#1).
      if (armStmts.length === 1 && ts.isBlock(armStmts[0])) body.push(armStmts[0]);
      else body.push(f.createBlock(armStmts, true));
    }
    body.push(f.createBreakStatement());
    caseClauses.push(f.createCaseClause(group[0].discriminantValue, [f.createBlock(body, true)]));
  }

  const switchStmt = f.createSwitchStatement(
    f.createPropertyAccessExpression(scrutineeRef(), dm.discriminantKey),
    f.createCaseBlock(caseClauses)
  );

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
    const isObject = f.createBinaryExpression(
      f.createBinaryExpression(
        f.createTypeOfExpression(scrutineeRef()),
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        f.createStringLiteral("object")
      ),
      ts.SyntaxKind.AmpersandAmpersandToken,
      f.createBinaryExpression(
        scrutineeRef(),
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        f.createNull()
      )
    );
    stmts.push(f.createIfStatement(isObject, f.createBlock([switchStmt], true)));
  } else {
    stmts.push(switchStmt);
  }

  // Fallback (reached by unmatched tags, failed guards/residual tests, and
  // non-objects): catch-all arm, then else / MatchError.
  if (dm.catchAllArm) {
    const pat = analyzePattern(dm.catchAllArm.pattern);
    stmts.push(
      ...generateArmStatements(
        ctx,
        f,
        pat,
        scrutineeRef(),
        dm.catchAllArm.guard,
        dm.catchAllArm.result,
        dm.catchAllArm.asPattern
      )
    );
  }
  const catchAllAlwaysReturns = dm.catchAllArm !== undefined && !dm.catchAllArm.guard;
  if (!catchAllAlwaysReturns) {
    stmts.push(
      elseResult !== undefined
        ? f.createReturnStatement(elseResult)
        : createMatchErrorThrow(ctx, scrutineeRef())
    );
  }

  return wrapInIIFE(ctx, chainExpr, stmts, movedExpressions(scrutinee, arms, elseResult));
}

// ============================================================================
// Wave 5: Dead Arm Elimination (Output Optimization)
// ============================================================================

/**
 * A scrutinee expression that can be dropped without losing side effects:
 * identifiers, `this`, literals and plain property-access chains of those.
 */
function isSideEffectFree(expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr)) return isSideEffectFree(expr.expression);
  if (ts.isIdentifier(expr)) return true;
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (
    ts.isStringLiteral(expr) ||
    ts.isNumericLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expr) && !expr.questionDotToken) {
    return isSideEffectFree(expr.expression);
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    return isSideEffectFree(expr.expression);
  }
  return false;
}

/**
 * If the scrutinee is a single literal type, we can emit only the matching
 * arm's result directly — no IIFE, no branching, no checks.
 *
 * Only when that is provably equivalent (deep review #5): the scrutinee has
 * no side effects (it is dropped), every arm up to and including the chosen
 * one is a plain literal or `_` (no bindings, no `.as()`, no `.or()`, no
 * guard, no type-constructor/extractor tests), and the chosen arm is the
 * literal equal to the scrutinee's single value or a `_`.
 */
function tryDirectEmit(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression | undefined {
  if (!isSideEffectFree(scrutinee)) return undefined;
  const analysis = getScrutineeAnalysis(ctx, scrutinee);
  if (!analysis) return undefined;

  if (analysis.kind === "literal-union" && analysis.literalMembers?.size === 1) {
    const singleValue = [...analysis.literalMembers][0];
    for (const arm of arms) {
      if (arm.guard || arm.asPattern || arm.alternatives.length > 0) return undefined;
      const pattern = analyzePattern(arm.pattern);
      if (pattern.kind === "wildcard") return arm.result;
      if (pattern.kind !== "literal") return undefined;
      const key = getPatternLiteralKey(pattern);
      if (key === undefined || key === "NaN") return undefined;
      if (key === singleValue) return arm.result;
    }
    if (elseResult !== undefined) return elseResult;
  }

  return undefined;
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
  return withBuiltinExtractorsFor(ctx, rootArgs[0], () =>
    expandFluentMatchInner(ctx, chainExpr, rootArgs)
  );
}

/**
 * Run `fn` with `ctx` as the context extractor names are resolved in.
 * @internal shared with match-switch.ts
 */
export function withBuiltinExtractorsFor<T>(
  ctx: MacroContext,
  _scrutinee: ts.Expression | undefined,
  fn: () => T
): T {
  const prevCtx = extractorContext;
  extractorContext = ctx;
  try {
    return fn();
  } finally {
    extractorContext = prevCtx;
  }
}

function expandFluentMatchInner(
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

  // `.or()` alternatives can't bind names: only one alternative matches, so
  // the others' bindings would be undefined (deep review #15). Bind the whole
  // value with `.as()` instead.
  for (const arm of arms) {
    if (arm.alternatives.length === 0) continue;
    for (const pat of [arm.pattern, ...arm.alternatives]) {
      if (patternHasBindings(analyzePattern(pat))) {
        ctx.reportError(
          pat,
          "match: variable bindings are not supported inside .or() alternatives — use " +
            "literals/_ in each alternative and bind the matched value with .as(name)"
        );
        return chainExpr;
      }
    }
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

  // Wave 5: Switch optimization for 7+ pure literal arms
  if (arms.length >= SWITCH_THRESHOLD && isAllPureLiteralArms(arms)) {
    return generateSwitchIIFE(ctx, chainExpr, scrutinee, arms, elseResult);
  }

  // Literal arms with a terminal value → `x === a ? r1 : x === b ? r2 : r3`
  const chain = tryGenerateConditionalChain(ctx, scrutinee, arms, elseResult);
  if (chain !== undefined) return chain;

  // PEP-019 Wave 3: Discriminant switch for object patterns sharing a discriminant key
  const discMatch = analyzeDiscriminantPattern(arms);
  if (discMatch) {
    return generateDiscriminantSwitchIIFE(ctx, chainExpr, scrutinee, discMatch, arms, elseResult);
  }

  return generateIIFE(ctx, chainExpr, scrutinee, arms, elseResult);
}

/**
 * Compile a match whose arms bind nothing — plain literals (each `.case(lit)`
 * with any number of literal `.or(lit)`s) and extractors with no bindings
 * (`None`, `Nil`, `Some(_)`), no guard, no `.as()` — optionally ending in a
 * `_` arm, to a conditional chain with no IIFE:
 *
 *   match(t).case("a").or("b").then(1).case("c").then(2).else(3)
 *   → t === "a" || t === "b" ? 1 : t === "c" ? 2 : 3
 *   match(o).case(None).then("none").case(Some(_)).then("some")
 *   → o == null ? "none" : "some"
 *
 * This is what a person writes, and what the guide documents
 * (`x === "ok" ? 200 : 500`). Before the Turf case study (Stage 3) only a
 * single arm + `.else()` got it; anything longer became an arrow IIFE — a
 * closure per evaluation — with a dead `throw new MatchError` after a fully
 * covering last arm, which added a runtime import of `@typesugar/std`.
 *
 * Taken only when it is provably equivalent to the IIFE:
 * - The chain ends in a value that needs no throw: `.else()`, a `_` arm, or
 *   an arm after which the arms provably cover the scrutinee's type
 *   ({@link findCoveringArmIndex}; that arm is unconditional, as in the
 *   IIFE). Otherwise the IIFE's MatchError is needed and it is used.
 * - Reading the scrutinee in every test is the same as reading it once: it
 *   is an identifier or `this`, or (literal arms only) it is read by exactly
 *   one test. A property access is not enough — it may be a getter (the
 *   IIFE reads it once into a const). An extractor's test may read it more
 *   than once (`x != null && "left" in x`), so it needs an identifier or
 *   `this`. With no test at all it must be side-effect free, since the chain
 *   would not evaluate it.
 * Arms that bind names need a block for their `const`s, so they keep the IIFE.
 * The results move nowhere (no arrow), so `await`/`yield` in them keep
 * their meaning.
 */
function tryGenerateConditionalChain(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression | undefined {
  const f = ctx.factory;
  const tests: { patterns: PatternInfo[]; result: ts.Expression }[] = [];
  let terminal: ts.Expression | undefined;

  let coveringIdx: number | undefined;
  const coveredAt = () => (coveringIdx ??= findCoveringArmIndex(ctx, scrutinee, arms));

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    if (arm.guard || arm.asPattern) return undefined;
    const pattern = analyzePattern(arm.pattern);
    if (pattern.kind === "wildcard" && arm.alternatives.length === 0) {
      terminal = arm.result;
      break;
    }
    const patterns = [pattern, ...arm.alternatives.map(analyzePattern)];
    for (const p of patterns) {
      const testOnly =
        p.kind === "literal" ||
        (p.kind === "extractor" &&
          (p.def.kind === "sum-variant" || p.def.kind === "product") &&
          !patternHasBindings(p));
      if (!testOnly) return undefined;
    }
    if (coveredAt() === i) {
      terminal = arm.result;
      break;
    }
    tests.push({ patterns, result: arm.result });
  }
  terminal ??= elseResult;
  if (terminal === undefined) return undefined;

  const literalOnly = tests.every((t) => t.patterns.every((p) => p.kind === "literal"));
  const reads = tests.reduce((n, t) => n + t.patterns.length, 0);
  const rereadable = ts.isIdentifier(scrutinee) || scrutinee.kind === ts.SyntaxKind.ThisKeyword;
  if (!rereadable && (reads > 1 || (reads === 1 && !literalOnly))) return undefined;
  if (reads === 0 && !isSideEffectFree(scrutinee)) return undefined;
  // One node per read, as the IIFE path does with its `_m` references.
  const read = (): ts.Expression =>
    !rereadable
      ? scrutinee
      : ts.isIdentifier(scrutinee)
        ? f.createIdentifier(scrutinee.text)
        : f.createThis();

  const skipObjectGuard = !literalOnly && isGuaranteedObject(ctx, scrutinee);
  const scrutineeType = literalOnly ? undefined : getScrutineeType(ctx, scrutinee);
  const test = (p: PatternInfo): ts.Expression =>
    p.kind === "literal"
      ? literalCheck(f, read(), p.node)
      : (buildCondition(f, p, read(), skipObjectGuard, scrutineeType) ?? f.createTrue());

  let result = terminal;
  for (let i = tests.length - 1; i >= 0; i--) {
    const condition = tests[i].patterns
      .map(test)
      .reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b));
    result = f.createConditionalExpression(
      condition,
      f.createToken(ts.SyntaxKind.QuestionToken),
      tests[i].result,
      f.createToken(ts.SyntaxKind.ColonToken),
      result
    );
  }
  return result;
}

// ============================================================================
// Pattern Code Generation (recursive for nested patterns)
// ============================================================================

/**
 * The expression an extractor's payload position reads: the value itself
 * (`self`), asserted to its payload type when the value's type doesn't
 * narrow to it (`o as unknown as number` for an `@opaque` Option, see
 * `PayloadTyping`), or one of its fields.
 * @internal shared with match-switch.ts
 */
export function payloadAccess(
  f: ts.NodeFactory,
  accessor: ts.Expression,
  field: string,
  typing: PayloadTyping | undefined
): ts.Expression {
  if (field !== SELF_PAYLOAD) return f.createPropertyAccessExpression(accessor, field);
  if (!typing?.selfCast) return accessor;
  return f.createAsExpression(
    f.createAsExpression(accessor, f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)),
    typing.selfCast
  );
}

/** `(x as unknown as T)` where a test uses it as an operand, for the reader. */
function asOperand(f: ts.NodeFactory, e: ts.Expression): ts.Expression {
  return ts.isAsExpression(e) ? f.createParenthesizedExpression(e) : e;
}

/**
 * Collect all variable bindings from a pattern tree (for nested patterns).
 * Returns binding statements that destructure from the given accessor expression.
 * `accessorType` is the accessor's static type when known (the scrutinee's,
 * or an extractor payload's), which types extractor payloads under it.
 */
function collectBindings(
  f: ts.NodeFactory,
  pattern: PatternInfo,
  accessor: ts.Expression,
  accessorType?: ts.Type
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
      return collectBindings(f, pattern.binding, accessor, accessorType);

    case "extractor": {
      const { def, bindings } = pattern;
      const stmts: ts.Statement[] = [];

      if (def.kind === "sum-variant") {
        const payloadFields = def.payloadFields ?? [];
        const typing = accessorType && def.payloadTyping?.(accessorType);
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = payloadFields[i];
          if (field === undefined) continue;
          stmts.push(
            ...collectBindings(
              f,
              binding,
              payloadAccess(f, accessor, field, typing),
              typing?.types[i]
            )
          );
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
/** @internal shared with match-switch.ts */
export function buildCondition(
  f: ts.NodeFactory,
  pattern: PatternInfo,
  accessor: ts.Expression,
  skipObjectGuard = false,
  accessorType?: ts.Type
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "literal":
      return literalCheck(f, accessor, pattern.node);

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
            literalCheck(f, f.createElementAccessExpression(accessor, i), elem.pattern.node)
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
            literalCheck(f, f.createPropertyAccessExpression(accessor, prop.key), prop.pattern.node)
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

      if (parts.length === 0) return undefined;
      return parts.reduce((a, b) =>
        f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
      );
    }

    case "type-constructor": {
      // Constructor test AND the inner pattern's own test — `Array([x, y])`
      // must check the length, `Number(5)` the value (deep review #14).
      const ctorCheck = buildTypeConstructorCheck(f, pattern.constructorName, accessor);
      const inner = patternCoversAll(pattern.binding)
        ? undefined
        : buildCondition(f, pattern.binding, accessor, false, accessorType);
      return inner
        ? f.createBinaryExpression(ctorCheck, ts.SyntaxKind.AmpersandAmpersandToken, inner)
        : ctorCheck;
    }

    case "extractor": {
      const { def, bindings } = pattern;

      if (def.kind === "sum-variant" && def.test) {
        const nullCmp = (op: ts.BinaryOperator) =>
          f.createBinaryExpression(accessor, op, f.createNull());
        const parts: ts.Expression[] = [];
        if (def.test === "not-null") {
          parts.push(nullCmp(ts.SyntaxKind.ExclamationEqualsToken));
        } else if (def.test === "null") {
          parts.push(nullCmp(ts.SyntaxKind.EqualsEqualsToken));
        } else if (def.test === "always") {
          // a product type: every value matches; only the payload's own tests apply
        } else {
          // `in` throws on primitives: test for an object first (#14).
          if (!skipObjectGuard) {
            parts.push(
              nullCmp(ts.SyntaxKind.ExclamationEqualsToken),
              f.createBinaryExpression(
                f.createTypeOfExpression(accessor),
                ts.SyntaxKind.EqualsEqualsEqualsToken,
                f.createStringLiteral("object")
              )
            );
          }
          parts.push(
            f.createBinaryExpression(
              f.createStringLiteral(def.test.hasKey),
              ts.SyntaxKind.InKeyword,
              accessor
            )
          );
        }
        const payloadFields = def.payloadFields ?? [];
        const typing = accessorType && def.payloadTyping?.(accessorType);
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = payloadFields[i];
          if (field === undefined || binding.kind === "wildcard" || binding.kind === "variable")
            continue;
          const nested = buildCondition(
            f,
            binding,
            asOperand(f, payloadAccess(f, accessor, field, typing)),
            false,
            typing?.types[i]
          );
          if (nested) parts.push(nested);
        }
        if (parts.length === 0) return undefined;
        return parts.reduce((a, b) =>
          f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
        );
      }

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

        // `null._tag` throws: guard nullish scrutinees (`Option | null`, #14)
        // unless the type proves the scrutinee is an object.
        const parts: ts.Expression[] = skipObjectGuard
          ? [discCheck]
          : [
              f.createBinaryExpression(
                accessor,
                ts.SyntaxKind.ExclamationEqualsToken,
                f.createNull()
              ),
              discCheck,
            ];

        // Recurse into nested patterns on payload fields
        const payloadFields = def.payloadFields ?? [];
        const typing = accessorType && def.payloadTyping?.(accessorType);
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          const field = payloadFields[i];
          if (field === undefined || binding.kind === "wildcard" || binding.kind === "variable")
            continue;
          const nested = buildCondition(
            f,
            binding,
            asOperand(f, payloadAccess(f, accessor, field, typing)),
            false,
            typing?.types[i]
          );
          if (nested) parts.push(nested);
        }

        return parts.reduce((a, b) =>
          f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
        );
      }

      if (def.kind === "product") {
        // Inlined structural check: verify all required fields exist. `in`
        // throws on primitives, so test for an object first (#14).
        const fields = def.productFields ?? [];
        const checks: ts.Expression[] = skipObjectGuard
          ? []
          : [
              f.createBinaryExpression(
                f.createTypeOfExpression(accessor),
                ts.SyntaxKind.EqualsEqualsEqualsToken,
                f.createStringLiteral("object")
              ),
              f.createBinaryExpression(
                accessor,
                ts.SyntaxKind.ExclamationEqualsEqualsToken,
                f.createNull()
              ),
            ];
        checks.push(
          ...fields.map((field) =>
            f.createBinaryExpression(
              f.createStringLiteral(field),
              ts.SyntaxKind.InKeyword,
              accessor
            )
          )
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

/** `typeof`/`instanceof`/`Array.isArray` test for a type-constructor pattern. */
function buildTypeConstructorCheck(
  f: ts.NodeFactory,
  constructorName: string,
  accessor: ts.Expression
): ts.Expression {
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
  skipObjectGuard = false,
  scrutineeType?: ts.Type
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
    const cond = buildCondition(f, analyzed, scrutineeRef, skipObjectGuard, scrutineeType);
    if (cond) {
      conditions.push(cond);
    }
  }

  // `.as()` bindings are emitted before the guard so the guard and result
  // can see them (deep review #15). Bindings INSIDE alternatives are
  // rejected up front in expandFluentMatch.
  const body: ts.Statement[] = arm.asPattern
    ? generateAsBindings(f, arm.asPattern, scrutineeRef)
    : [];
  body.push(
    arm.guard
      ? f.createIfStatement(arm.guard, f.createReturnStatement(arm.result))
      : f.createReturnStatement(arm.result)
  );
  const bodyStmt = body.length === 1 ? body[0] : f.createBlock(body, true);

  if (hasUnconditional || conditions.length === 0) {
    return [bodyStmt];
  }

  const combined = conditions.reduce((a, b) =>
    f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b)
  );

  if (arm.guard && !arm.asPattern) {
    const check = f.createBinaryExpression(
      f.createParenthesizedExpression(combined),
      ts.SyntaxKind.AmpersandAmpersandToken,
      arm.guard
    );
    return [f.createIfStatement(check, f.createReturnStatement(arm.result))];
  }

  return [f.createIfStatement(combined, bodyStmt)];
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

  // const __r = typeof __m === "string" ? __m.match(/regex/) : null;
  // (non-strings have no .match — deep review #14)
  const matchCall = f.createConditionalExpression(
    f.createBinaryExpression(
      f.createTypeOfExpression(scrutineeRef),
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      f.createStringLiteral("string")
    ),
    f.createToken(ts.SyntaxKind.QuestionToken),
    f.createCallExpression(f.createPropertyAccessExpression(scrutineeRef, "match"), undefined, [
      pattern.node,
    ]),
    f.createToken(ts.SyntaxKind.ColonToken),
    f.createNull()
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

  // const _ext = destructureX.extract(_m) — the Destructure instance, called once
  const instance = pattern.def.instance?.(ctx) ?? f.createIdentifier(extName);
  const extractCall = f.createCallExpression(
    f.createPropertyAccessExpression(instance, "extract"),
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
  skipObjectGuard = false,
  scrutineeType?: ts.Type
): ts.Statement[] {
  const asBindings = asPattern ? generateAsBindings(f, asPattern, scrutineeRef) : [];

  switch (pattern.kind) {
    case "literal": {
      const condition = literalCheck(f, scrutineeRef, pattern.node);
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
      const condition = buildCondition(f, pattern, scrutineeRef, skipObjectGuard, scrutineeType);
      const bindings = collectBindings(f, pattern, scrutineeRef, scrutineeType);

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
      const condition = buildCondition(f, pattern, scrutineeRef, skipObjectGuard, scrutineeType);
      const bindings = collectBindings(f, pattern, scrutineeRef, scrutineeType);

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
/** @internal shared with match-switch.ts */
export function isGuaranteedObject(ctx: MacroContext, scrutinee: ts.Expression): boolean {
  const type = getScrutineeType(ctx, scrutinee);
  if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;

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
}

function generateIIFE(
  ctx: MacroContext,
  chainExpr: ts.Expression,
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

  // The extractor payloads under the scrutinee are typed from its type.
  const scrutineeType = getScrutineeType(ctx, scrutinee);

  // Wave 5: the arm after which the arms provably cover the scrutinee's type
  const coveringIdx = findCoveringArmIndex(ctx, scrutinee, arms);
  let terminated = false;

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const scrutineeRef = f.createIdentifier(scrutineeName.text);

    // Wave 5: the covering arm returns unconditionally: no test, only its
    // bindings (AS patterns and destructuring), and nothing after it.
    if (i === coveringIdx) {
      if (arm.asPattern) {
        const asBindings = generateAsBindings(f, arm.asPattern, scrutineeRef);
        statements.push(...asBindings);
      }
      const armPattern = analyzePattern(arm.pattern);
      if (armPattern.kind !== "literal" && armPattern.kind !== "wildcard") {
        const bindings = collectBindings(f, armPattern, scrutineeRef, scrutineeType);
        statements.push(...bindings);
      }
      statements.push(f.createReturnStatement(arm.result));
      // Every later arm (and the else / MatchError) is unreachable.
      break;
    }

    // OR patterns: build || chain of conditions
    if (arm.alternatives.length > 0) {
      statements.push(
        ...generateOrArmStatements(ctx, f, arm, scrutineeRef, skipObjectGuard, scrutineeType)
      );
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
      skipObjectGuard,
      scrutineeType
    );
    statements.push(...armStatements);
    // An unguarded product extractor that binds without testing
    // (`@destructure always`) always returns: nothing after it can run.
    if (
      !arm.guard &&
      pattern.kind === "extractor" &&
      pattern.def.test === "always" &&
      pattern.bindings.every((b) => b.kind === "variable" || b.kind === "wildcard")
    ) {
      terminated = true;
      break;
    }
  }

  // else clause or MatchError — unless an arm already returns unconditionally
  // (a fully covering arm, or an unguarded `_` / binding). A dead
  // `throw new MatchError` there still imported `@typesugar/std` at runtime.
  const last = statements[statements.length - 1];
  if (terminated || (last !== undefined && ts.isReturnStatement(last))) {
    // terminated
  } else if (elseResult !== undefined) {
    statements.push(f.createReturnStatement(elseResult));
  } else {
    statements.push(createMatchErrorThrow(ctx, f.createIdentifier(scrutineeName.text)));
  }

  // (() => { ... })()  — or `await (async () => { ... })()` when arms await
  return wrapInIIFE(ctx, chainExpr, statements, movedExpressions(scrutinee, arms, elseResult));
}

// ============================================================================
// Macro Registration
// ============================================================================

/** Discriminant names tried (in order) when the handler form names none. */
const OBJECT_HANDLER_DISCRIMINANTS = [
  "kind",
  "_tag",
  "type",
  "ok",
  "status",
  "tag",
  "variant",
  "action",
  "event",
  "case",
  "state",
  "name",
  "nodeType",
];

/**
 * Leave the dispatch to the runtime `match(value, handlers)` (match-runtime.ts).
 * Used whenever the macro can't produce code that provably agrees with it:
 * `any`/`unknown` values, mixed primitive/object or nullable unions, objects
 * with no recognisable discriminant, or a type the checker can't give us.
 * The callee is a fresh synthetic import, which the visitor never re-expands.
 */
function deferToRuntimeMatch(ctx: MacroContext, callExpr: ts.CallExpression): ts.Expression {
  return ctx.factory.createCallExpression(
    ctx.ensureImport("match", "@typesugar/std"),
    undefined,
    callExpr.arguments
  );
}

function handlerKeyText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  // JS normalises numeric keys (`{ 1.0: f }` has key "1"); so does the runtime.
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  return undefined;
}

/**
 * The literal(s) a handler key stands for, given the type of the value being
 * dispatched on: `"1"` is the string `"1"` for a `"1" | "2"` union and the
 * number `1` for `number`; `true` is the boolean for a boolean tag
 * (deep review #6 — the old code guessed from the key text alone).
 */
function literalsForHandlerKey(f: ts.NodeFactory, key: string, tagType: ts.Type): ts.Expression[] {
  const parts = tagType.isUnion() ? tagType.types : [tagType];
  let wantString = false;
  let wantNumber = false;
  let wantBool = false;
  const numericKey = key !== "" && String(Number(key)) === key;
  for (const t of parts) {
    if (t.isStringLiteral()) {
      if (t.value === key) wantString = true;
    } else if (t.flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) {
      wantString = true;
    } else if (t.isNumberLiteral()) {
      if (String(t.value) === key) wantNumber = true;
    } else if (t.flags & (ts.TypeFlags.Number | ts.TypeFlags.Enum)) {
      if (numericKey) wantNumber = true;
    } else if (t.flags & ts.TypeFlags.BooleanLiteral) {
      if ((t as { intrinsicName?: string }).intrinsicName === key) wantBool = true;
    } else if (t.flags & ts.TypeFlags.Boolean) {
      if (key === "true" || key === "false") wantBool = true;
    }
  }
  const out: ts.Expression[] = [];
  if (wantString) out.push(f.createStringLiteral(key));
  if (wantNumber) {
    const n = Number(key);
    out.push(
      n < 0 || Object.is(n, -0)
        ? f.createPrefixUnaryExpression(
            ts.SyntaxKind.MinusToken,
            f.createNumericLiteral(String(-n))
          )
        : f.createNumericLiteral(key)
    );
  }
  if (wantBool) out.push(key === "true" ? f.createTrue() : f.createFalse());
  return out;
}

/**
 * Expand the object-handler form: match(value, { kind1: handler, kind2: handler, _: fallback })
 * Generates a ternary chain inside an IIFE taking the value as a parameter.
 *
 * Semantics follow the runtime `match(value, handlers)`; whenever the macro
 * can't prove agreement it defers to that runtime (see deferToRuntimeMatch).
 */
function expandObjectHandlerMatch(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  value: ts.Expression,
  handlers: ts.ObjectLiteralExpression,
  explicitDiscriminant?: string
): ts.Expression {
  const f = ctx.factory;

  // Collect handler entries. Every entry shape is either understood or
  // rejected — a silently dropped handler changes behaviour (#6).
  const entries: Array<{ keys: string[]; handler: ts.Expression; node: ts.Node }> = [];
  let wildcardHandler: ts.Expression | undefined;

  for (const prop of handlers.properties) {
    let handler: ts.Expression | undefined;
    if (ts.isPropertyAssignment(prop)) {
      handler = prop.initializer;
    } else if (ts.isMethodDeclaration(prop) && prop.body) {
      // `circle(c) { return c.r; }` → `function (c) { return c.r; }`
      handler = f.createFunctionExpression(
        ts.getModifiers(prop)?.filter((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
        prop.asteriskToken,
        undefined,
        prop.typeParameters,
        prop.parameters,
        prop.type,
        prop.body
      );
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      handler = prop.name;
    }
    const name = prop.name ? handlerKeyText(prop.name) : undefined;
    if (handler === undefined || name === undefined) {
      ctx.reportError(
        prop,
        "match(value, handlers): each handler must be `key: fn`, `key(arg) { ... }` or a " +
          "shorthand `key` with an identifier, string or numeric key (spreads, accessors and " +
          "computed keys are not supported)"
      );
      return callExpr;
    }

    if (name === "_") {
      wildcardHandler = handler;
    } else {
      // Handle OR patterns: "a|b" splits into ["a", "b"]
      const keys = name.includes("|") ? name.split("|").filter(Boolean) : [name];
      entries.push({ keys, handler, node: prop });
    }
  }

  // Decide how to dispatch from the value's type (CLAUDE.md rule 3: never ask
  // the checker about a synthetic node; warn when degrading after a failure).
  if (isSyntheticNode(value)) return deferToRuntimeMatch(ctx, callExpr);
  let valueType: ts.Type;
  try {
    valueType = ctx.getTypeOf(value);
  } catch (e) {
    ctx.reportWarning(
      value,
      `match(value, handlers): could not determine the value's type (${e instanceof Error ? e.message : String(e)}); ` +
        `falling back to runtime dispatch.`
    );
    return deferToRuntimeMatch(ctx, callExpr);
  }
  if (valueType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return deferToRuntimeMatch(ctx, callExpr);
  }

  const members = valueType.isUnion() ? valueType.types : [valueType];
  const PRIMITIVE = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike;
  const isPrimitive = members.every((t) => (t.flags & PRIMITIVE) !== 0);
  const isObject = members.every(
    (t) => (t.flags & ts.TypeFlags.Object) !== 0 || t.isIntersection()
  );

  const paramName = f.createUniqueName("_m");
  let tagExpr: ts.Expression;
  let tagType: ts.Type;
  // Object dispatch reads the discriminant ONCE into a const (`const _k =
  // _m.kind`) and compares that: TS narrows `_m` through the aliased
  // discriminant, and the non-exhaustive throw can name `_k` — reading
  // `_m.kind` there failed strict checking because every variant has
  // already narrowed `_m` to `never` (docs review r3 guides-b #3).
  let discriminantDecl: ts.Statement | undefined;

  if (isPrimitive) {
    tagExpr = paramName;
    tagType = valueType;
  } else if (isObject) {
    let discProp: ts.Symbol | undefined;
    let discriminant: string | undefined;
    try {
      for (const name of explicitDiscriminant
        ? [explicitDiscriminant]
        : OBJECT_HANDLER_DISCRIMINANTS) {
        const sym = ctx.typeChecker.getPropertyOfType(valueType, name);
        if (sym) {
          discProp = sym;
          discriminant = name;
          break;
        }
      }
    } catch (e) {
      ctx.reportWarning(
        value,
        `match(value, handlers): could not inspect the value's properties (${e instanceof Error ? e.message : String(e)}); ` +
          `falling back to runtime dispatch.`
      );
      return deferToRuntimeMatch(ctx, callExpr);
    }
    if (!discProp || !discriminant) return deferToRuntimeMatch(ctx, callExpr);
    const tagName = f.createUniqueName("_k");
    discriminantDecl = f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            tagName,
            undefined,
            undefined,
            f.createPropertyAccessExpression(paramName, discriminant)
          ),
        ],
        ts.NodeFlags.Const
      )
    );
    tagExpr = tagName;
    tagType = ctx.typeChecker.getTypeOfSymbol(discProp);
  } else {
    // Mixed primitive/object or nullable unions: the runtime switches between
    // literal and discriminant dispatch per value — let it.
    return deferToRuntimeMatch(ctx, callExpr);
  }

  // An inline handler that declares no parameters (`circle: () => "c"`) is
  // called with none — passing the value failed strict checking with
  // "Expected 0 arguments, but got 1" (docs review r3 guides-b #3).
  const callHandler = (h: ts.Expression) => {
    const inline = ts.isArrowFunction(h) || ts.isFunctionExpression(h);
    return f.createCallExpression(
      inline ? f.createParenthesizedExpression(h) : h,
      undefined,
      inline && h.parameters.length === 0 ? [] : [paramName]
    );
  };

  let result: ts.Expression;
  if (wildcardHandler) {
    result = callHandler(wildcardHandler);
  } else if (isPrimitive) {
    result = f.createCallExpression(
      f.createPropertyAccessExpression(ctx.ensureImport("MatchError", "@typesugar/std"), "throw"),
      undefined,
      [paramName]
    );
  } else {
    result = f.createCallExpression(
      f.createParenthesizedExpression(
        f.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          f.createBlock(
            [
              f.createThrowStatement(
                f.createNewExpression(f.createIdentifier("Error"), undefined, [
                  f.createTemplateExpression(
                    f.createTemplateHead("Non-exhaustive match: no handler for '"),
                    [f.createTemplateSpan(tagExpr, f.createTemplateTail("'"))]
                  ),
                ])
              ),
            ],
            true
          )
        )
      ),
      undefined,
      []
    );
  }

  // Build ternary chain from last to first
  for (let i = entries.length - 1; i >= 0; i--) {
    const { keys, handler, node } = entries[i];
    const conditions = keys.flatMap((k) =>
      literalsForHandlerKey(f, k, tagType).map((lit) =>
        f.createBinaryExpression(tagExpr, ts.SyntaxKind.EqualsEqualsEqualsToken, lit)
      )
    );
    if (conditions.length === 0) {
      ctx.reportWarning(
        node,
        `match(value, handlers): handler key '${keys.join("|")}' can never match a value of type ` +
          `'${ctx.typeChecker.typeToString(tagType)}'`
      );
      continue;
    }
    const condition = conditions.reduce((a, b) =>
      f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b)
    );
    result = f.createConditionalExpression(
      condition,
      f.createToken(ts.SyntaxKind.QuestionToken),
      callHandler(handler),
      f.createToken(ts.SyntaxKind.ColonToken),
      result
    );
  }

  const arrow = f.createArrowFunction(
    undefined,
    undefined,
    [f.createParameterDeclaration(undefined, undefined, paramName)],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(
      discriminantDecl
        ? [discriminantDecl, f.createReturnStatement(result)]
        : [f.createReturnStatement(result)],
      true
    )
  );
  return f.createCallExpression(f.createParenthesizedExpression(arrow), undefined, [value]);
}

function expandMatch(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  args: readonly ts.Expression[]
): ts.Expression {
  // Fluent chain mode: match(x).case(...).then(...).else(...)
  if (ts.isPropertyAccessExpression(callExpr.expression)) {
    return expandFluentMatch(ctx, callExpr, args);
  }

  if (args.length < 2) {
    ctx
      .diagnostic(TS9216)
      .at(callExpr)
      .withArgs({ macro: "match(value, handlers)", min: "2" })
      .help(
        "Pass a handlers object (`match(value, { Variant: handler })`) or use the fluent form `match(value).case(...)`."
      )
      .emit();
    return callExpr;
  }

  const value = args[0];
  const handlersOrArms = args[1];

  // Guard-array form [when(...), otherwise(...)] is no longer supported
  if (ts.isArrayLiteralExpression(handlersOrArms)) {
    ctx.reportError(
      callExpr,
      "match() with guard arrays [when(), otherwise()] is removed. " +
        "Use the fluent API: match(value).case(x).if(pred).then(handler).else(fallback)"
    );
    return callExpr;
  }

  // Object-handler form: match(value, { variant: handler })
  if (ts.isObjectLiteralExpression(handlersOrArms)) {
    let explicitDiscriminant: string | undefined;
    if (args.length >= 3 && ts.isStringLiteral(args[2])) {
      explicitDiscriminant = args[2].text;
    }
    return expandObjectHandlerMatch(ctx, callExpr, value, handlersOrArms, explicitDiscriminant);
  }

  ctx
    .diagnostic(TS9202)
    .at(handlersOrArms)
    .withArgs({
      macro: "match()",
      index: "2",
      expected: "object literal { variant: handler }",
      received: ts.SyntaxKind[handlersOrArms.kind],
    })
    .emit();
  return callExpr;
}

export const matchMacro = defineExpressionMacro({
  name: "match",
  module: "@typesugar/std",
  description: "Zero-cost exhaustive pattern matching with compile-time optimization",
  chainable: true,
  expand: expandMatch,
});

globalRegistry.register(matchMacro);

// ============================================================================
// Runtime Fallback
// ============================================================================

// The runtime `match(value, handlers)` dispatch is `typescript`-free and lives
// in `./match-runtime.ts` (PEP-050 Case-1) so it can be re-exported from the
// runtime `.` entry without pulling `typescript` in. Re-exported here so the
// `./macros` entry continues to expose `match`.
export { match } from "./match-runtime.js";
