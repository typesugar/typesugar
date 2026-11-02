/**
 * Type Fact Extraction (BUILD-TIME ONLY)
 *
 * Walks the TypeScript AST to extract known facts from `Refined<T, Brand>`
 * parameter types. When a parameter is typed as `Positive`, we know `param > 0`,
 * which lets the prover skip runtime checks guaranteed by the type system.
 *
 * This module imports `typescript` and is therefore part of the
 * `@typesugar/contracts/macros` (build-time) entry — never the `.` runtime entry.
 * The runtime-pure predicate registry lives in `./type-facts.ts`.
 */

import * as ts from "typescript";
import { isSyntheticNode, type MacroContext } from "@typesugar/core";
import { getRefinementPredicate, type TypeFact } from "./type-facts.js";

export interface ExtractTypeFactsOptions {
  /**
   * Parameter names whose entry-state facts must NOT be used (e.g. for a
   * postcondition: parameters reassigned in the body, or shadowed by the
   * `ensures` result parameter).
   */
  exclude?: ReadonlySet<string>;
}

/**
 * Extract type facts from a function's parameters.
 * Looks for Refined<Base, Brand> types and maps them to known predicates.
 */
export function extractTypeFacts(
  ctx: MacroContext,
  fn: ts.SignatureDeclaration,
  options: ExtractTypeFactsOptions = {}
): TypeFact[] {
  const facts: TypeFact[] = [];

  for (const param of fn.parameters) {
    // Destructuring patterns and rest parameters have no single name the
    // predicate could talk about.
    if (!ts.isIdentifier(param.name) || param.dotDotDotToken) continue;
    const paramName = param.name.text;
    if (options.exclude?.has(paramName)) continue;
    // The checker can throw on macro-synthesized nodes (CLAUDE.md); a
    // synthesized parameter simply contributes no facts.
    if (isSyntheticNode(param)) continue;

    const type = ctx.typeChecker.getTypeAtLocation(param);
    const brand = extractRefinedBrand(ctx.typeChecker, type, param);
    if (!brand) continue;

    const predicate = getRefinementPredicate(brand);
    if (predicate) {
      facts.push({
        variable: paramName,
        // Function replacer: a `$1`/`$&` in the replacement must stay literal.
        predicate: predicate.replace(/\$/g, () => paramName),
      });
    }
  }

  return facts;
}

/**
 * Is this the `[__refined__]` brand property of `Refined<Base, Brand>`?
 *
 * `__refined__` is declared as a `unique symbol`, so the property's
 * `escapedName` is `__@__refined__@<id>` and `prop.name === "__refined__"`
 * never matched (deep review 2026-10, effect-contracts #7). Identify it by
 * its declaration instead: a property signature with the computed name
 * `[__refined__]` (or, for hand-written shapes, the plain name).
 */
function isRefinedBrandProperty(prop: ts.Symbol): boolean {
  for (const decl of prop.getDeclarations() ?? []) {
    if (!ts.isPropertySignature(decl) && !ts.isPropertyDeclaration(decl)) continue;
    const name = decl.name;
    if (ts.isComputedPropertyName(name)) {
      const expr = name.expression;
      if (ts.isIdentifier(expr) && expr.text === "__refined__") return true;
    } else if (ts.isIdentifier(name) && name.text === "__refined__") {
      return true;
    }
  }
  return false;
}

/**
 * Extract the brand string from a Refined<Base, Brand> type, by reading the
 * string-literal type of its brand property through the checker. Returns
 * undefined unless the brand is a single, known string literal — no
 * name-based heuristics (an alias merely NAMED `Positive` proves nothing).
 */
function extractRefinedBrand(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node
): string | undefined {
  // Unions (e.g. an optional `x?: Positive` is `Positive | undefined`) give no
  // fact: the predicate would not hold for the other members.
  if (type.isUnion()) return undefined;

  for (const prop of type.getProperties()) {
    if (!isRefinedBrandProperty(prop)) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, location);
    if (propType.isStringLiteral()) return propType.value;
    return undefined;
  }
  return undefined;
}
