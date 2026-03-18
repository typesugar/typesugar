/**
 * HKT Type Reference Rewriter
 *
 * Rewrites `F<A>` → `Kind<F, A>` where F is a type parameter.
 * Runs before ts.Program creation in VirtualCompilerHost so the type checker
 * never sees the invalid `F<A>` (which would cause TS2315).
 *
 * Uses ts.createSourceFile() only — no Program, no TypeChecker.
 * Works in all environments: IDE, bundlers, tsc + ts-patch.
 */

import * as ts from "typescript";
import MagicString from "magic-string";
import type { RawSourceMap } from "@typesugar/preprocessor";

/**
 * Fast regex heuristic to check if a source file might contain HKT patterns.
 *
 * Returns true if the file could contain `F<A>` where F is a type parameter.
 * May have false positives (triggers AST walk) but MUST NOT have false negatives.
 */
export function hasHKTPatterns(source: string): boolean {
  if (!source.includes("<")) return false;
  // A standalone single uppercase letter followed by `<` is the hallmark of
  // HKT usage: F<A>, M<B>, G<X>, etc. Word boundaries ensure we don't match
  // multi-character identifiers like Array<, Promise<, Set<.
  return /\b[A-Z]\b\s*</.test(source);
}

/**
 * Rewrite HKT type references in a TypeScript source file.
 *
 * Transforms `F<A>` → `Kind<F, A>` where F is a type parameter of an
 * enclosing scope. Handles nested rewrites bottom-up and injects
 * `import type { Kind }` when needed.
 */
export function rewriteHKTTypeReferences(
  source: string,
  fileName: string
): { code: string; map: RawSourceMap | null; changed: boolean } {
  const scriptKind =
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  const targets = new Set<ts.TypeReferenceNode>();
  collectRewriteTargets(sourceFile, targets);

  if (targets.size === 0) {
    return { code: source, map: null, changed: false };
  }

  const roots = findRootTargets(targets);
  const s = new MagicString(source);

  for (const root of roots) {
    const start = root.getStart(sourceFile);
    const end = root.getEnd();
    const replacement = computeReplacementText(root, sourceFile, targets);
    s.overwrite(start, end, replacement);
  }

  if (!hasKindImport(sourceFile)) {
    injectKindImport(s, sourceFile);
  }

  const map = s.generateMap({ hires: true, includeContent: true }) as RawSourceMap;
  return { code: s.toString(), changed: true, map };
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Get type parameter names declared by a node.
 */
function getTypeParameterNames(node: ts.Node): string[] {
  const names: string[] = [];

  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isIndexSignatureDeclaration(node) ||
    ts.isFunctionTypeNode(node) ||
    ts.isConstructorTypeNode(node)
  ) {
    for (const tp of node.typeParameters ?? []) {
      names.push(tp.name.text);
    }
  }

  return names;
}

/**
 * Collect type parameters visible at a given AST node by walking up parent chain.
 */
function collectEnclosingTypeParams(node: ts.Node): Set<string> {
  const params = new Set<string>();
  let current: ts.Node | undefined = node.parent;

  while (current) {
    for (const name of getTypeParameterNames(current)) {
      params.add(name);
    }
    current = current.parent;
  }

  return params;
}

/**
 * Walk the AST and collect all TypeReferenceNodes that should be rewritten.
 *
 * A node is a rewrite target when:
 * 1. It's a TypeReferenceNode with a simple Identifier (not QualifiedName)
 * 2. That identifier matches a type parameter from an enclosing scope
 * 3. It has at least one type argument
 */
function collectRewriteTargets(node: ts.Node, targets: Set<ts.TypeReferenceNode>): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    if (node.typeArguments && node.typeArguments.length > 0) {
      const enclosingParams = collectEnclosingTypeParams(node);
      if (enclosingParams.has(node.typeName.text)) {
        targets.add(node);
      }
    }
  }

  ts.forEachChild(node, (child) => collectRewriteTargets(child, targets));
}

/**
 * Find root targets — targets not nested inside any other target.
 *
 * Only root targets need to be applied to MagicString. Nested targets are
 * handled recursively when computing a root's replacement text.
 */
function findRootTargets(targets: Set<ts.TypeReferenceNode>): ts.TypeReferenceNode[] {
  const roots: ts.TypeReferenceNode[] = [];

  for (const target of targets) {
    let ancestor: ts.Node | undefined = target.parent;
    let hasAncestorTarget = false;

    while (ancestor) {
      if (ts.isTypeReferenceNode(ancestor) && targets.has(ancestor)) {
        hasAncestorTarget = true;
        break;
      }
      ancestor = ancestor.parent;
    }

    if (!hasAncestorTarget) {
      roots.push(target);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Replacement text generation
// ---------------------------------------------------------------------------

/**
 * Compute the full replacement text for a rewrite target, recursively
 * handling any nested targets in its type arguments.
 */
function computeReplacementText(
  target: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  allTargets: Set<ts.TypeReferenceNode>
): string {
  const name = (target.typeName as ts.Identifier).text;
  const args = target.typeArguments!.map((arg) => reconstructNodeText(arg, sourceFile, allTargets));
  return `Kind<${name}, ${args.join(", ")}>`;
}

/**
 * Reconstruct the text of a node, applying HKT rewrites to any targets within it.
 */
function reconstructNodeText(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  allTargets: Set<ts.TypeReferenceNode>
): string {
  if (ts.isTypeReferenceNode(node) && allTargets.has(node)) {
    return computeReplacementText(node, sourceFile, allTargets);
  }

  const descendantTargets = findDescendantTargets(node, allTargets);

  if (descendantTargets.length === 0) {
    return node.getText(sourceFile);
  }

  // Node contains targets but isn't one itself — reconstruct text with
  // substitutions applied right-to-left to preserve position validity.
  const nodeStart = node.getStart(sourceFile);
  const nodeText = sourceFile.text.slice(nodeStart, node.getEnd());

  descendantTargets.sort((a, b) => b.getStart(sourceFile) - a.getStart(sourceFile));

  let result = nodeText;
  for (const desc of descendantTargets) {
    const relStart = desc.getStart(sourceFile) - nodeStart;
    const relEnd = desc.getEnd() - nodeStart;
    const replacement = computeReplacementText(desc, sourceFile, allTargets);
    result = result.slice(0, relStart) + replacement + result.slice(relEnd);
  }

  return result;
}

/**
 * Find descendant targets within a node that are "root-level" relative
 * to the node — i.e., not nested inside another descendant target.
 */
function findDescendantTargets(
  node: ts.Node,
  allTargets: Set<ts.TypeReferenceNode>
): ts.TypeReferenceNode[] {
  const descendants: ts.TypeReferenceNode[] = [];

  function walk(n: ts.Node): void {
    if (n === node) {
      ts.forEachChild(n, walk);
      return;
    }
    if (ts.isTypeReferenceNode(n) && allTargets.has(n)) {
      descendants.push(n);
      return; // nested targets are handled by computeReplacementText
    }
    ts.forEachChild(n, walk);
  }

  walk(node);
  return descendants;
}

// ---------------------------------------------------------------------------
// Import injection
// ---------------------------------------------------------------------------

const KIND_IMPORT_PACKAGES = new Set([
  "@typesugar/type-system",
  "@typesugar/fp",
  "@typesugar",
  "typesugar",
]);

/**
 * Check if the source file already imports `Kind` from a typesugar package.
 */
function hasKindImport(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const moduleSpec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpec)) continue;
    if (!KIND_IMPORT_PACKAGES.has(moduleSpec.text)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    // Namespace import — Kind available as ns.Kind
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      return true;
    }

    // Named imports — check for Kind
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const specifier of clause.namedBindings.elements) {
        if (specifier.name.text === "Kind") return true;
      }
    }
  }

  return false;
}

/**
 * Inject `import type { Kind } from "@typesugar/type-system"` into the file.
 */
function injectKindImport(s: MagicString, sourceFile: ts.SourceFile): void {
  const importLine = 'import type { Kind } from "@typesugar/type-system";';

  // Find the end of the last import declaration
  let lastImportEnd = -1;
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      lastImportEnd = stmt.getEnd();
    }
  }

  if (lastImportEnd >= 0) {
    s.appendLeft(lastImportEnd, "\n" + importLine);
  } else {
    s.prepend(importLine + "\n");
  }
}
