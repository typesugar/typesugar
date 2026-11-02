/**
 * Fixture helper for @opaque / type-rewrite erasure tests.
 *
 * Erasure is scoped to the DECLARING symbol (transformer-core c96a5925): a
 * registered entry only rewrites `Some(...)`, `None`, `opt.map(...)` etc. when
 * the referenced symbol / receiver type is declared in the entry's module. A
 * fixture that declares `interface Option` / `Some` / `None` in the consumer
 * file itself therefore no longer matches an entry registered for
 * `@typesugar/fp/...` -- exactly the bug that commit fixed.
 *
 * This helper moves the registered type's declarations (the type itself and
 * its constructors) into a separate virtual module `DECLS_FILE`, imports them
 * into the consumer, and transforms the consumer. Entries are registered with
 * `declarationFile: DECLS_FILE` so the engine sees the same shape it sees in a
 * real project: a type declared in one module, used from another.
 */

import * as path from "path";
import * as ts from "typescript";
import { transformCode, type TransformResult } from "../src/pipeline.js";

export const FIXTURE_DIR = path.resolve("__opaque_fixture__");
export const DECLS_FILE = path.join(FIXTURE_DIR, "opaque-decls.ts");

/** Names that belong to a registered opaque type's defining module. */
const DEFAULT_DECL_NAMES = new Set([
  "Option",
  "Some",
  "None",
  "Either",
  "Left",
  "Right",
  "List",
  "IO",
]);

function declaredNames(stmt: ts.Statement): string[] {
  if (
    (ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt)) &&
    stmt.name
  ) {
    return [stmt.name.text];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations
      .map((d) => (ts.isIdentifier(d.name) ? d.name.text : ""))
      .filter(Boolean);
  }
  return [];
}

/**
 * Split `code` into (declarations of the opaque types, consumer code), put the
 * declarations in `declsFile` (exported) and transform the consumer, which
 * imports them.
 */
export function transformWithDecls(
  code: string,
  fileName: string,
  options: { declsFile?: string; declNames?: Set<string>; strictOutput?: boolean } = {}
): TransformResult & { consumerCode: string; declsCode: string } {
  const declsFile = options.declsFile ?? DECLS_FILE;
  const names = options.declNames ?? DEFAULT_DECL_NAMES;
  const sf = ts.createSourceFile("split.ts", code, ts.ScriptTarget.Latest, true);
  const decls: string[] = [];
  const rest: string[] = [];
  const moved: string[] = [];
  for (const stmt of sf.statements) {
    const stmtNames = declaredNames(stmt);
    const text = stmt.getFullText(sf).trim();
    if (stmtNames.length > 0 && stmtNames.every((n) => names.has(n))) {
      // A leading JSDoc (`/** @opaque A | null */`) stays in front of `export`.
      const jsDoc = /^\/\*\*[\s\S]*?\*\/\s*/.exec(text)?.[0] ?? "";
      decls.push(`${jsDoc}export ${text.slice(jsDoc.length)}`);
      moved.push(...stmtNames);
    } else {
      rest.push(text);
    }
  }
  const consumerFile = path.resolve(path.dirname(declsFile), path.basename(fileName));
  let spec = path.relative(path.dirname(consumerFile), declsFile).replace(/\\/g, "/");
  spec = spec.replace(/\.ts$/, "");
  if (!spec.startsWith(".")) spec = "./" + spec;
  const importLine = moved.length > 0 ? `import { ${moved.join(", ")} } from "${spec}";\n` : "";
  const consumerCode = importLine + rest.join("\n") + "\n";
  const declsCode = decls.join("\n") + "\n";

  const result = transformCode(consumerCode, {
    fileName: consumerFile,
    extraRootFiles: [declsFile],
    readFile: (f) => (f === declsFile ? declsCode : ts.sys.readFile(f)),
    fileExists: (f) => f === declsFile || ts.sys.fileExists(f),
    transformerConfig: { cacheDir: false },
    strictOutput: options.strictOutput,
  });
  return Object.assign(result, { consumerCode, declsCode });
}
