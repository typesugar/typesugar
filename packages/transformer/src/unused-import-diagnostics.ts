/**
 * Unused-import diagnostics for bindings only the expansion uses.
 *
 * Under `noUnusedLocals`, TypeScript reports an import as unused (TS6133,
 * TS6196, or TS6192 for a whole declaration) when the source as written
 * never references it. An import used only through sugar the macros expand
 * is used once expanded: `import { chunk } from "remeda"` with
 * `users.chunk(25)`, rewritten to `chunk(users, 25)` (remeda case study F7).
 * The diagnostic suppression rules run before the expansion in `typesugar
 * check`, so they can't know this; this filter runs after it, on what the
 * expansion really references, in both `check` and `build`.
 */

import * as ts from "typescript";
import * as path from "path";
import { macroReferencedImports } from "./keep-imports.js";

/** "'X' is declared but its value is never read." */
const DECLARED_NEVER_READ = 6133;
/** "All imports in import declaration are unused." */
const ALL_IMPORTS_UNUSED = 6192;
/** "'X' is declared but never used." */
const DECLARED_NEVER_USED = 6196;

/**
 * A `before` transformer, placed after the macro transformer: records, for
 * each file the macros changed, the import bindings the expansion references
 * that the source did not.
 */
export function captureMacroReferencedImports(
  program: ts.Program,
  referenced: Map<string, ReadonlySet<string>>
): ts.TransformerFactory<ts.SourceFile> {
  return () => (sourceFile) => {
    const key = path.resolve(sourceFile.fileName);
    // Watch mode reuses `referenced` across rebuilds: a file emitted again
    // replaces what it recorded last time.
    referenced.delete(key);
    if (sourceFile !== program.getSourceFile(sourceFile.fileName)) {
      const names = macroReferencedImports(sourceFile, program.getTypeChecker());
      if (names.size > 0) referenced.set(key, names);
    }
    return sourceFile;
  };
}

/**
 * `diagnostics` without the unused-import errors for bindings in
 * `referenced`. A TS6192 whose declaration has some referenced bindings and
 * some not becomes one TS6133 per binding nothing uses, as TypeScript reports
 * a declaration with only some bindings unused.
 */
export function withoutMacroReferencedImports(
  diagnostics: readonly ts.Diagnostic[],
  referenced: ReadonlyMap<string, ReadonlySet<string>>
): ts.Diagnostic[] {
  if (referenced.size === 0) return [...diagnostics];
  const out: ts.Diagnostic[] = [];
  for (const d of diagnostics) {
    const names = d.file && referenced.get(path.resolve(d.file.fileName));
    if (
      !names ||
      d.start === undefined ||
      (d.code !== DECLARED_NEVER_READ &&
        d.code !== DECLARED_NEVER_USED &&
        d.code !== ALL_IMPORTS_UNUSED)
    ) {
      out.push(d);
      continue;
    }
    const bindings = importBindingsAt(d.file!, d.start, d.code === ALL_IMPORTS_UNUSED);
    if (!bindings) {
      out.push(d);
      continue;
    }
    const unused = bindings.filter((b) => !names.has(b.text));
    if (unused.length === bindings.length) out.push(d);
    else if (d.code === ALL_IMPORTS_UNUSED) {
      for (const b of unused) out.push(declaredNeverRead(d, b));
    }
  }
  return out;
}

/**
 * The binding names of the import a diagnostic at `start` is about: the whole
 * declaration's for TS6192 (reported at the declaration), else the one
 * binding whose name starts there. Undefined when it isn't an import.
 */
function importBindingsAt(
  file: ts.SourceFile,
  start: number,
  wholeDeclaration: boolean
): ts.Identifier[] | undefined {
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (start < stmt.getStart(file) || start >= stmt.end) continue;
    const clause = stmt.importClause;
    const all: ts.Identifier[] = [];
    if (clause.name) all.push(clause.name);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) all.push(bindings.name);
    else if (bindings) for (const el of bindings.elements) all.push(el.name);
    if (wholeDeclaration) return all.length > 0 ? all : undefined;
    // TS6133 on one of several named imports is reported at its specifier,
    // which starts with `propertyName` in `{ a as b }`; the binding is the
    // specifier's name. With a single binding it is reported at the
    // declaration.
    if (all.length === 1) return all;
    const one =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.find((el) => start >= el.getStart(file) && start < el.end)?.name
        : undefined;
    const hit = one ?? all.find((id) => start >= id.getStart(file) && start < id.end);
    return hit ? [hit] : undefined;
  }
  return undefined;
}

function declaredNeverRead(from: ts.Diagnostic, name: ts.Identifier): ts.Diagnostic {
  const file = from.file!;
  const specifier = ts.isImportSpecifier(name.parent) ? name.parent : name;
  const start = specifier.getStart(file);
  return {
    file,
    start,
    length: specifier.end - start,
    category: from.category,
    code: DECLARED_NEVER_READ,
    messageText: `'${name.text}' is declared but its value is never read.`,
    reportsUnnecessary: from.reportsUnnecessary,
  };
}
