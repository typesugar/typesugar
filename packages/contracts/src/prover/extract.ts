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
import type { MacroContext } from "@typesugar/core";
import { REFINEMENT_PREDICATES, type TypeFact } from "./type-facts.js";

/**
 * Extract type facts from a function's parameters.
 * Looks for Refined<Base, Brand> types and maps them to known predicates.
 */
export function extractTypeFacts(
  ctx: MacroContext,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration
): TypeFact[] {
  const facts: TypeFact[] = [];

  for (const param of fn.parameters) {
    const paramName = param.name.getText();
    const type = ctx.typeChecker.getTypeAtLocation(param);
    const brand = extractRefinedBrand(type);

    if (brand) {
      const predicate = REFINEMENT_PREDICATES[brand];
      if (predicate) {
        facts.push({
          variable: paramName,
          predicate: predicate.replace(/\$/g, paramName),
        });
      }
    }
  }

  return facts;
}

/**
 * Extract the brand string from a Refined<Base, Brand> type.
 * Refined types have a `__refined__` property whose type is a string literal.
 */
function extractRefinedBrand(type: ts.Type): string | undefined {
  // Refined<Base, Brand> = Base & { readonly [__refined__]: Brand }
  // We look for the __refined__ property in the intersection
  if (!type.isIntersection?.()) {
    // Could be a type alias — check properties directly
    return extractBrandFromProperties(type);
  }

  for (const member of type.types) {
    const brand = extractBrandFromProperties(member);
    if (brand) return brand;
  }

  return undefined;
}

function extractBrandFromProperties(type: ts.Type): string | undefined {
  const props = type.getProperties();
  for (const prop of props) {
    if (prop.name === "__refined__") {
      // The type of __refined__ is the brand string literal
      const declarations = prop.getDeclarations();
      if (declarations && declarations.length > 0) {
        const decl = declarations[0];
        if (ts.isPropertySignature(decl) && decl.type && ts.isLiteralTypeNode(decl.type)) {
          if (ts.isStringLiteral(decl.type.literal)) {
            return decl.type.literal.text;
          }
        }
      }

      // Try via type checker
      // The brand is encoded as a string literal type
      const propType = type.getProperty?.("__refined__");
      if (propType) {
        const name = propType.getName();
        if (name === "__refined__") {
          // Try to get the type of this property
          // This is a heuristic — the brand is in the type name
          const typeStr = type.symbol?.getName?.() ?? "";
          // Look for common brand patterns
          for (const brand of Object.keys(REFINEMENT_PREDICATES)) {
            if (typeStr.includes(brand)) return brand;
          }
        }
      }
    }
  }

  // Heuristic: check the type alias name
  const aliasSymbol = type.aliasSymbol;
  if (aliasSymbol) {
    const name = aliasSymbol.getName();
    if (REFINEMENT_PREDICATES[name]) return name;
  }

  return undefined;
}
