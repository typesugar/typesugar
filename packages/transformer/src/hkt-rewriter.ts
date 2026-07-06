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
import type { RawSourceMap } from "@typesugar/core";

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
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

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

  // `ts.visitEachChild` requires a real `ts.TransformationContext` — obtained
  // the same way `packages/macros/src/hkt.test.ts`'s `withMacroContext` does,
  // via a throwaway `ts.transform` pass, rather than the internal
  // (unexported-in-typings) `ts.nullTransformationContext`.
  ts.transform(sourceFile, [
    (context) => {
      for (const root of roots) {
        const start = root.getStart(sourceFile);
        const end = root.getEnd();
        const replacementNode = buildReplacementNode(root, targets, context);
        const replacement = printer.printNode(ts.EmitHint.Unspecified, replacementNode, sourceFile);
        s.overwrite(start, end, replacement);
      }
      return (sf) => sf;
    },
  ]);

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
// Replacement node construction
// ---------------------------------------------------------------------------
//
// PEP-057 follow-up: this used to reconstruct replacement text by hand —
// `node.getText(sourceFile)` slices stitched together with a manual
// `` `Kind<${name}, ${args.join(", ")}>` `` template. Since real
// `ts.TypeNode`s are already in hand at this point (this file's whole job is
// to find `TypeReferenceNode`s, not to patch unparseable input — that's
// `arrow-comprehension-preprocess.ts`'s job, a genuine exception since no
// valid tree exists there to build from), the replacement is built with
// `ts.factory` + `ts.visitEachChild` instead, reusing the real matched
// argument nodes rather than re-deriving their text (the `TransformationContext`
// `visitEachChild` requires comes from a throwaway `ts.transform` pass — see
// `rewriteHKTTypeReferences` below — the same pattern this repo's own
// `packages/macros/src/hkt.test.ts` uses to get a real context outside the
// main compile pipeline). The outer `MagicString` patch (splicing the
// printed replacement into the original file's text) is still required —
// this runs before `ts.Program` creation specifically so the checker never
// sees the invalid `F<A>` syntax, and the result must be source text to feed
// into the normal `ts.createProgram` file-read path.

const printer = ts.createPrinter({ removeComments: true });

/**
 * Build the `Kind<F, ...args>` replacement node for a rewrite target,
 * recursively rewriting any nested targets within its type arguments.
 */
function buildReplacementNode(
  target: ts.TypeReferenceNode,
  allTargets: Set<ts.TypeReferenceNode>,
  context: ts.TransformationContext
): ts.TypeReferenceNode {
  const name = (target.typeName as ts.Identifier).text;
  const args = target.typeArguments!.map((arg) => rewriteNestedTargets(arg, allTargets, context));
  return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Kind"), [
    ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(name), undefined),
    ...args,
  ]);
}

/**
 * Walk a node's descendants, replacing any nested rewrite target with its
 * `Kind<...>` form and reusing every other real node as-is (no text
 * reconstruction) — the standard `ts.factory`/`visitEachChild` visitor shape.
 */
function rewriteNestedTargets<T extends ts.Node>(
  node: T,
  allTargets: Set<ts.TypeReferenceNode>,
  context: ts.TransformationContext
): T {
  if (ts.isTypeReferenceNode(node) && allTargets.has(node)) {
    return buildReplacementNode(node, allTargets, context) as unknown as T;
  }
  return ts.visitEachChild(
    node,
    (child) => rewriteNestedTargets(child, allTargets, context),
    context
  );
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
