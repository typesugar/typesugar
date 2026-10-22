/**
 * Keep the imports that macro-generated code references, in a JavaScript
 * emit through TypeScript (`typesugar build`, watch, ts-patch).
 *
 * TypeScript drops an import binding the ORIGINAL source uses only as a type
 * (import elision). It decides from the checker's view of the original
 * source, so a reference a macro generates does not count:
 *
 *     import { Point } from "geo-lib";   // Point: an interface + its derive companion
 *     const same = p1 === p2;            // → Point.Eq.equals(p1, p2)
 *
 * emitted `Point.Eq.equals(...)` without the import, a ReferenceError at run
 * time. The same went for an instance imported by name and used only through
 * `summon`/`implicit()` (`import { eqPoint } from "./instances"`), and for
 * the user's own call of a value a derive declares (`import { Point }` and
 * `Point(1, 2)`, the `@derive(Destructure)` constructor: the checker saw only
 * the interface, so it counted no value reference).
 *
 * This transformer runs after the macro transformer, in the JavaScript emit
 * only (never in a pass whose output is printed as TypeScript: it drops the
 * bindings TypeScript would drop). For an import declaration with a binding
 * that generated code references and TypeScript would elide, it rebuilds the
 * declaration with exactly the bindings TypeScript would keep plus those. A
 * rebuilt declaration is not elided again (TypeScript leaves declarations a
 * `before` transformer changed alone), so what it keeps is decided here, by
 * TypeScript's own emit resolver.
 *
 * The other way round too: a binding the source uses as a value that the
 * expansion no longer references at all (every use of an imported instance
 * was inlined) is dropped, and a declaration left with none is not emitted,
 * as TypeScript emits an import used only as a type.
 */

import * as ts from "typescript";
import { generatedValueNames, isDerivedValueSymbol } from "@typesugar/macros";

interface EmitResolverLike {
  isReferencedAliasDeclaration(node: ts.Node, checkChildren?: boolean): boolean;
  isValueAliasDeclaration(node: ts.Node): boolean;
}

/** The emit resolver of a `program.emit()` transformation context, if this is one. */
function emitResolverOf(context: ts.TransformationContext): EmitResolverLike | undefined {
  const get = (context as unknown as { getEmitResolver?: () => EmitResolverLike }).getEmitResolver;
  if (typeof get !== "function") return undefined;
  try {
    const resolver = get.call(context);
    return typeof resolver?.isReferencedAliasDeclaration === "function" ? resolver : undefined;
  } catch {
    // `ts.transform()` contexts have no resolver (and no elision to undo).
    return undefined;
  }
}

/**
 * Import-bound names the expanded code references as values: identifiers the
 * macros created (no parse-tree node of their own), and the user's own
 * identifiers that only became values through expansion (a call to the
 * constructor `Point(1, 2)` a `@derive(Destructure)` declares: the checker
 * saw only the interface, so it counted no value reference). Outside type
 * positions, and never a property name or a declaration's own name. A user
 * identifier counts only when it does not resolve to some other declaration
 * (a local that shadows the import).
 */
function expandedValueReferences(
  sourceFile: ts.SourceFile,
  importNames: ReadonlySet<string>,
  checker: ts.TypeChecker | undefined
): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node, parent: ts.Node | undefined): void => {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      if (!importNames.has(node.text) || names.has(node.text)) return;
      if (parent && isNameNotReference(node, parent)) return;
      if (ts.getParseTreeNode(node) !== node || resolvesToImport(node, checker)) {
        names.add(node.text);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, node));
  };
  for (const stmt of sourceFile.statements) visit(stmt, sourceFile);
  return names;
}

/** Does the user's identifier refer to the file's import of that name (or to nothing the checker knows)? */
function resolvesToImport(id: ts.Identifier, checker: ts.TypeChecker | undefined): boolean {
  if (!checker) return false;
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(id);
  } catch {
    return false;
  }
  if (!symbol) return true;
  return (symbol.declarations ?? []).some(
    (d) => ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)
  );
}

function isNameNotReference(id: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(parent)) return parent.name === id;
  if (ts.isQualifiedName(parent)) return parent.right === id;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isPropertySignature(parent)
  ) {
    return parent.name === id;
  }
  if (ts.isBindingElement(parent)) return parent.name === id || parent.propertyName === id;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isModuleDeclaration(parent)
  ) {
    return parent.name === id;
  }
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) {
    return parent.label === id;
  }
  return false;
}

/**
 * The import-bound names (`importNames`) the expanded file still references
 * as values, wherever the reference came from: an identifier outside type
 * positions that is not a property or declaration name, and the local name
 * of an `export { mkP }`. By name, so a local that shadows an import keeps
 * the import too (conservative: it only ever keeps an import TypeScript
 * would have kept).
 */
function remainingValueReferences(
  sourceFile: ts.SourceFile,
  importNames: ReadonlySet<string>
): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node, parent: ts.Node | undefined): void => {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isImportDeclaration(node)) return;
    if (ts.isExportDeclaration(node)) {
      if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const s of node.exportClause.elements) {
          const local = s.propertyName ?? s.name;
          if (ts.isIdentifier(local) && importNames.has(local.text)) names.add(local.text);
        }
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      if (importNames.has(node.text) && !(parent && isNameNotReference(node, parent))) {
        names.add(node.text);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, node));
  };
  for (const stmt of sourceFile.statements) visit(stmt, sourceFile);
  return names;
}

export function keepMacroReferencedImports(
  program?: ts.Program
): ts.TransformerFactory<ts.SourceFile> {
  return (context) => (sourceFile) => {
    // Nothing is elided under verbatimModuleSyntax. A file the macros left
    // unchanged is still looked at: `Point(1, 2)` calls a constructor its
    // import's module declares only once expanded.
    if (context.getCompilerOptions().verbatimModuleSyntax) return sourceFile;
    const resolver = emitResolverOf(context);
    if (!resolver) return sourceFile;
    // The file as written, when the macros changed it: only then can a
    // reference the source has be gone from the expansion.
    const written = ts.getParseTreeNode(sourceFile);
    const original =
      written !== sourceFile && written && ts.isSourceFile(written) ? written : undefined;

    const importNames = new Set<string>();
    for (const stmt of sourceFile.statements) {
      const clause = ts.isImportDeclaration(stmt) ? stmt.importClause : undefined;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) importNames.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) importNames.add(bindings.name.text);
      else if (bindings) for (const el of bindings.elements) importNames.add(el.name.text);
    }
    const checker = program?.getTypeChecker();
    const reExports = checker
      ? keepDerivedReExports(sourceFile.statements, context.factory, resolver, checker)
      : undefined;
    if (reExports) sourceFile = context.factory.updateSourceFile(sourceFile, reExports.statements);
    if (importNames.size === 0) return sourceFile;
    const generated = expandedValueReferences(sourceFile, importNames, checker);
    // `import { Vec } from "./vec"; export { Vec };`: the kept export clause
    // needs its import too.
    for (const name of reExports?.localNames ?? []) {
      if (importNames.has(name)) generated.add(name);
    }
    // The bindings the expansion no longer references. A binding TypeScript
    // keeps that the source references by name and the expansion doesn't, at
    // all, is dropped, as TypeScript drops one the source uses only as a
    // type: every use of an imported instance was inlined (`mkP.make(1)` →
    // `({ x: 1 })`, review 8), and keeping the import would load its module
    // for nothing. Only what the source references by name: a reference
    // TypeScript keeps an import for with no identifier in the tree (JSX's
    // `React`) is in neither scan, so it stays; under emitDecoratorMetadata a
    // type annotation is a run-time reference too, so nothing is dropped.
    // TypeScript's own decision stays the deciding one for the rest: it
    // keeps what it keeps, by its emit resolver.
    let gone: Set<string> | undefined;
    if (original && !context.getCompilerOptions().emitDecoratorMetadata) {
      const remaining = remainingValueReferences(sourceFile, importNames);
      gone = new Set(
        [...remainingValueReferences(original, importNames)].filter((n) => !remaining.has(n))
      );
      if (gone.size === 0) gone = undefined;
    }
    if (generated.size === 0 && !gone) return sourceFile;

    const kept = (node: ts.Node): boolean => resolver.isReferencedAliasDeclaration(node);
    const factory = context.factory;
    let changed = false;
    const statements: ts.Statement[] = [];
    for (const stmt of sourceFile.statements) {
      const rebuilt = rebuildImport(stmt);
      if (rebuilt !== stmt) changed = true;
      if (rebuilt) statements.push(rebuilt);
    }
    return changed ? factory.updateSourceFile(sourceFile, statements) : sourceFile;

    /** `stmt` as emitted: itself (TypeScript decides), rebuilt, or undefined (no binding left). */
    function rebuildImport(stmt: ts.Statement): ts.Statement | undefined {
      if (!ts.isImportDeclaration(stmt)) return stmt;
      // Only declarations TypeScript will still elide: its own, unchanged ones.
      // A side-effect import (no clause) is never touched.
      if (ts.getParseTreeNode(stmt) !== stmt) return stmt;
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) return stmt;
      const bindings = clause.namedBindings;

      const rescued = (name: ts.Identifier, node: ts.Node) =>
        generated.has(name.text) && !kept(node);
      const dead = (name: ts.Identifier, node: ts.Node) =>
        gone !== undefined && gone.has(name.text) && kept(node);
      const differs = (name: ts.Identifier, node: ts.Node) =>
        rescued(name, node) || dead(name, node);
      const needsRebuild =
        (clause.name !== undefined && differs(clause.name, clause)) ||
        (bindings !== undefined &&
          (ts.isNamespaceImport(bindings)
            ? differs(bindings.name, bindings)
            : bindings.elements.some((s) => !s.isTypeOnly && differs(s.name, s))));
      if (!needsRebuild) return stmt;

      const keep = (name: ts.Identifier, node: ts.Node) =>
        (kept(node) || generated.has(name.text)) && !dead(name, node);
      const defaultName = clause.name && keep(clause.name, clause) ? clause.name : undefined;
      let named: ts.NamedImportBindings | undefined;
      if (bindings && ts.isNamespaceImport(bindings)) {
        named = keep(bindings.name, bindings) ? bindings : undefined;
      } else if (bindings) {
        const elements = bindings.elements.filter((s) => !s.isTypeOnly && keep(s.name, s));
        named = elements.length > 0 ? factory.createNamedImports(elements) : undefined;
      }
      // Nothing left: emitted as TypeScript emits an import used only as a
      // type, not at all (a rebuilt declaration is never elided again).
      if (!defaultName && !named) return undefined;
      return factory.updateImportDeclaration(
        stmt,
        stmt.modifiers,
        factory.createImportClause(false, defaultName, named),
        stmt.moduleSpecifier,
        stmt.attributes
      );
    }
  };
}

/**
 * `export { Circle, Point } from "./shapes"`, `export { Vec }`: TypeScript
 * keeps a re-exported name only if it is a value in the source, and the
 * values a derive declares are not, until expansion: `@derive(Destructure)`'s
 * constructors and instances, and the companion `namespace Vec { export const
 * Eq = ... }` that makes an interface with `@derive(Eq)` a value. Keep:
 *
 * - a name the target module's derives declare (`generatedNames`: `Circle`
 *   exists nowhere in the source, so this is the derive's own list of names);
 * - a name that resolves, through any chain of re-exports and imports, to a
 *   type a derive makes a value: by identity, the symbol the checker resolves
 *   the specifier to ({@link isDerivedValueSymbol}).
 *
 * `localNames` are the local bindings a kept `export { Vec }` (no module
 * specifier) refers to, so their imports are kept too.
 */
/**
 * A re-export's check failed, so it is emitted as TypeScript decides alone:
 * a re-export of a value only `@derive` creates may be dropped. Said once,
 * visibly (CLAUDE.md: a degraded expansion leaves a trace).
 */
function warnReExport(stmt: ts.ExportDeclaration, what: string, e: unknown): void {
  console.warn(
    `[typesugar] emit: could not check ${what} in the re-export ` +
      `'${stmt.getText()}' (${stmt.getSourceFile().fileName}): ` +
      `${e instanceof Error ? e.message : String(e)}. It is emitted as TypeScript elides it, ` +
      `which may drop a value a derive creates.`
  );
}

function keepDerivedReExports(
  statements: readonly ts.Statement[],
  factory: ts.NodeFactory,
  resolver: EmitResolverLike,
  checker: ts.TypeChecker
): { statements: ts.Statement[]; localNames: Set<string> } | undefined {
  let changed = false;
  const localNames = new Set<string>();
  const out = statements.map((stmt) => {
    if (!ts.isExportDeclaration(stmt) || stmt.isTypeOnly) return stmt;
    if (ts.getParseTreeNode(stmt) !== stmt) return stmt;
    const clause = stmt.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return stmt;
    let generatedNames: ReadonlySet<string> = new Set();
    if (stmt.moduleSpecifier) {
      try {
        const target = checker
          .getSymbolAtLocation(stmt.moduleSpecifier)
          ?.declarations?.find((d): d is ts.SourceFile => ts.isSourceFile(d));
        if (target && !target.isDeclarationFile) {
          generatedNames = generatedValueNames(checker, target, true);
        }
      } catch (e) {
        warnReExport(stmt, "its module's derived values", e);
        return stmt;
      }
    }
    const isDerived = (s: ts.ExportSpecifier): boolean => {
      const name = s.propertyName ?? s.name;
      if (ts.isIdentifier(name) && generatedNames.has(name.text)) return true;
      try {
        const symbol = checker.getExportSpecifierLocalTargetSymbol(s);
        return symbol !== undefined && isDerivedValueSymbol(checker, symbol);
      } catch (e) {
        warnReExport(stmt, `'${name.text}'`, e);
        return false;
      }
    };
    const kept = (s: ts.ExportSpecifier) => resolver.isValueAliasDeclaration(s);
    const rescued = clause.elements.filter((s) => !s.isTypeOnly && !kept(s) && isDerived(s));
    if (rescued.length === 0) return stmt;
    if (!stmt.moduleSpecifier) {
      for (const s of rescued) {
        const local = s.propertyName ?? s.name;
        if (ts.isIdentifier(local)) localNames.add(local.text);
      }
    }
    changed = true;
    return factory.updateExportDeclaration(
      stmt,
      stmt.modifiers,
      false,
      factory.createNamedExports(
        clause.elements.filter((s) => !s.isTypeOnly && (kept(s) || rescued.includes(s)))
      ),
      stmt.moduleSpecifier,
      stmt.attributes
    );
  });
  return changed ? { statements: out, localNames } : undefined;
}
