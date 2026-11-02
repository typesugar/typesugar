/**
 * When a JSDoc `@derive` tag applies (audit/FABLE-AUDIT-2026-11.md F23).
 *
 * The decorator form, `@derive(Eq)`, is resolved through the imported
 * `derive`, so a custom decorator of that name is never taken over. The JSDoc
 * form is a comment; it applies to a derivable `X` only when the file binds
 * `X` itself — an import of it (named, default or `import X = require(...)`,
 * type-only included) or a top-level declaration of it — or, for a derive
 * macro that has no export to import, when the file imports the package that
 * registers the macro. So another tool's `@derive` tag, or one in a file that
 * asked typesugar for nothing, is left alone (PEP-052: "derivables are
 * imported too").
 *
 * Every reader of the tag goes through {@link appliedDeriveTagNames} — the
 * derive's expansion, instance scanning, operator/method sugar, the derive
 * planner, the suppression rules — so they agree on which derives happened: a
 * tag the expansion ignored must not be scanned as a companion another file
 * then references. In a declaration file the tag records an expansion that
 * already happened (declaration emit drops the import a tag alone used), so
 * there every listed name applies.
 *
 * Reads a file's own top-level statements and the macro registry, neither of
 * which a pass changes (no same-pass-visibility concern, CLAUDE.md).
 */

import * as ts from "typescript";
import { deriveTagNames, isJSDocTagAtLineStart } from "./ast-utils.js";
import { globalRegistry } from "./registry.js";

const boundNamesByFile = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The names `sourceFile`'s top-level imports and declarations bind. */
function boundNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  let names = boundNamesByFile.get(sourceFile);
  if (names) return names;
  const set = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (clause?.name) set.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) set.add(el.name.text);
      }
    } else if (ts.isImportEqualsDeclaration(stmt)) {
      set.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) set.add(d.name.text);
      }
    } else {
      const name = (stmt as { name?: ts.Node }).name;
      if (name && ts.isIdentifier(name)) set.add(name.text);
    }
  }
  boundNamesByFile.set(sourceFile, (names = set));
  return names;
}

/** Does `sourceFile` import `moduleName` (or a subpath of it) in any form? */
export function fileImportsModule(sourceFile: ts.SourceFile, moduleName: string): boolean {
  return sourceFile.statements.some(
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      (stmt.moduleSpecifier.text === moduleName ||
        stmt.moduleSpecifier.text.startsWith(moduleName + "/"))
  );
}

/** Does a JSDoc `@derive` of `name` apply in `sourceFile`? */
export function isJSDocDeriveActive(sourceFile: ts.SourceFile, name: string): boolean {
  if (sourceFile.isDeclarationFile) return true;
  if (boundNames(sourceFile).has(name)) return true;
  // A derive macro with no export to import: its package's import. A
  // side-effect-free registry read (no ambiguity warning for a probe).
  for (const macroName of [name, `${name}TC`]) {
    for (const macro of globalRegistry.getCandidates(macroName, "derive")) {
      if (macro.module && fileImportsModule(sourceFile, macro.module)) return true;
    }
  }
  return false;
}

/**
 * The derives a `@derive` / `@deriving` JSDoc tag applies: none when the tag
 * is prose or a fenced example ({@link isJSDocTagAtLineStart}), else the
 * names it lists ({@link deriveTagNames}) that {@link isJSDocDeriveActive}.
 * The caller has checked the tag's name.
 */
export function appliedDeriveTagNames(tag: ts.JSDocTag): string[] {
  if (!isJSDocTagAtLineStart(tag)) return [];
  // A copied tag's file is its original's. With no file to read (a
  // detached node), no derive can be shown to apply: none does — the
  // expansion, which always has its file, must not be contradicted.
  let top: ts.Node = ts.getOriginalNode(tag);
  while (top.parent) top = top.parent;
  if (!ts.isSourceFile(top)) return [];
  const sourceFile = top;
  return deriveTagNames(tag).filter((n) => isJSDocDeriveActive(sourceFile, n));
}
