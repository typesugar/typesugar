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
  typeToPortableTypeNode,
  type TypeRewriteEntry,
} from "@typesugar/core";

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
  try {
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (!moduleSymbol) return out;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      for (const decl of symbol.declarations ?? []) {
        if (decl.getSourceFile() === file) out.add(decl);
      }
    }
  } catch (e) {
    // Degrade to the expanded program's own inference, visibly (as typeFor does).
    console.warn(
      `[typesugar] declarations: could not read the exports of ${file.fileName}, so its ` +
        `declarations keep their expanded types: ${e instanceof Error ? e.message : String(e)}`
    );
    return new Set();
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
      // Written as this file can name it (core's portable-type-node.ts).
      return typeToPortableTypeNode(this.program, this.checker, this.file, type, enclosing);
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
}
