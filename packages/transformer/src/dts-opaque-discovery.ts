/**
 * Consumer-Side @opaque Type Discovery
 *
 * When a TypeSugar consumer imports from a library that publishes @opaque
 * type aliases in its .d.ts files, this module discovers those annotations
 * and auto-registers TypeRewriteEntry entries.
 *
 * The discovery process:
 * 1. For each import in the source file, resolve to the .d.ts file
 * 2. Parse the .d.ts and find type aliases with @opaque JSDoc tags
 * 3. Derive method mappings from companion exported function declarations
 * 4. Register TypeRewriteEntry so the transformer can rewrite method calls
 *
 * This allows library authors to publish zero-cost types that "just work"
 * for TypeSugar consumers without requiring any explicit setup.
 */

import * as ts from "typescript";
import * as path from "path";
import {
  registerTypeRewrite,
  getTypeRewrite,
  type TypeRewriteEntry,
  type ConstructorRewrite,
  type AccessorRewrite,
  hasExportModifier,
} from "@typesugar/core";

// ---------------------------------------------------------------------------
// State — tracks which .d.ts files have already been scanned
// ---------------------------------------------------------------------------

const scannedDtsFiles = new Set<string>();

/**
 * Reset the scanned-files tracker. For testing only.
 */
export function resetDtsDiscovery(): void {
  scannedDtsFiles.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a source file's imports for external .d.ts files containing @opaque
 * type aliases, and auto-register TypeRewriteEntry entries for them.
 *
 * Should be called during the per-file transformer phase, after macro
 * packages are loaded but before the visitor pass.
 *
 * @param sourceFile - The source file being transformed
 * @param program - The TypeScript program
 * @param verbose - Whether to log discovery activity
 */
export function discoverOpaqueTypesFromImports(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  verbose?: boolean
): void {
  const checker = program.getTypeChecker();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const moduleSpecifier = stmt.moduleSpecifier.text;

    // Skip relative imports — those are part of the same project and will
    // have their @opaque macros processed directly by the transformer.
    if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/")) continue;

    // Use the type checker to resolve the module — this respects the program's
    // own module resolution (including custom hosts in tests).
    const moduleSymbol = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    if (!moduleSymbol) continue;

    const declarations = moduleSymbol.getDeclarations();
    if (!declarations || declarations.length === 0) continue;

    const dtsSourceFile = declarations[0].getSourceFile();
    if (!dtsSourceFile.isDeclarationFile) continue;

    // Scan the package entry .d.ts AND every .d.ts it re-exports from (transitively,
    // following only relative re-exports so we stay within the package). Library
    // authors commonly publish an `@opaque` type in a sub-module and only re-export
    // it from the entry (e.g. @typesugar/fp's `index.d.ts` →
    // `export type { Option } from "./data/option.js"`); without following the
    // re-export the type — and its companion functions — would be invisible.
    const packageName = packageNameOf(moduleSpecifier);
    const entryDir = path.dirname(dtsSourceFile.fileName);

    const collected = collectReExportedDtsFiles(dtsSourceFile, program);
    for (const dts of collected) {
      if (scannedDtsFiles.has(dts.fileName)) continue;
      scannedDtsFiles.add(dts.fileName);
      // The companion functions for an @opaque type are co-located with it in the
      // same module. Import them from THAT module's subpath, not the consumer's
      // entry import — a library can't expose same-named companions (Option.map vs
      // Either.map) from one entry, so each lives at its own subpath
      // (e.g. "@typesugar/fp/data/option").
      const subModule = subpathFor(packageName, entryDir, dts.fileName);
      scanDtsForOpaqueTypes(dts, subModule, verbose);
    }
  }
}

/** Bare package name of an import specifier ("@scope/pkg/sub" → "@scope/pkg"). */
function packageNameOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Compute the public subpath for a .d.ts file relative to the resolved entry dir,
 * e.g. entry `.../fp/dist/index.d.ts` + file `.../fp/dist/data/option.d.ts`
 * → "@typesugar/fp/data/option". The entry file itself maps to the bare package name.
 */
function subpathFor(packageName: string, entryDir: string, fileName: string): string {
  const rel = path
    .relative(entryDir, fileName)
    .replace(/\.d\.ts$/, "")
    .replace(/\\/g, "/");
  if (rel === "" || rel === "index" || rel.startsWith("..")) return packageName;
  return `${packageName}/${rel}`;
}

/**
 * Collect a .d.ts file and all .d.ts files reachable from it via *relative*
 * re-export declarations (`export ... from "./x"`, `export * from "./x"`).
 *
 * Relative-only keeps traversal bounded to the package being imported — cross-package
 * re-exports are discovered when the consumer imports that package directly.
 */
function collectReExportedDtsFiles(entry: ts.SourceFile, program: ts.Program): ts.SourceFile[] {
  const out: ts.SourceFile[] = [];
  const seen = new Set<string>();
  const stack: ts.SourceFile[] = [entry];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file.fileName)) continue;
    seen.add(file.fileName);
    if (!file.isDeclarationFile) continue;
    out.push(file);

    for (const stmt of file.statements) {
      if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier) continue;
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      if (!stmt.moduleSpecifier.text.startsWith(".")) continue; // relative only

      // Resolve by file path rather than via the checker: the re-export targets of a
      // dependency's .d.ts are usually NOT loaded into the consumer's program, so
      // checker.getSymbolAtLocation(moduleSpecifier) returns undefined for them.
      const targetFile = resolveRelativeDts(file.fileName, stmt.moduleSpecifier.text, program);
      if (targetFile && !seen.has(targetFile.fileName)) {
        stack.push(targetFile);
      }
    }
  }

  return out;
}

/**
 * Resolve a relative `.js`/extensionless module specifier from `fromFile` to its
 * `.d.ts` SourceFile. Prefers a file already in the program; otherwise parses it
 * from disk (the discovery scan is AST-only, so a checker-less SourceFile is fine).
 */
function resolveRelativeDts(
  fromFile: string,
  specifier: string,
  program: ts.Program
): ts.SourceFile | undefined {
  const dir = path.dirname(fromFile);
  const base = specifier.replace(/\.[cm]?js$/, "");
  const candidates = [`${base}.d.ts`, `${base}.d.mts`, `${base}.d.cts`, `${base}/index.d.ts`];
  for (const candidate of candidates) {
    const resolved = path.resolve(dir, candidate);
    const inProgram = program.getSourceFile(resolved);
    if (inProgram) return inProgram;
    if (ts.sys.fileExists(resolved)) {
      const text = ts.sys.readFile(resolved);
      if (text !== undefined) {
        return ts.createSourceFile(resolved, text, ts.ScriptTarget.Latest, true);
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// .d.ts scanning
// ---------------------------------------------------------------------------

/**
 * Scan a .d.ts file for type aliases annotated with @opaque, and register
 * TypeRewriteEntry entries derived from the annotations and companion
 * function declarations.
 */
function scanDtsForOpaqueTypes(
  dtsFile: ts.SourceFile,
  moduleSpecifier: string,
  verbose?: boolean
): void {
  const fullText = dtsFile.getFullText();

  // Phase 1: Collect @opaque type aliases and all exported functions/constants
  const opaqueTypes: Array<{
    name: string;
    typeParams: string[];
    underlying: string;
  }> = [];
  const exportedFunctions = new Map<string, ts.FunctionDeclaration>();
  const exportedConstants = new Map<string, ts.VariableDeclaration>();

  for (const stmt of dtsFile.statements) {
    // Find @opaque type aliases AND interfaces. Library authors may publish a
    // zero-cost type as either `@opaque type Foo = ...` or `@opaque interface Foo {...}`
    // (e.g. @typesugar/fp's `Option` is an interface so it can declare its dot-syntax
    // method surface for type-checking while erasing to the underlying type).
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
      const tag = extractOpaqueTagFromNode(stmt, fullText);
      if (tag) {
        opaqueTypes.push({
          name: stmt.name.text,
          typeParams: stmt.typeParameters?.map((p) => p.name.text) ?? [],
          underlying: tag,
        });
      }
    }

    // Collect exported function declarations
    if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
      exportedFunctions.set(stmt.name.text, stmt);
    }

    // Collect exported constant declarations
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exportedConstants.set(decl.name.text, decl);
        }
      }
    }
  }

  if (opaqueTypes.length === 0) return;

  if (verbose) {
    console.log(
      `[typesugar] dts-discovery: found ${opaqueTypes.length} @opaque type(s) in ${dtsFile.fileName}: ${opaqueTypes.map((t) => t.name).join(", ")}`
    );
  }

  // Phase 2: For each opaque type, derive methods and constructors
  for (const opaque of opaqueTypes) {
    // Skip if already registered (e.g., from same-project @opaque macro)
    if (getTypeRewrite(opaque.name)) continue;

    const methods = new Map<string, string>();
    const constructors = new Map<string, ConstructorRewrite>();

    for (const [fnName, fnDecl] of exportedFunctions) {
      if (isMethodCandidate(fnDecl, opaque.name, dtsFile)) {
        methods.set(fnName, fnName);
      } else if (isConstructorCandidate(fnName, fnDecl, opaque.name, dtsFile)) {
        if (hasParameters(fnDecl)) {
          constructors.set(fnName, { kind: "identity" });
        }
        // Zero-param functions returning the type are also identity constructors
        // (though this is unusual — constants are more common for nullary cases)
      }
    }

    for (const [constName, constDecl] of exportedConstants) {
      if (isConstantConstructorCandidate(constName, constDecl, opaque.name, dtsFile)) {
        // Determine the constant value from the underlying type.
        // For Option<A> = A | null, None: Option<never> → null
        const value = inferConstantValue(opaque.underlying, constDecl, dtsFile);
        constructors.set(constName, { kind: "constant", value: value ?? "null" });
      }
    }

    const entry: TypeRewriteEntry = {
      typeName: opaque.name,
      underlyingTypeText: opaque.underlying,
      sourceModule: moduleSpecifier,
      methods: methods.size > 0 ? methods : undefined,
      constructors: constructors.size > 0 ? constructors : undefined,
      // Consumer should rewrite — not transparent
      transparent: false,
    };

    registerTypeRewrite(entry);

    if (verbose) {
      console.log(
        `[typesugar] dts-discovery: registered ${opaque.name} (${opaque.underlying}) — ` +
          `${methods.size} methods, ${constructors.size} constructors`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// JSDoc extraction
// ---------------------------------------------------------------------------

/**
 * Extract the @opaque tag value from leading JSDoc comments on a node.
 */
function extractOpaqueTagFromNode(node: ts.Node, fullText: string): string | undefined {
  const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!commentRanges) return undefined;

  for (const range of commentRanges) {
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const comment = fullText.slice(range.pos, range.end);
    const match = /@opaque\s+(.+?)(?:\s*\*\/|\s*\n\s*\*\s*@|\s*$)/m.exec(comment);
    if (match) {
      return match[1].trim().replace(/\s*\*\s*$/, "");
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Method / constructor heuristics
// ---------------------------------------------------------------------------

/**
 * Check if a function's first parameter type references the opaque type name.
 * e.g., `function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B>`
 *       → first param is Option<A> → this is a method for Option
 */
function isMethodCandidate(
  fnDecl: ts.FunctionDeclaration,
  typeName: string,
  sourceFile: ts.SourceFile
): boolean {
  if (!fnDecl.parameters || fnDecl.parameters.length === 0) return false;

  const firstParam = fnDecl.parameters[0];
  if (!firstParam.type) return false;

  const typeText = firstParam.type.getText(sourceFile);
  return typeText === typeName || typeText.startsWith(typeName + "<");
}

/**
 * Check if a function is a constructor candidate: PascalCase name that
 * returns the opaque type and whose first param is NOT the opaque type.
 */
function isConstructorCandidate(
  fnName: string,
  fnDecl: ts.FunctionDeclaration,
  typeName: string,
  sourceFile: ts.SourceFile
): boolean {
  // Must be PascalCase (not camelCase, not ALL_CAPS)
  if (!isPascalCase(fnName)) return false;

  // Return type must reference the opaque type
  if (!fnDecl.type) return false;
  const returnTypeText = fnDecl.type.getText(sourceFile);
  if (!returnTypeText.startsWith(typeName)) return false;

  // First param should NOT be the opaque type (otherwise it's a method, not a constructor)
  if (fnDecl.parameters && fnDecl.parameters.length > 0) {
    const firstParam = fnDecl.parameters[0];
    if (firstParam.type) {
      const firstParamType = firstParam.type.getText(sourceFile);
      if (firstParamType === typeName || firstParamType.startsWith(typeName + "<")) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if an exported constant is a constructor candidate:
 * PascalCase name with a type annotation referencing the opaque type.
 */
function isConstantConstructorCandidate(
  name: string,
  decl: ts.VariableDeclaration,
  typeName: string,
  sourceFile: ts.SourceFile
): boolean {
  if (!isPascalCase(name)) return false;
  if (!decl.type) return false;

  // Must be a reference to the opaque type itself.
  if (!ts.isTypeReferenceNode(decl.type)) {
    // Fall back to the textual check for non-reference type nodes (rare).
    const typeText = decl.type.getText(sourceFile);
    return typeText === typeName;
  }
  const refName = ts.isIdentifier(decl.type.typeName)
    ? decl.type.typeName.text
    : decl.type.typeName.getText(sourceFile);
  if (refName !== typeName) return false;

  // A genuine nullary/zero-cost constructor (e.g. `None: Option<never>`) carries
  // no payload — its type arguments are all `never` (or it has none). A constant
  // that names a real payload type (e.g. `Do: List<{}>` / `Do: Option<{}>` is a
  // regular value, NOT the null representation) must NOT be erased to `null`.
  // This disambiguates `None`/`Empty` from ordinary exported constants whose
  // type happens to be the opaque type.
  const typeArgs = decl.type.typeArguments;
  if (!typeArgs || typeArgs.length === 0) return true;
  return typeArgs.every((arg) => arg.kind === ts.SyntaxKind.NeverKeyword);
}

function isPascalCase(name: string): boolean {
  if (name.length === 0) return false;
  if (name[0] !== name[0].toUpperCase() || name[0] === name[0].toLowerCase()) return false;
  // Reject ALL_CAPS_SNAKE_CASE
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
  return true;
}

function hasParameters(fnDecl: ts.FunctionDeclaration): boolean {
  return (fnDecl.parameters?.length ?? 0) > 0;
}

/**
 * Try to infer what constant value a nullary constructor should erase to,
 * based on the underlying type. For `T | null`, we infer `null`.
 * For `T | undefined`, we infer `undefined`.
 */
function inferConstantValue(
  underlyingType: string,
  _decl: ts.VariableDeclaration,
  _sourceFile: ts.SourceFile
): string | undefined {
  // Common patterns
  if (underlyingType.includes("| null")) return "null";
  if (underlyingType.includes("| undefined")) return "undefined";
  return undefined;
}
