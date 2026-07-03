/**
 * Do-notation instance-module index (PEP-052 Wave 4).
 *
 * Program-wide, registry-free discovery of WHICH module's import provides the
 * do-notation instance for a type-constructor brand — used by the TS9225
 * "no instance in scope" hint to name the exact import to add. Providers
 * self-describe with a `@do-instance-module <specifier>` JSDoc tag on the
 * instance declaration, next to its `@impl`/`@do-methods` tags:
 *
 * ```
 * // @impl FlatMap<Effect>
 * // @do-methods bind=flatMap map=map style=static receiver=Effect
 * // @do-instance-module @typesugar/effect/syntax/do
 * ```
 *
 * The index scans every source file in the program once (cached per
 * `ts.Program`, so watch/LSP rebuilds invalidate naturally), exactly like the
 * typeclass op-index. This can only see providers whose declaration files are
 * REACHABLE in the program — a package nothing imports is invisible, which is
 * why the hint keeps a small static fallback table for the well-known brands
 * (see KNOWN_DO_INSTANCE_MODULES): the split-package case (the `Effect` TYPE
 * comes from `effect`, the instances from `@typesugar/effect`) means a file
 * can reference the brand without anything pulling the provider's `.d.ts`
 * into the program.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { parseTypeInstantiation } from "@typesugar/core";
import { brandMatchesForType } from "./instance-resolver.js";

const indexCache = new WeakMap<ts.Program, Map<string, string>>();

const DO_TC_NAMES = new Set(["FlatMap", "ParCombine"]);

/**
 * Map from declared type-constructor name (as written in the `@impl` tag,
 * e.g. "Effect", "OptionF") to the declared activation-module specifier.
 */
function buildIndex(program: ts.Program): Map<string, string> {
  const cached = indexCache.get(program);
  if (cached) return cached;

  const index = new Map<string, string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(sourceFile)) continue;
    // Cheap text pre-filter — most files carry no tag.
    if (!sourceFile.text.includes("@do-instance-module")) continue;

    for (const stmt of sourceFile.statements) {
      let moduleSpecifier: string | undefined;
      let forTypeName: string | undefined;
      for (const tag of ts.getJSDocTags(stmt)) {
        const tagName = tag.tagName.text;
        if (tagName !== "do-instance-module" && tagName !== "impl" && tagName !== "instance") {
          continue;
        }
        const comment =
          typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
        if (!comment) continue;
        if (tagName === "do-instance-module") {
          moduleSpecifier = comment.trim();
        } else {
          const text = comment.replace(/^["'()\s]+|["'()\s]+$/g, "").trim();
          const parsed = parseTypeInstantiation(text);
          if (parsed && DO_TC_NAMES.has(parsed.base)) {
            forTypeName = parsed.args.trim();
          }
        }
      }
      if (moduleSpecifier && forTypeName && !index.has(forTypeName)) {
        index.set(forTypeName, moduleSpecifier);
      }
    }
  }

  indexCache.set(program, index);
  return index;
}

/**
 * The activation-module specifier a provider declared for `brand`'s
 * do-notation instances, if its declaration is reachable in the program.
 * Brand matching follows the resolver's conventions (`B`, `BF`, `_BTag`).
 */
export function getDoInstanceModule(program: ts.Program, brand: string): string | undefined {
  const index = buildIndex(program);
  const exact = index.get(brand);
  if (exact) return exact;
  for (const [forTypeName, specifier] of index) {
    if (brandMatchesForType(forTypeName, brand)) return specifier;
  }
  return undefined;
}
