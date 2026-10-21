/**
 * Keep `@opaque` types in declarations emitted from the expanded program.
 *
 * Declarations come from the EXPANDED program (declarations.ts), where an
 * `@opaque` type is erased: `export const a = Some(3)` expands to `export
 * const a = 3`, and `function mk(n) { return n > 0 ? Some(n) : None }` to one
 * returning `n | null`. Their declarations said `declare const a = 3;` and
 * `mk(n: number): number | null`, not `Option<number>` (annotated
 * declarations were fine: annotations are kept).
 *
 * So before the expanded text is printed for the declaration emit, each
 * exported declaration whose type is INFERRED, and whose inferred type in the
 * source as written involves an `@opaque` type, gets that type as an explicit
 * annotation. Only those: everything else keeps the expanded program's
 * inference (a fluent `match()` is `any` as written and its real type only
 * after expansion). The annotation is AST, from the checker's node builder
 * (`typeToTypeNode`), on the copy that is printed for the declarations; the
 * JavaScript is untouched.
 *
 * Which types are `@opaque` is decided by identity: the type's own (alias)
 * symbol and its declaring file must match a registered type rewrite, as the
 * erasure itself decides (never by printed name).
 */

import * as ts from "typescript";
import {
  getAllTypeRewrites,
  isSyntheticNode,
  typeRewriteEntryCoversFile,
  type TypeRewriteEntry,
} from "@typesugar/core";

const NODE_BUILDER_FLAGS =
  ts.NodeBuilderFlags.NoTruncation |
  ts.NodeBuilderFlags.UseStructuralFallback |
  ts.NodeBuilderFlags.GenerateNamesForShadowedTypeParams |
  ts.NodeBuilderFlags.AllowEmptyTuple;

/**
 * `expanded` (the macro transformer's output for `original`, a file of
 * `program`) with source-inferred `@opaque` types annotated on its exported
 * declarations. Returns `expanded` itself when there is nothing to annotate.
 */
export function annotateInferredOpaqueTypes(
  program: ts.Program,
  original: ts.SourceFile,
  expanded: ts.SourceFile
): ts.SourceFile {
  const rewrites = getAllTypeRewrites();
  if (rewrites.length === 0 || original.isDeclarationFile) return expanded;
  const checker = program.getTypeChecker();
  const exported = exportedDeclarations(checker, original);
  if (exported.size === 0) return expanded;
  const annotator = new Annotator(program, checker, original, rewrites);
  const factory = ts.factory;

  /** The parse-tree node `node` was made from, if it is one of this file's exported declarations. */
  const sourceOf = <T extends ts.Node>(node: T): T | undefined => {
    const parsed = ts.getParseTreeNode(node) as T | undefined;
    return parsed && !isSyntheticNode(parsed) && parsed.getSourceFile() === original
      ? parsed
      : undefined;
  };

  let changed = false;
  const statements = expanded.statements.map((stmt): ts.Statement => {
    if (ts.isVariableStatement(stmt)) {
      let declChanged = false;
      const declarations = stmt.declarationList.declarations.map((decl) => {
        const source = sourceOf(decl);
        if (decl.type || !source || !exported.has(source) || !ts.isIdentifier(source.name)) {
          return decl;
        }
        const type = annotator.typeFor(() => checker.getTypeAtLocation(source.name), source);
        if (!type) return decl;
        declChanged = true;
        return factory.updateVariableDeclaration(
          decl,
          decl.name,
          decl.exclamationToken,
          type,
          decl.initializer
        );
      });
      if (!declChanged) return stmt;
      changed = true;
      return factory.updateVariableStatement(
        stmt,
        stmt.modifiers,
        factory.updateVariableDeclarationList(stmt.declarationList, declarations)
      );
    }
    if (ts.isFunctionDeclaration(stmt)) {
      const source = sourceOf(stmt);
      if (stmt.type || !stmt.body || !source || !exported.has(source)) return stmt;
      const type = annotator.returnTypeFor(source);
      if (!type) return stmt;
      changed = true;
      return factory.updateFunctionDeclaration(
        stmt,
        stmt.modifiers,
        stmt.asteriskToken,
        stmt.name,
        stmt.typeParameters,
        stmt.parameters,
        type,
        stmt.body
      );
    }
    if (ts.isClassDeclaration(stmt)) {
      const source = sourceOf(stmt);
      if (!source || !exported.has(source)) return stmt;
      let membersChanged = false;
      const members = stmt.members.map((member) => {
        const updated = annotateMember(member, sourceOf(member), annotator, checker);
        if (updated !== member) membersChanged = true;
        return updated;
      });
      if (!membersChanged) return stmt;
      changed = true;
      return factory.updateClassDeclaration(
        stmt,
        stmt.modifiers,
        stmt.name,
        stmt.typeParameters,
        stmt.heritageClauses,
        members
      );
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const source = sourceOf(stmt);
      if (!source) return stmt;
      const type = annotator.typeFor(() => checker.getTypeAtLocation(source.expression), source);
      if (!type) return stmt;
      changed = true;
      // `export default <expr>` declares `_default` with the expression's type.
      return factory.updateExportAssignment(
        stmt,
        stmt.modifiers,
        factory.createAsExpression(factory.createParenthesizedExpression(stmt.expression), type)
      );
    }
    return stmt;
  });
  return changed ? factory.updateSourceFile(expanded, statements) : expanded;
}

/** A public class member with an inferred type, annotated. */
function annotateMember(
  member: ts.ClassElement,
  source: ts.ClassElement | undefined,
  annotator: Annotator,
  checker: ts.TypeChecker
): ts.ClassElement {
  if (!source) return member;
  const modifiers = ts.getCombinedModifierFlags(source as ts.Declaration);
  if (
    modifiers & ts.ModifierFlags.Private ||
    (source.name && ts.isPrivateIdentifier(source.name))
  ) {
    return member;
  }
  const factory = ts.factory;
  if (ts.isMethodDeclaration(member) && ts.isMethodDeclaration(source) && !member.type) {
    const type = member.body ? annotator.returnTypeFor(source) : undefined;
    if (!type) return member;
    return factory.updateMethodDeclaration(
      member,
      member.modifiers,
      member.asteriskToken,
      member.name,
      member.questionToken,
      member.typeParameters,
      member.parameters,
      type,
      member.body
    );
  }
  if (ts.isGetAccessorDeclaration(member) && ts.isGetAccessorDeclaration(source) && !member.type) {
    const type = annotator.returnTypeFor(source);
    if (!type) return member;
    return factory.updateGetAccessorDeclaration(
      member,
      member.modifiers,
      member.name,
      member.parameters,
      type,
      member.body
    );
  }
  if (ts.isPropertyDeclaration(member) && ts.isPropertyDeclaration(source) && !member.type) {
    const type = annotator.typeFor(() => checker.getTypeAtLocation(source.name), source);
    if (!type) return member;
    return factory.updatePropertyDeclaration(
      member,
      member.modifiers,
      member.name,
      member.questionToken ?? member.exclamationToken,
      type,
      member.initializer
    );
  }
  return member;
}

/**
 * The declarations `file` exports (directly, or by a local `export { x }`):
 * the declaration emit only writes those, so only those are annotated.
 */
function exportedDeclarations(checker: ts.TypeChecker, file: ts.SourceFile): Set<ts.Node> {
  const out = new Set<ts.Node>();
  let moduleSymbol: ts.Symbol | undefined;
  try {
    moduleSymbol = checker.getSymbolAtLocation(file);
  } catch {
    return out;
  }
  if (!moduleSymbol) return out;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    for (const decl of symbol.declarations ?? []) {
      if (decl.getSourceFile() === file) out.add(decl);
    }
  }
  // `export default <expr>`
  for (const stmt of file.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) out.add(stmt);
  }
  return out;
}

class Annotator {
  constructor(
    private readonly program: ts.Program,
    private readonly checker: ts.TypeChecker,
    private readonly file: ts.SourceFile,
    private readonly rewrites: readonly TypeRewriteEntry[]
  ) {}

  /** The return type of a function-like `source`, as a type node, when it involves an @opaque type. */
  returnTypeFor(source: ts.SignatureDeclaration): ts.TypeNode | undefined {
    return this.typeFor(() => {
      const signature = this.checker.getSignatureFromDeclaration(source);
      return signature ? this.checker.getReturnTypeOfSignature(signature) : undefined;
    }, source);
  }

  /**
   * `getType()` as a type node valid in `enclosing`'s file, when it involves
   * an @opaque type; undefined otherwise, or when it can't be written there.
   */
  typeFor(getType: () => ts.Type | undefined, enclosing: ts.Node): ts.TypeNode | undefined {
    try {
      const type = getType();
      if (!type || !this.involvesOpaque(type, 0, new Set())) return undefined;
      const node = this.checker.typeToTypeNode(type, enclosing, NODE_BUILDER_FLAGS);
      return node ? this.portable(node) : undefined;
    } catch (e) {
      // Degrade to the expanded program's own inference, visibly.
      console.warn(
        `[typesugar] declarations: kept the expanded type of a declaration in ${this.file.fileName}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return undefined;
    }
  }

  /** Is `type`, or a type it is built from, a registered @opaque type (by identity)? */
  private involvesOpaque(type: ts.Type, depth: number, seen: Set<ts.Type>): boolean {
    if (depth > 6 || seen.has(type)) return false;
    seen.add(type);
    if (this.isOpaque(type)) return true;
    const next = (t: ts.Type) => this.involvesOpaque(t, depth + 1, seen);
    if (type.isUnionOrIntersection()) return type.types.some(next);
    if (type.aliasTypeArguments?.some(next)) return true;
    if (type.flags & ts.TypeFlags.Object) {
      const object = type as ts.ObjectType;
      if (object.objectFlags & ts.ObjectFlags.Reference) {
        if (this.checker.getTypeArguments(type as ts.TypeReference).some(next)) return true;
      }
      for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        if (next(this.checker.getReturnTypeOfSignature(signature))) return true;
      }
      if (object.objectFlags & ts.ObjectFlags.Anonymous) {
        for (const property of type.getProperties().slice(0, 50)) {
          const declaration = property.valueDeclaration ?? property.declarations?.[0];
          if (!declaration) continue;
          if (next(this.checker.getTypeOfSymbolAtLocation(property, declaration))) return true;
        }
      }
    }
    return false;
  }

  private isOpaque(type: ts.Type): boolean {
    for (const symbol of [type.aliasSymbol, type.getSymbol()]) {
      if (!symbol) continue;
      const files = (symbol.declarations ?? []).map((d) => d.getSourceFile().fileName);
      if (
        this.rewrites.some(
          (entry) =>
            entry.typeName === symbol.getName() &&
            files.some((f) => typeRewriteEntryCoversFile(f, entry))
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * The node builder writes a type this file doesn't import as
   * `import("/abs/path/to/module").Name`. Rewrite each to a specifier this
   * file can use: one of its own imports that exports the same symbol (by
   * identity), or a relative path to a source file of the program. Undefined
   * when some such type has neither (the declaration keeps the expanded
   * program's inference).
   */
  private portable(node: ts.TypeNode): ts.TypeNode | undefined {
    let failed = false;
    const visit = (n: ts.Node): ts.Node => {
      if (
        ts.isImportTypeNode(n) &&
        ts.isLiteralTypeNode(n.argument) &&
        ts.isStringLiteral(n.argument.literal) &&
        isAbsolutePath(n.argument.literal.text)
      ) {
        const replacement = this.importTypeFromFile(n);
        if (!replacement) failed = true;
        return replacement ?? n;
      }
      return ts.visitEachChild(n, visit, undefined);
    };
    const result = ts.visitNode(node, visit) as ts.TypeNode;
    return failed ? undefined : result;
  }

  private importTypeFromFile(node: ts.ImportTypeNode): ts.ImportTypeNode | undefined {
    const qualifier = node.qualifier;
    if (!qualifier) return undefined;
    const first = ts.isIdentifier(qualifier) ? qualifier : leftmost(qualifier);
    const target = this.symbolExportedBy(
      (node.argument as ts.LiteralTypeNode).literal as ts.StringLiteral,
      first.text
    );
    if (!target) return undefined;
    const specifier = this.specifierFor(target);
    if (!specifier) return undefined;
    const factory = ts.factory;
    const renamed =
      specifier.name === first.text
        ? qualifier
        : replaceLeftmost(qualifier, factory.createIdentifier(specifier.name));
    return factory.updateImportTypeNode(
      node,
      factory.createLiteralTypeNode(factory.createStringLiteral(specifier.module)),
      node.attributes,
      renamed,
      node.typeArguments,
      node.isTypeOf
    );
  }

  /** The symbol module `path` (absolute, no extension) exports as `name`, aliases followed. */
  private symbolExportedBy(path: ts.StringLiteral, name: string): ts.Symbol | undefined {
    const wanted = stripExtension(path.text);
    const file = this.program
      .getSourceFiles()
      .find((f) => stripExtension(f.fileName) === wanted || f.fileName === path.text);
    if (!file) return undefined;
    const moduleSymbol = this.checker.getSymbolAtLocation(file);
    if (!moduleSymbol) return undefined;
    const exported = this.checker.getExportsOfModule(moduleSymbol).find((s) => s.name === name);
    return exported ? this.resolve(exported) : undefined;
  }

  private resolve(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
  }

  /** How this file can name `target`: one of its imports' modules that exports it, or a relative path. */
  private specifierFor(target: ts.Symbol): { module: string; name: string } | undefined {
    for (const stmt of this.file.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const moduleSymbol = this.checker.getSymbolAtLocation(stmt.moduleSpecifier);
      if (!moduleSymbol) continue;
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        if (this.resolve(exported) === target) {
          return { module: stmt.moduleSpecifier.text, name: exported.name };
        }
      }
    }
    // A source file of this program: a relative path, in this file's style.
    const declarationFile = target.declarations?.[0]?.getSourceFile();
    if (
      !declarationFile ||
      declarationFile.isDeclarationFile ||
      this.program.isSourceFileFromExternalLibrary(declarationFile)
    ) {
      return undefined;
    }
    const moduleSymbol = this.checker.getSymbolAtLocation(declarationFile);
    const exported = moduleSymbol
      ? this.checker.getExportsOfModule(moduleSymbol).find((s) => this.resolve(s) === target)
      : undefined;
    if (!exported) return undefined;
    return {
      module: relativeSpecifier(this.file, declarationFile.fileName, this.program),
      name: exported.name,
    };
  }
}

function leftmost(name: ts.EntityName): ts.Identifier {
  return ts.isIdentifier(name) ? name : leftmost(name.left);
}

function replaceLeftmost(name: ts.EntityName, id: ts.Identifier): ts.EntityName {
  return ts.isIdentifier(name)
    ? id
    : ts.factory.createQualifiedName(replaceLeftmost(name.left, id), name.right);
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p);
}

function stripExtension(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\.d\.[cm]?ts$/, "")
    .replace(/\.[cm]?[jt]sx?$/, "");
}

/** `./x.js` / `../x` from `from` to `to`, with the extension style of `from`'s relative imports. */
function relativeSpecifier(from: ts.SourceFile, to: string, program: ts.Program): string {
  let style: string | undefined;
  for (const stmt of from.statements) {
    if (
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text.startsWith(".")
    ) {
      const text = stmt.moduleSpecifier.text;
      style = /\.[cm]?js$/.test(text) ? ".js" : /\.[cm]?tsx?$/.test(text) ? ".ts" : "";
      break;
    }
  }
  const resolution = program.getCompilerOptions().moduleResolution;
  const nodeEsm =
    resolution === ts.ModuleResolutionKind.Node16 ||
    resolution === ts.ModuleResolutionKind.NodeNext;
  const fromDir = stripExtension(from.fileName).split("/").slice(0, -1);
  const target = stripExtension(to).split("/");
  let common = 0;
  while (
    common < fromDir.length &&
    common < target.length - 1 &&
    fromDir[common] === target[common]
  ) {
    common++;
  }
  const up = fromDir.length - common;
  const relative = (up === 0 ? "./" : "../".repeat(up)) + target.slice(common).join("/");
  return relative + (style ?? (nodeEsm ? ".js" : ""));
}
