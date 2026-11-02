/**
 * A type, as a type node a given file can contain.
 *
 * The checker's node builder (`typeToTypeNode`) names a type the file can't
 * name in scope (it isn't imported there) as `import("/abs/path/to/module").Name`.
 * That absolute path is this machine's, and it doesn't resolve under every
 * module mode, so it is rewritten to a specifier the file can use: one of its
 * own imports that exports the same symbol (compared by identity), or a
 * relative path to a source file of the program. When some such type has
 * neither, there is no node: the caller keeps what it had.
 *
 * Used for the annotations declaration emit adds (transformer's
 * declaration-annotations.ts) and for the declared type a fluent `match()`
 * asserts its scrutinee to (std's match.ts).
 */

import * as ts from "typescript";

/** Flags for a type node that is written into code (not a hover). */
export const PORTABLE_NODE_BUILDER_FLAGS =
  ts.NodeBuilderFlags.NoTruncation |
  ts.NodeBuilderFlags.UseStructuralFallback |
  ts.NodeBuilderFlags.GenerateNamesForShadowedTypeParams |
  ts.NodeBuilderFlags.AllowEmptyTuple;

/**
 * `type` as a type node valid at `enclosing` in `file`, or undefined when the
 * checker can't write it or it names a type `file` has no way to reach.
 * Checker failures propagate: the caller decides how to report them.
 */
export function typeToPortableTypeNode(
  program: ts.Program,
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  type: ts.Type,
  enclosing: ts.Node
): ts.TypeNode | undefined {
  const node = checker.typeToTypeNode(type, enclosing, PORTABLE_NODE_BUILDER_FLAGS);
  return node ? portableTypeNode(program, checker, file, node) : undefined;
}

/**
 * `node` (from the node builder) with every `import("/abs/path")` type
 * rewritten to a specifier `file` can use; undefined when one can't be.
 */
export function portableTypeNode(
  program: ts.Program,
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  node: ts.TypeNode
): ts.TypeNode | undefined {
  const resolver = new SpecifierResolver(program, checker, file);
  let failed = false;
  const visit = (n: ts.Node): ts.Node => {
    if (
      ts.isImportTypeNode(n) &&
      ts.isLiteralTypeNode(n.argument) &&
      ts.isStringLiteral(n.argument.literal) &&
      isAbsolutePath(n.argument.literal.text)
    ) {
      const replacement = resolver.importTypeFromFile(n);
      if (!replacement) failed = true;
      return replacement ?? n;
    }
    return ts.visitEachChild(n, visit, undefined);
  };
  const result = ts.visitNode(node, visit) as ts.TypeNode;
  return failed ? undefined : result;
}

class SpecifierResolver {
  constructor(
    private readonly program: ts.Program,
    private readonly checker: ts.TypeChecker,
    private readonly file: ts.SourceFile
  ) {}

  importTypeFromFile(node: ts.ImportTypeNode): ts.ImportTypeNode | undefined {
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

/** How a file writes its relative imports: `.js`-style, TypeScript extensions, none, or (no relative import) unknown. */
export type RelativeImportStyle = ".js" | ".ts" | "" | undefined;

/** The style of one relative module specifier's extension. */
export function relativeImportStyleOf(specifier: string): Exclude<RelativeImportStyle, undefined> {
  return /\.[cm]?jsx?$/.test(specifier) ? ".js" : /\.[cm]?tsx?$/.test(specifier) ? ".ts" : "";
}

/**
 * The extension to give a relative specifier of the source file `to` (with
 * its extension removed), in a file whose relative imports are written in
 * `style`, as TypeScript's module resolution reads it (review 8: a `.mts`
 * target was written `.js`, which resolves nothing: TS2307 in a type, a
 * missing module at run time):
 *
 * - written with `.js` (or with none under Node16/NodeNext, which needs one):
 *   the output extension, `.ts`/`.tsx` → `.js`, `.mts` → `.mjs`, `.cts` → `.cjs`;
 * - written with TypeScript extensions (`allowImportingTsExtensions` or
 *   `rewriteRelativeImportExtensions`): the file's own extension;
 * - extensionless (bundler resolution): none, except for a `.mts`/`.cts`
 *   (`.mjs`/`.cjs`) target, which extensionless resolution never finds.
 */
export function sourceSpecifierExtension(
  to: string,
  style: RelativeImportStyle,
  options: ts.CompilerOptions
): string {
  const own = /\.[cm]?[jt]sx?$/.exec(to)?.[0] ?? "";
  const output = own.startsWith(".m") ? ".mjs" : own.startsWith(".c") ? ".cjs" : ".js";
  const tsExtensionsAllowed =
    options.allowImportingTsExtensions === true ||
    (options as { rewriteRelativeImportExtensions?: boolean }).rewriteRelativeImportExtensions ===
      true;
  if (style === ".ts" && tsExtensionsAllowed) return own;
  const nodeEsm =
    options.moduleResolution === ts.ModuleResolutionKind.Node16 ||
    options.moduleResolution === ts.ModuleResolutionKind.NodeNext;
  if (style === ".js" || style === ".ts" || (style === undefined && nodeEsm)) return output;
  return output === ".js" ? "" : output;
}

/** `./x.js` / `../x` from `from` to the source file `to` (see `sourceSpecifierExtension`). */
function relativeSpecifier(from: ts.SourceFile, to: string, program: ts.Program): string {
  let style: RelativeImportStyle;
  for (const stmt of from.statements) {
    if (
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text.startsWith(".")
    ) {
      style = relativeImportStyleOf(stmt.moduleSpecifier.text);
      break;
    }
  }
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
  return (
    relative + sourceSpecifierExtension(to.replace(/\\/g, "/"), style, program.getCompilerOptions())
  );
}
