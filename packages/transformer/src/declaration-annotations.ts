/**
 * Keep `@opaque` types, and the types of inlined calls, in declarations
 * emitted from the expanded program.
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
 *
 * The same goes for a declaration whose initializer (or a function's body)
 * contains a call the pass inlined or specialized (transformer-core's
 * `isInlinedCallSite`, live state the inliner wrote for this file): the
 * inlined body can be typed more precisely than the call (`mapArr.map([1,
 * 2], f)`, `unknown` as written, is `number[]` once inlined), and the
 * declaration then said a type the source never declares (review 8). It gets
 * the source's type, unless that is `any` (then the expansion's inference is
 * kept, as for a fluent `match()`).
 *
 * An annotation is only added when every name it uses can be written at the
 * declaration (`nameableAt`): a local class (`function loc() { class L {...}
 * return new L() }`) or a class expression's own `typeof Cls` would make the
 * declaration invalid where the expansion's inference was fine (review 9), so
 * such a declaration keeps that inference.
 */

import * as ts from "typescript";
import {
  everyTypeNodeName,
  getAllTypeRewrites,
  isSyntheticNode,
  typeRewriteEntryCoversFile,
  typeToPortableTypeNode,
  type TypeRewriteEntry,
} from "@typesugar/core";
import { hasInlinedCallSites, isInlinedCallSite } from "@typesugar/transformer-core";

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
  if (original.isDeclarationFile) return expanded;
  if (rewrites.length === 0 && !hasInlinedCallSites(original)) return expanded;
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
        const type = annotator.typeFor(
          () => checker.getTypeAtLocation(source.name),
          source,
          containsInlinedCall(source.initializer)
        );
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
      const type = annotator.returnTypeFor(source, containsInlinedCall(source.body));
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
      const type = annotator.typeFor(
        () => checker.getTypeAtLocation(source.expression),
        source,
        containsInlinedCall(source.expression)
      );
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
    const type = member.body
      ? annotator.returnTypeFor(source, containsInlinedCall(source.body))
      : undefined;
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
    const type = annotator.returnTypeFor(source, containsInlinedCall(source.body));
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
    const type = annotator.typeFor(
      () => checker.getTypeAtLocation(source.name),
      source,
      containsInlinedCall(source.initializer)
    );
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

/** Does the source subtree `node` contain a call this pass inlined or specialized? */
function containsInlinedCall(node: ts.Node | undefined): boolean {
  if (!node) return false;
  if (isInlinedCallSite(node)) return true;
  return ts.forEachChild(node, (child) => containsInlinedCall(child) || undefined) ?? false;
}

class Annotator {
  constructor(
    private readonly program: ts.Program,
    private readonly checker: ts.TypeChecker,
    private readonly file: ts.SourceFile,
    private readonly rewrites: readonly TypeRewriteEntry[]
  ) {}

  /**
   * The return type of a function-like `source`, as a type node, when it
   * involves an @opaque type or (`inlined`) its body has an inlined call.
   */
  returnTypeFor(source: ts.SignatureDeclaration, inlined: boolean): ts.TypeNode | undefined {
    return this.typeFor(
      () => {
        const signature = this.checker.getSignatureFromDeclaration(source);
        return signature ? this.checker.getReturnTypeOfSignature(signature) : undefined;
      },
      source,
      inlined
    );
  }

  /**
   * `getType()` as a type node valid in `enclosing`'s file, when it involves
   * an @opaque type, or when `inlined` (the declaration contains an inlined
   * call) and it isn't `any`; undefined otherwise, or when it can't be
   * written there.
   */
  typeFor(
    getType: () => ts.Type | undefined,
    enclosing: ts.Node,
    inlined = false
  ): ts.TypeNode | undefined {
    try {
      const type = getType();
      if (!type) return undefined;
      const keep = inlined && !(type.flags & ts.TypeFlags.Any);
      if (!keep && !this.involvesOpaque(type, 0, new Set())) return undefined;
      // Written as this file can name it (core's portable-type-node.ts).
      const node = typeToPortableTypeNode(this.program, this.checker, this.file, type, enclosing);
      return node && nameableAt(this.checker, node, enclosing) ? node : undefined;
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

/**
 * Can every name `node` (a type node from the node builder) uses be written
 * in the annotation of `declaration`, meaning the name, resolved where that
 * annotation is, is the symbol the builder meant?
 *
 * The builder writes a symbol it can't reach from the declaration by its bare
 * name anyway (a class local to a function body is `L`; a class expression's
 * constructor is `typeof Cls`, the variable being declared). Such an
 * annotation is not valid there, so the caller keeps the expansion's own
 * inference instead.
 *
 * Each entity name's leftmost identifier is resolved by the checker
 * (`resolveName`) in the scope the annotation is in: outside a function's
 * body (its own type parameters are in scope, its locals aren't), the class
 * for a member (the class's type parameters), the file for a variable. The
 * result is compared by identity, after alias and export-symbol resolution,
 * with the symbol the builder wrote (`symbol` on the identifiers it creates,
 * an internal property: when it is absent, the name must at least resolve).
 * The declaration's own symbol is never accepted (`const Cls: typeof Cls` is
 * circular). Names the type node binds itself (type parameters of a function
 * type, mapped and `infer` types) are not looked up. `import("…")` types are
 * module-qualified and portable-type-node.ts has made them valid already.
 */
function nameableAt(checker: ts.TypeChecker, node: ts.TypeNode, declaration: ts.Node): boolean {
  const ownTypeParameters = new Map<string, ts.Symbol>();
  const typeParameterHost = ts.isFunctionLike(declaration) ? declaration : undefined;
  for (const tp of typeParameterHost?.typeParameters ?? []) {
    const symbol = checker.getSymbolAtLocation(tp.name);
    if (symbol) ownTypeParameters.set(tp.name.text, symbol);
  }
  // Where the annotation's names resolve: the scope around the declaration
  // (a function's body locals are not in scope in its return type).
  const scope =
    ts.isClassElement(declaration) && ts.isClassLike(declaration.parent)
      ? declaration.parent
      : ts.isVariableDeclaration(declaration)
        ? declaration.parent.parent.parent
        : declaration.parent;
  const selfNames =
    (ts.isVariableDeclaration(declaration) || ts.isClassElement(declaration)) &&
    declaration.name &&
    !ts.isComputedPropertyName(declaration.name)
      ? checker.getSymbolAtLocation(declaration.name)
      : undefined;
  const self = selfNames ? canonical(checker, selfNames) : undefined;

  return everyTypeNodeName(node, (id, meaning) => {
    const resolved =
      ownTypeParameters.get(id.text) ?? checker.resolveName(id.text, scope, meaning, false);
    if (!resolved) return false;
    const actual = canonical(checker, resolved);
    if (self && actual === self) return false;
    const meant = (id as { symbol?: ts.Symbol }).symbol;
    return !meant || canonical(checker, meant) === actual;
  });
}

/** `symbol` with aliases followed and a local symbol mapped to its export. */
function canonical(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  const aliased = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return checker.getExportSymbolOfSymbol(aliased);
}
