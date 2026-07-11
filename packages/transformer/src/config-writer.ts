/**
 * `typesugar.config.ts` writer for `typesugar approve-macros` (PEP-055).
 *
 * Nothing else in this repo writes back to a project's own config file, so
 * this is genuinely new territory. Three cases, in order of how much of the
 * existing file we can trust ourselves to preserve:
 *
 * 1. No config file exists — build one from scratch via `ts.factory` +
 *    the printer. Pure AST codegen, no exception needed.
 * 2. A `.ts`/`.js`/`.cjs`/`.mjs` file exists and its default export (or
 *    `module.exports =`) is a recognizable `defineConfig({...})`/`{...}`
 *    object-literal shape — patch it. This is the exception-worthy part:
 *    the replacement content is built via `ts.factory`, but it's spliced
 *    into the ORIGINAL file text (via `MagicString`) rather than the whole
 *    file being AST-rebuilt and reprinted, because a full reprint would
 *    discard whatever comments/formatting the human who wrote this config
 *    file has elsewhere in it — the same reasoning `hkt-rewriter.ts` and
 *    `dts-transform.ts`'s `parseOpaqueTypeExpression` already use for the
 *    same "patch one small region of real, human-authored source" problem.
 *    See CLAUDE.md.
 * 3. Anything else (a data file cosmiconfig also recognizes, like
 *    `package.json`/`.typesugarrc.yaml`, or a `.ts`/`.js` file whose
 *    default export isn't a recognizable shape, e.g. a function or a
 *    spread) — don't guess. Report the exact snippet to add by hand.
 *    Nothing is silently dropped.
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import MagicString from "magic-string";

export interface WriteApprovedMacroPackagesOptions {
  /** Project root to create a fresh `typesugar.config.ts` in, if none exists. */
  projectRoot: string;
  /** Path to the config file cosmiconfig found, if any (`config.getConfigFilePath()`). */
  existingConfigPath: string | undefined;
  /** New package names to add to `security.allowedMacroPackages`. */
  newPackages: string[];
}

export type ConfigWriteResult =
  | { kind: "created"; path: string }
  | { kind: "patched"; path: string }
  | { kind: "unchanged"; path: string }
  | { kind: "manual"; path: string; snippet: string };

const PATCHABLE_EXTENSIONS = /\.(ts|js|cjs|mjs)$/;

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

export function writeApprovedMacroPackages(
  options: WriteApprovedMacroPackagesOptions
): ConfigWriteResult {
  const { projectRoot, existingConfigPath, newPackages } = options;

  if (!existingConfigPath) {
    const targetPath = path.join(projectRoot, "typesugar.config.ts");
    fs.writeFileSync(targetPath, renderFreshConfig(newPackages), "utf-8");
    return { kind: "created", path: targetPath };
  }

  if (!PATCHABLE_EXTENSIONS.test(existingConfigPath)) {
    return { kind: "manual", path: existingConfigPath, snippet: renderSnippet(newPackages) };
  }

  const originalText = fs.readFileSync(existingConfigPath, "utf-8");
  const patched = tryPatchExistingConfig(existingConfigPath, originalText, newPackages);

  if (patched === undefined) {
    return { kind: "manual", path: existingConfigPath, snippet: renderSnippet(newPackages) };
  }
  if (patched === originalText) {
    return { kind: "unchanged", path: existingConfigPath };
  }

  fs.writeFileSync(existingConfigPath, patched, "utf-8");
  return { kind: "patched", path: existingConfigPath };
}

// ============================================================================
// Case 1: fresh file
// ============================================================================

function renderFreshConfig(newPackages: string[]): string {
  const importDecl = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(
          false,
          undefined,
          ts.factory.createIdentifier("defineConfig")
        ),
      ])
    ),
    ts.factory.createStringLiteral("@typesugar/core")
  );

  const exportDefault = ts.factory.createExportAssignment(
    undefined,
    false,
    ts.factory.createCallExpression(ts.factory.createIdentifier("defineConfig"), undefined, [
      ts.factory.createObjectLiteralExpression([buildSecurityProperty(newPackages)], true),
    ])
  );

  const sourceFile = ts.factory.createSourceFile(
    [importDecl, exportDefault],
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None
  );

  return printer.printFile(sourceFile);
}

// ============================================================================
// Case 2: patch an existing, recognizable config file
// ============================================================================

function tryPatchExistingConfig(
  fileName: string,
  originalText: string,
  newPackages: string[]
): string | undefined {
  const sourceFile = ts.createSourceFile(
    fileName,
    originalText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );

  const configObj = findDefaultExportObjectLiteral(sourceFile);
  if (!configObj) return undefined;

  const s = new MagicString(originalText);

  const securityProp = findProperty(configObj, "security");
  if (!securityProp) {
    insertProperty(
      s,
      sourceFile,
      configObj,
      printProperty(buildSecurityProperty(newPackages), sourceFile)
    );
    return s.toString();
  }

  if (!ts.isObjectLiteralExpression(securityProp.initializer)) return undefined;
  const securityObj = securityProp.initializer;

  const allowedProp = findProperty(securityObj, "allowedMacroPackages");
  if (!allowedProp) {
    insertProperty(
      s,
      sourceFile,
      securityObj,
      printProperty(buildAllowedMacroPackagesProperty(newPackages), sourceFile)
    );
    return s.toString();
  }

  if (!ts.isArrayLiteralExpression(allowedProp.initializer)) return undefined;
  const existingArray = allowedProp.initializer;

  const existingNames = new Set(
    existingArray.elements.filter(ts.isStringLiteral).map((el) => el.text)
  );
  const toAppend = newPackages.filter((p) => !existingNames.has(p));
  if (toAppend.length === 0) return originalText;

  const updatedArray = ts.factory.updateArrayLiteralExpression(existingArray, [
    ...existingArray.elements,
    ...toAppend.map((p) => ts.factory.createStringLiteral(p)),
  ]);
  s.overwrite(
    existingArray.getStart(sourceFile),
    existingArray.getEnd(),
    printer.printNode(ts.EmitHint.Unspecified, updatedArray, sourceFile)
  );
  return s.toString();
}

/**
 * Find the config object literal from `export default <expr>` or
 * `module.exports = <expr>`, unwrapping a `defineConfig(...)` call if
 * present. Returns undefined for any shape we don't recognize.
 */
function findDefaultExportObjectLiteral(
  sourceFile: ts.SourceFile
): ts.ObjectLiteralExpression | undefined {
  let exprNode: ts.Expression | undefined;

  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      exprNode = stmt.expression;
      break;
    }
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isBinaryExpression(stmt.expression) &&
      stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isModuleExportsTarget(stmt.expression.left)
    ) {
      exprNode = stmt.expression.right;
      break;
    }
  }

  if (!exprNode) return undefined;

  if (ts.isCallExpression(exprNode)) {
    const callee = exprNode.expression;
    const calleeName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
        ? callee.name.text
        : undefined;
    if (calleeName === "defineConfig" && exprNode.arguments.length === 1) {
      exprNode = exprNode.arguments[0];
    }
  }

  return ts.isObjectLiteralExpression(exprNode) ? exprNode : undefined;
}

function isModuleExportsTarget(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    node.name.text === "exports"
  );
}

function findProperty(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.PropertyAssignment | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ((ts.isIdentifier(prop.name) && prop.name.text === name) ||
        (ts.isStringLiteral(prop.name) && prop.name.text === name))
    ) {
      return prop;
    }
  }
  return undefined;
}

/** Insert a printed property's text as a new member of `obj`, matching the
 *  indentation of `obj`'s existing first property (or its own indent + 2
 *  spaces, if `obj` is empty). */
function insertProperty(
  s: MagicString,
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  printedPropertyText: string
): void {
  if (obj.properties.length > 0) {
    const indent = getIndentOfNode(sourceFile, obj.properties[0]);
    const lastProp = obj.properties[obj.properties.length - 1];
    s.appendLeft(lastProp.getEnd(), `,\n${indent}${printedPropertyText}`);
  } else {
    const indent = getIndentOfNode(sourceFile, obj) + "  ";
    const openBraceEnd = obj.getStart(sourceFile) + 1;
    s.appendLeft(
      openBraceEnd,
      `\n${indent}${printedPropertyText}\n${getIndentOfNode(sourceFile, obj)}`
    );
  }
}

function getIndentOfNode(sourceFile: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart(sourceFile);
  const lineStart = sourceFile.text.lastIndexOf("\n", start) + 1;
  return sourceFile.text.slice(lineStart, start).match(/^\s*/)?.[0] ?? "";
}

function printProperty(prop: ts.PropertyAssignment, sourceFile: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, prop, sourceFile);
}

// ============================================================================
// Shared node builders
// ============================================================================

function buildSecurityProperty(newPackages: string[]): ts.PropertyAssignment {
  return ts.factory.createPropertyAssignment(
    "security",
    ts.factory.createObjectLiteralExpression([buildAllowedMacroPackagesProperty(newPackages)], true)
  );
}

function buildAllowedMacroPackagesProperty(newPackages: string[]): ts.PropertyAssignment {
  return ts.factory.createPropertyAssignment(
    "allowedMacroPackages",
    ts.factory.createArrayLiteralExpression(
      newPackages.map((p) => ts.factory.createStringLiteral(p)),
      false
    )
  );
}

// ============================================================================
// Case 3: manual snippet
// ============================================================================

function renderSnippet(newPackages: string[]): string {
  const dummySourceFile = ts.createSourceFile("snippet.ts", "", ts.ScriptTarget.Latest);
  return printer.printNode(
    ts.EmitHint.Unspecified,
    buildSecurityProperty(newPackages),
    dummySourceFile
  );
}
