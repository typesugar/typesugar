#!/usr/bin/env node
/**
 * Emit a `.d.cts` beside every `.d.ts` that `tsc -p tsconfig.build.json` wrote
 * into dist/, so the `require` branch of package.json `exports` can point at
 * CJS declarations (a `.d.ts` in a `"type": "module"` package is ESM-typed;
 * a node16 CJS consumer resolving through it gets TS1479).
 *
 * Relative module specifiers ending in `.js` are rewritten to `.cjs` so a
 * `.d.cts` resolves its siblings' `.d.cts` (staying CJS-typed throughout).
 * Specifiers are located with the TypeScript parser and spliced by position;
 * nothing else in the file is touched.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "dist");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".d.ts")) yield p;
  }
}

/** Relative `.js` module-specifier string literals in a declaration file. */
function relativeJsSpecifiers(sf) {
  const out = [];
  const consider = (lit) => {
    if (lit && ts.isStringLiteral(lit) && lit.text.startsWith(".") && lit.text.endsWith(".js")) {
      out.push(lit);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      consider(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      consider(node.argument.literal);
    else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) consider(node.name);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

let count = 0;
for (const file of walk(dist)) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let result = text;
  // Splice from the end so earlier positions stay valid.
  for (const lit of relativeJsSpecifiers(sf).sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
    const start = lit.getStart(sf) + 1; // inside the opening quote
    const end = lit.getEnd() - 1; // before the closing quote
    result = result.slice(0, start) + lit.text.slice(0, -3) + ".cjs" + result.slice(end);
  }
  fs.writeFileSync(file.slice(0, -".d.ts".length) + ".d.cts", result);
  count++;
}
console.log(`emit-dcts: wrote ${count} .d.cts files`);
