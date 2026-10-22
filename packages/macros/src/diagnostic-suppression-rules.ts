/**
 * Built-in diagnostic suppression rules for @typesugar/macros
 *
 * Every rule here is registered by `registerAllDiagnosticSuppressionRules`
 * (diagnostic-suppression-registration.ts, whose
 * `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES` is the complete list, with core's
 * MacroGenerated); each `create*Rule` below documents what it suppresses.
 *
 * (The former NewtypeAssignment rule was removed in 2026-10: since
 * @typesugar/type-system's `UnwrapNewtype` reads a phantom base slot,
 * `wrap<T>()` and the newtype constructors type-check with no suppression.)
 *
 * Every rule must only hide a diagnostic the transformer will actually make
 * valid: an extra red squiggle is far less harmful than a hidden real bug.
 *
 * @see PEP-011 Waves 3-5
 */

import ts from "typescript";
import type {
  DiagnosticSuppressionContext,
  DiagnosticSuppressionRule,
  MacroContext,
  TypeRewriteEntry,
} from "@typesugar/core";
import {
  findStandaloneExtension,
  getAllTypeRewrites,
  typeRewriteEntryCoversFile,
  isDiagnosticSuppressionAuditEnabled,
  isSyntheticNode,
  globalResolutionScope,
  ResolutionScopeTracker,
  scanImportsForScope,
  globalRegistry,
  isJSDocTagAtLineStart,
  deriveTagNames,
  isInOptedOutScope,
} from "@typesugar/core";
import { getTypeclassesForMethod } from "./typeclass.js";
import { getOperatorCandidates, getTypeclassesDeclaringMethod } from "./typeclass-index.js";
import { getOperatorString } from "./operators.js";
import { resolveInstance } from "./instance-resolver.js";
import { findImportedExtensionMatches, type ExtensionImportEnv } from "./extension-imports.js";
import { deriveNamesOf } from "./instance-scanner.js";
import { hasGenericDerivation } from "./auto-derive.js";
import {
  chainBinary,
  isPrimitiveByFlags,
  PRIMITIVE_RESULT_OPERATORS,
  operatorRewriteResult,
  rewrittenOperandType,
  type OperatorChainHooks,
} from "./operator-chain-types.js";

/**
 * Create the ExtensionMethodCall diagnostic suppression rule.
 *
 * Suppresses TS2339 when the "missing" property is actually an extension method
 * that the transformer will rewrite at emit time. Checks both:
 * - The standalone extension registry (from `registerExtensions` / `@extension`)
 * - Import-scoped resolution (any imported function whose name matches and whose
 *   first parameter accepts the receiver type, generic parameters erased to
 *   their constraints as the transformer matches them)
 *
 * Also suppresses TS7006 on an untyped parameter of a callback passed to such
 * a call (`eff.map((x) => x * 2)`), which has no contextual type until the
 * call is rewritten.
 */
export function createExtensionMethodCallRule(): DiagnosticSuppressionRule {
  return {
    name: "ExtensionMethodCall",
    errorCodes: [2339, 7006],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile,
      context?: DiagnosticSuppressionContext
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      if (diagnostic.code === 7006) {
        return isCallbackOfRewrittenCall(diagnostic, checker, sourceFile, context);
      }

      // Extract the property name from the diagnostic message.
      // TS2339 message format: "Property 'X' does not exist on type 'Y'."
      const messageText = flattenMessage(diagnostic.messageText);
      const propertyName = extractPropertyName(messageText);
      if (!propertyName) return false;

      // Find the AST node at the diagnostic position — should be the property name
      // in a property access expression (e.g., the `clamp` in `(42).clamp(...)`)
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;

      // Walk up to the PropertyAccessExpression
      const propAccess = findPropertyAccess(node);
      if (!propAccess) return false;

      // Verify the property name matches what the diagnostic reports
      if (propAccess.name.text !== propertyName) return false;

      return isRewrittenMethodCall(propAccess, checker, sourceFile, context);
    },
  };
}

/**
 * Is `recv.method` (a property the receiver's type lacks) a call the
 * transformer rewrites: a registered or imported extension, or typeclass
 * method sugar?
 */
function isRewrittenMethodCall(
  propAccess: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  context: DiagnosticSuppressionContext | undefined
): boolean {
  const propertyName = propAccess.name.text;
  const receiver = propAccess.expression;
  let receiverType: ts.Type;
  try {
    receiverType = checker.getTypeAtLocation(receiver);
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] ExtensionMethodCall: ${e}`);
    }
    return false;
  }

  const typeName = checker.typeToString(receiverType);

  // 1. Check standalone extension registry (from registerExtensions / @extension)
  if (findInRegistry(propertyName, typeName, receiverType, checker)) {
    return true;
  }

  // 2. Import-scoped resolution: scan imports for a matching function
  if (
    resolveExtensionFromImports(sourceFile, propertyName, receiverType, checker, context?.program)
  ) {
    return true;
  }

  // 3. Typeclass instance method (derived / @instance): e.g. `p.equals(q)` is
  // rewritten by the transformer to `Point.Eq.equals(p, q)`. Suppress the
  // pre-transform TS2339 when the method belongs to a typeclass whose
  // method syntax is active here (as the rewrite requires) and that the
  // receiver's type derives.
  if (
    resolveTypeclassInstanceMethod(
      propertyName,
      typeName,
      receiverType,
      checker,
      sourceFile,
      context?.program
    )
  ) {
    return true;
  }

  // 4. Typeclass instance method over a PRIMITIVE: e.g. `n.equals(m)` for
  // `n: number` is rewritten to `eqNumber.equals(n, m)` when Eq method
  // syntax is active AND an Eq<number> instance is in scope; decided by
  // the same scope resolution the rewrite uses.
  return resolvePrimitiveTypeclassMethod(
    propertyName,
    typeName,
    receiverType,
    checker,
    sourceFile,
    context?.program
  );
}

/**
 * TS7006 ("Parameter implicitly has an 'any' type") on an untyped parameter
 * of a callback passed to a method call the transformer rewrites
 * (`eff.map((x) => x * 2)` with `EffectExt` imported). Before expansion the
 * call is an error (TS2339, suppressed above), so the callback gets no
 * contextual type; after expansion (`EffectExt.map(eff, (x) => x * 2)`) it
 * does. Only when the receiver's type has no such property of its own, so a
 * real method's callback is never affected.
 */
function isCallbackOfRewrittenCall(
  diagnostic: ts.Diagnostic,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  context: DiagnosticSuppressionContext | undefined
): boolean {
  const node = findNodeAtPosition(sourceFile, diagnostic.start!, diagnostic.length ?? 1);
  if (!node || isSyntheticNode(node)) return false;
  const param = ts.isParameter(node) ? node : node.parent;
  if (!param || !ts.isParameter(param) || param.type) return false;
  const fn = param.parent;
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(fn)) return false;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  try {
    const receiverType = checker.getTypeAtLocation(callee.expression);
    const own = checker.getPropertyOfType(
      checker.getApparentType(checker.getNonNullableType(receiverType)),
      callee.name.text
    );
    if (own && !isGlobalAugmentationStubSymbol(own)) return false;
  } catch (e) {
    reportCheckerFailure("ExtensionMethodCall callback", e);
    return false;
  }
  return isRewrittenMethodCall(callee, checker, sourceFile, context);
}

/** Is every declaration of `prop` inside a `declare global { ... }` block (std's stubs)? */
function isGlobalAugmentationStubSymbol(prop: ts.Symbol): boolean {
  const decls = prop.getDeclarations();
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => {
    for (let n: ts.Node | undefined = d.parent; n; n = n.parent) {
      if (ts.isModuleDeclaration(n) && (n.flags & ts.NodeFlags.GlobalAugmentation) !== 0)
        return true;
    }
    return false;
  });
}

/**
 * Check whether `methodName` is a typeclass method the transformer will
 * rewrite for a PRIMITIVE receiver: `n.equals(m)` for `n: number` becomes
 * `eqNumber.equals(n, m)` when Eq method syntax is active in this file AND an
 * `Eq<number>` instance resolves from its scope, the same resolution the
 * rewrite uses (method-sugar.ts: `resolveInstance`, literal receivers widened
 * by the checker). Activation alone isn't enough: with
 * `import "@typesugar/std/syntax/eq"` and no instance in scope the call is
 * left as written, a TypeError at run time, and `typesugar build` used to
 * hide its TS2339 while `typesugar check` reported it. Primitive by the
 * type's flags, not its printed name.
 */
function resolvePrimitiveTypeclassMethod(
  methodName: string,
  _typeName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  program: ts.Program | undefined
): boolean {
  // The rewrite resolves the instance from scope (method-sugar.ts), so this
  // does too: without the program it can't, and suppresses nothing.
  if (!program) return false;
  const candidates = typeclassesForMethod(methodName, program);
  if (!candidates) return false;

  const primitive =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike;
  if (!(receiverType.flags & primitive)) return false;
  const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;

  for (const candidate of candidates) {
    const tcName = candidate.typeclass;
    if (!isMethodSyntaxActive(sourceFile, tcName, program)) continue;
    try {
      // A literal receiver (`(7).equals(7)`) is retried with its base type,
      // widened by the checker, as the rewrite does.
      let r = resolveInstance(ctx, tcName, receiverType);
      const widened = checker.getBaseTypeOfLiteralType(receiverType);
      if (!r && widened !== receiverType) r = resolveInstance(ctx, tcName, widened);
      if (r?.kind === "resolved") return true;
    } catch (e) {
      if (isDiagnosticSuppressionAuditEnabled()) {
        console.error(`[DiagnosticSuppression] resolvePrimitiveTypeclassMethod: ${e}`);
      }
    }
  }
  return false;
}

/**
 * The typeclasses declaring `methodName`. With the program, every
 * `@typeclass` in it (plus the built-in seed), read from the declarations
 * as the rewrite reads them (method-sugar.ts: `getMethodCandidates`): the
 * standard definitions alone missed a typeclass the file defines itself, so
 * its `.show()` was a TS2339 under `typesugar check` although the transform
 * rewrites it. Without the program, the standard definitions.
 */
function typeclassesForMethod(
  methodName: string,
  program: ts.Program | undefined
): Array<{ typeclass: string; method: string }> | undefined {
  if (!program) return getTypeclassesForMethod(methodName);
  const found = getTypeclassesDeclaringMethod(program, methodName);
  return found.length > 0 ? found : undefined;
}

/**
 * Whether `tcName`'s method syntax is active in `sourceFile`, as the rewrite
 * decides it (method-sugar.ts): an activation import, or the typeclass
 * defined in the file. The transformer leaves the method call as written
 * otherwise, so its TS2339 is real.
 */
function isMethodSyntaxActive(
  sourceFile: ts.SourceFile,
  tcName: string,
  program: ts.Program | undefined
): boolean {
  // `typesugar check` filters diagnostics BEFORE it runs the transform, so
  // the global scope may not have this file yet: with the program, the
  // activation is computed the way the transform pass computes it.
  if (program && activatedMethodTypeclasses(program, sourceFile).has(tcName)) return true;
  return (
    globalResolutionScope.isMethodSyntaxActivated(sourceFile.fileName, tcName) ||
    globalResolutionScope.getDefinedTypeclasses(sourceFile.fileName).has(tcName)
  );
}

/** Per-program method-syntax activation, computed the way the transform pass does. */
const methodActivationCache = new WeakMap<ts.Program, Map<string, Set<string>>>();

function activatedMethodTypeclasses(program: ts.Program, sourceFile: ts.SourceFile): Set<string> {
  let perFile = methodActivationCache.get(program);
  if (!perFile) {
    perFile = new Map();
    methodActivationCache.set(program, perFile);
  }
  const cached = perFile.get(sourceFile.fileName);
  if (cached) return cached;
  // A private tracker, as activatedOperatorTypeclasses uses.
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker, program);
  const result = new Set([
    ...tracker.getActivatedMethodSyntax(sourceFile.fileName),
    ...tracker.getDefinedTypeclasses(sourceFile.fileName),
  ]);
  perFile.set(sourceFile.fileName, result);
  return result;
}

/**
 * Check whether `methodName` is a typeclass method that the receiver's type
 * derives — i.e. the transformer will rewrite `recv.methodName(...)` to the
 * companion call `Type.TC.methodName(recv, ...)`.
 *
 * This is decided from the AST (the receiver type's declaration carries a
 * `@derive(...)` decorator or `@derive`/`@deriving` JSDoc tag), NOT from the
 * instance registry: `typesugar check` runs with `noEmit`, so the transformer
 * never runs and the registry is empty at diagnostic-filter time. The annotation
 * is always present in the source, so it is the reliable signal — and it works
 * for both the decorator and JSDoc trigger forms.
 */
function resolveTypeclassInstanceMethod(
  methodName: string,
  _typeName: string,
  receiverType: ts.Type,
  _checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  program: ts.Program | undefined
): boolean {
  const candidates = typeclassesForMethod(methodName, program);
  if (!candidates) return false;
  const candidateNames = new Set(
    candidates.map((c) => c.typeclass).filter((tc) => isMethodSyntaxActive(sourceFile, tc, program))
  );
  if (candidateNames.size === 0) return false;

  const symbol = receiverType.getSymbol() ?? receiverType.aliasSymbol;
  const declarations = symbol?.getDeclarations();
  if (!declarations) return false;

  for (const decl of declarations) {
    for (const derived of deriveNamesFromDeclaration(decl)) {
      if (candidateNames.has(derived)) return true;
    }
  }
  return false;
}

/**
 * Extract the typeclass names a declaration derives, from either trigger form:
 * - decorator: `@derive(Eq, Clone)` (stored in `modifiers` even on interfaces)
 * - JSDoc: `/** @derive(Eq, Clone) *\/` or `@deriving Eq, Clone`
 */
function deriveNamesFromDeclaration(decl: ts.Node): string[] {
  const names: string[] = [];

  const modifiers = (decl as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  if (modifiers) {
    for (const m of modifiers) {
      if (!ts.isDecorator(m)) continue;
      const expr = m.expression;
      if (
        ts.isCallExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        (expr.expression.text === "derive" || expr.expression.text === "deriving")
      ) {
        for (const arg of expr.arguments) {
          if (ts.isIdentifier(arg)) names.push(arg.text);
        }
      }
    }
  }

  for (const tag of ts.getJSDocTags(decl)) {
    const tagName = tag.tagName.text;
    if (tagName !== "derive" && tagName !== "deriving") continue;
    if (!isJSDocTagAtLineStart(tag)) continue;
    // The shared parser: the tag's list only, never prose after it.
    names.push(...deriveTagNames(tag));
  }

  return names;
}

/**
 * Create the DerivedCompanionAccess diagnostic suppression rule.
 *
 * `@derive(Eq)` on `Point` generates a companion `namespace Point { export
 * const Eq = ... }`, and the docs tell users to call it directly
 * (`Point.Eq.equals(a, b)`). Before expansion the companion does not exist,
 * so the pre-transform program reports:
 * - TS2339 "Property 'Eq' does not exist on type 'typeof Point'" for a class;
 * - TS2693 "'Point' only refers to a type" for an interface or type alias.
 *
 * Suppressed only when the receiver resolves (through the checker's symbol
 * for the identifier, following an import alias) to a declaration that
 * derives the accessed typeclass. Which typeclasses a declaration derives is
 * read from its `@derive` decorator / JSDoc tag, as
 * {@link resolveTypeclassInstanceMethod} does (the registry is empty under
 * `typesugar check`). `Point.Ord` on a type that derives only `Eq` stays an
 * error.
 */
export function createDerivedCompanionAccessRule(): DiagnosticSuppressionRule {
  return {
    name: "DerivedCompanionAccess",
    errorCodes: [2339, 2693],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) return false;
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node || !ts.isIdentifier(node)) return false;

      // TS2693 is on the receiver (`Point` in `Point.Eq`), TS2339 on the name.
      // In a type position (`typeof Point.Eq`) the access is a qualified name.
      const access = node.parent;
      if (!access) return false;
      let receiver: ts.Expression | ts.EntityName;
      let accessed: ts.Identifier | ts.PrivateIdentifier;
      if (ts.isPropertyAccessExpression(access)) {
        receiver = access.expression;
        accessed = access.name;
      } else if (ts.isQualifiedName(access) && diagnostic.code === 2693) {
        receiver = access.left;
        accessed = access.right;
      } else {
        return false;
      }
      if (!ts.isIdentifier(receiver)) return false;
      if (diagnostic.code === 2693 ? receiver !== node : accessed !== node) {
        return false;
      }

      let symbol: ts.Symbol | undefined;
      try {
        symbol = declaredSymbolOf(checker, receiver);
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] DerivedCompanionAccess: ${e}`);
        }
        return false;
      }
      const tcName = accessed.text;
      return (symbol?.getDeclarations() ?? []).some((d) =>
        deriveNamesFromDeclaration(d).includes(tcName)
      );
    },
  };
}

/**
 * Create the DerivedDeclarationReference diagnostic suppression rule.
 *
 * A derive that declares values next to the type (`@derive(Destructure)`:
 * the constructor function `Point` or `Circle` and the instance
 * `destructurePoint`) declares them only in the expanded program. Checked as
 * written, the source reports them:
 * - TS2305 / TS2614 / TS2724 "Module has no exported member" on
 *   `import { Circle } from "./shapes"` and `export { Circle } from
 *   "./shapes"` (re-exporting them from an index file made the declaration
 *   emit, which stops on errors in the source, fail);
 * - TS2693 "'Point' only refers to a type" on `Point(1, 2)`, the product's
 *   constructor, which merges with the interface;
 * - TS2304 "Cannot find name" on `Circle(2)` in the file that derives it;
 * - under `verbatimModuleSyntax` / `isolatedModules`, TS1484 ("'Vec' is a
 *   type and must be imported using a type-only import") on `import { Vec }`
 *   and TS1205 ("Re-exporting a type ... requires using 'export type'") on
 *   `export { Vec } from "./vec"`, for a type whose derives make it a value:
 *   its companion (`namespace Vec { export const Eq = ... }`) or a value of
 *   its own name (`@derive(Destructure)`'s constructor). `export type` would
 *   remove the companion from the JavaScript, so the value form is the right
 *   one.
 *
 * Suppressed only for a name the derive itself says it declares (its
 * `generatedNames`, from the same plan its expansion uses) on the declaration
 * the reference resolves to: the module the specifier imports from, the
 * interface the identifier names, or this file's own derived types. TS1484 /
 * TS1205 are decided by identity: the symbol the checker resolves the
 * specifier to, followed through every alias, is a derived type declared in
 * source ({@link isDerivedValueSymbol}).
 */
export function createDerivedDeclarationReferenceRule(): DiagnosticSuppressionRule {
  return {
    name: "DerivedDeclarationReference",
    errorCodes: [1205, 1484, 2304, 2305, 2614, 2693, 2724],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) return false;
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;
      if (diagnostic.code === 1205 || diagnostic.code === 1484) {
        // Reported on the specifier (`Vec as V`), or its only identifier.
        const spec = ts.isIdentifier(node) ? node.parent : node;
        if (!spec || (!ts.isImportSpecifier(spec) && !ts.isExportSpecifier(spec))) return false;
        if (spec.isTypeOnly || isSyntheticNode(spec)) return false;
        try {
          const symbol = ts.isImportSpecifier(spec)
            ? checker.getSymbolAtLocation(spec.name)
            : checker.getExportSpecifierLocalTargetSymbol(spec);
          return symbol !== undefined && isDerivedValueSymbol(checker, symbol);
        } catch (e) {
          reportCheckerFailure("DerivedDeclarationReference", e);
          return false;
        }
      }
      if (!ts.isIdentifier(node)) return false;
      try {
        if (diagnostic.code === 2693) {
          // Resolved by the identifier's own scope (syntax), then asked of
          // the declaration it names.
          const symbol = declaredSymbolOf(checker, node);
          return (symbol?.getDeclarations() ?? []).some(
            (d) => isDerivableDeclaration(d) && namesGeneratedBy(checker, d).includes(node.text)
          );
        }
        if (diagnostic.code === 2304) {
          return generatedValueNames(checker, sourceFile, false).has(node.text);
        }
        const spec = node.parent;
        if (!spec || (!ts.isImportSpecifier(spec) && !ts.isExportSpecifier(spec))) return false;
        const exported = spec.propertyName ?? spec.name;
        if (!ts.isIdentifier(exported)) return false;
        const declaration = ts.isImportSpecifier(spec)
          ? spec.parent.parent.parent
          : spec.parent.parent;
        const moduleSpecifier = declaration.moduleSpecifier;
        if (!moduleSpecifier) return false;
        const target = checker
          .getSymbolAtLocation(moduleSpecifier)
          ?.declarations?.find((d): d is ts.SourceFile => ts.isSourceFile(d));
        // A .d.ts already declares what its derives generated.
        if (!target || target.isDeclarationFile) return false;
        return generatedValueNames(checker, target, true).has(exported.text);
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] DerivedDeclarationReference: ${e}`);
        }
        return false;
      }
    },
  };
}

type DerivableDeclaration = ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration;

function isDerivableDeclaration(node: ts.Node): node is DerivableDeclaration {
  return (
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  );
}

/** The value names the derives on `decl` declare (each derive's `generatedNames`). */
function namesGeneratedBy(checker: ts.TypeChecker, decl: DerivableDeclaration): string[] {
  const names: string[] = [];
  for (const derive of deriveNamesFromDeclaration(decl)) {
    const macro = globalRegistry.getDerive(derive);
    if (macro?.generatedNames) names.push(...macro.generatedNames(checker, decl));
  }
  return names;
}

/**
 * Does a derive on `decl` make the type's own name a value? Either a derive
 * generates its companion (`namespace Vec { export const Eq = ... }`: a
 * typeclass with a GenericDerivation and no derive macro of the same name,
 * the order expandDeriveDecorator tries them in, as the instance scanner
 * decides), or a derive macro declares a value of that name
 * (`@derive(Destructure)`'s constructor `Point`). Which typeclasses is read
 * from the annotation (syntax), as everywhere before expansion.
 */
function ownNameIsDerivedValue(checker: ts.TypeChecker, decl: DerivableDeclaration): boolean {
  const name = decl.name?.text;
  if (!name) return false;
  if (deriveNamesOf(decl).some((tc) => hasGenericDerivation(tc) && !globalRegistry.getDerive(tc))) {
    return true;
  }
  return namesGeneratedBy(checker, decl).includes(name);
}

/**
 * Is `symbol` (an import or export alias is followed to its target) a type
 * that only its derives make a value, so that importing or re-exporting it as
 * a value is right? Decided by identity: the declarations of the symbol the
 * checker resolves, never a name. Only a declaration in source counts: in a
 * `.d.ts` the companion is declared, so the symbol is a value already, and a
 * symbol that is a value already (a class) needs nothing.
 */
export function isDerivedValueSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  let target = symbol;
  if (target.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(target);
  if (target.flags & ts.SymbolFlags.Value) return false;
  return (target.declarations ?? []).some(
    (d) =>
      isDerivableDeclaration(d) &&
      !d.getSourceFile().isDeclarationFile &&
      ownNameIsDerivedValue(checker, d)
  );
}

/**
 * Every value name the derives in `file` declare at its top level (only
 * exported ones if asked), from each derive's `generatedNames`, plus the name
 * of each type a derive gives a companion. For checks and emit steps that see
 * the source before those values exist.
 */
export function generatedValueNames(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  exportedOnly: boolean
): Set<string> {
  const names = new Set<string>();
  for (const stmt of file.statements) {
    if (!isDerivableDeclaration(stmt)) continue;
    if (
      exportedOnly &&
      !ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const name of namesGeneratedBy(checker, stmt)) names.add(name);
    if (stmt.name && ownNameIsDerivedValue(checker, stmt)) names.add(stmt.name.text);
  }
  return names;
}

/**
 * The symbol an identifier in a value position names, following an import
 * alias. A type-only name (an interface used as `Point.Eq`, TS2693) has no
 * value meaning, so it is looked up among the TYPE symbols in scope at that
 * identifier: name resolution of the identifier itself (syntax), not a type
 * compared by name.
 */
function declaredSymbolOf(checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined {
  let symbol =
    checker.getSymbolAtLocation(id) ??
    checker
      .getSymbolsInScope(id, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
      .find((s) => s.name === id.text);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

// ---------------------------------------------------------------------------
// Standalone registry lookup with type widening
// ---------------------------------------------------------------------------

/**
 * Check the standalone extension registry, trying multiple type name forms:
 * 1. Exact type name from typeToString (e.g., "42", "Array<number>")
 * 2. Base type of literal (e.g., "42" → "number", '"hello"' → "string")
 * 3. Generics stripped (e.g., "Array<number>" → "Array")
 */
function findInRegistry(
  propertyName: string,
  typeName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  if (findStandaloneExtension(propertyName, typeName)) {
    return true;
  }

  // Widen literal types: 42 → number, "hello" → string, true → boolean
  try {
    const baseType = checker.getBaseTypeOfLiteralType(receiverType);
    const baseName = checker.typeToString(baseType);
    if (baseName !== typeName && findStandaloneExtension(propertyName, baseName)) {
      return true;
    }
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] findInRegistry: ${e}`);
    }
  }

  // Strip generics: Array<number> → Array
  const strippedName = typeName.replace(/<.*>$/, "");
  if (strippedName !== typeName && findStandaloneExtension(propertyName, strippedName)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

const TS2339_PATTERN = /^Property '([^']+)' does not exist on type /;

function extractPropertyName(message: string): string | undefined {
  const match = TS2339_PATTERN.exec(message);
  return match?.[1];
}

function flattenMessage(messageText: string | ts.DiagnosticMessageChain): string {
  if (typeof messageText === "string") return messageText;
  return messageText.messageText;
}

// ---------------------------------------------------------------------------
// AST navigation
// ---------------------------------------------------------------------------

function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  start: number,
  length: number
): ts.Node | undefined {
  function visit(node: ts.Node): ts.Node | undefined {
    if (node.getStart(sourceFile) <= start && node.getEnd() >= start + length) {
      const child = ts.forEachChild(node, visit);
      return child ?? node;
    }
    return undefined;
  }
  return ts.forEachChild(sourceFile, visit);
}

/**
 * Walk up from a node to find the enclosing PropertyAccessExpression.
 * The diagnostic position is on the property name identifier, so we need
 * to go up to the PropertyAccessExpression to get the receiver.
 */
function findPropertyAccess(node: ts.Node): ts.PropertyAccessExpression | undefined {
  let current: ts.Node | undefined = node;
  // Walk up at most 3 levels (identifier → propAccess or identifier → propAccess.name context)
  for (let i = 0; i < 3 && current; i++) {
    if (ts.isPropertyAccessExpression(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Import-scoped extension resolution: the transformer's own decision
// ---------------------------------------------------------------------------

/**
 * Does an import of this file provide `methodName` for `receiverType`, as the
 * transformer decides it (findImportedExtensionMatches, extension-imports.ts,
 * which its `scanImportsForExtension` calls): unopted module namespaces,
 * default-lib members, `declare global` stubs and typeclass instances for
 * another type are not providers. This rule used to keep its own copy of the
 * provider rules without those checks and suppressed TS2339 on calls the
 * transformer then left as written. The transformer always has the program;
 * without one the shared decision gives its stricter answer.
 */
function resolveExtensionFromImports(
  sourceFile: ts.SourceFile,
  methodName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker,
  program: ts.Program | undefined
): boolean {
  const env: ExtensionImportEnv = {
    checker,
    program,
    sourceFile,
    scope: program ? operatorActivation(program, sourceFile).tracker : scopeOf(sourceFile),
    warn: (_node, message) => reportCheckerFailure("ExtensionMethodCall", message),
  };
  return findImportedExtensionMatches(env, methodName, receiverType).length > 0;
}

// ===========================================================================
// Shared helpers
// ===========================================================================

/** A file's own `"use extension"` / activation scan, for a filter called without a program. */
function scopeOf(sourceFile: ts.SourceFile): ResolutionScopeTracker {
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker);
  return tracker;
}

/** Leave a visible trace when a checker call fails and the rule degrades (CLAUDE.md). */
const reportedCheckerFailures = new Set<string>();
function reportCheckerFailure(where: string, e: unknown): void {
  if (isDiagnosticSuppressionAuditEnabled()) {
    console.error(`[DiagnosticSuppression] ${where}: ${e}`);
    return;
  }
  if (reportedCheckerFailures.has(where)) return;
  reportedCheckerFailures.add(where);
  console.warn(
    `[typesugar] diagnostic suppression (${where}) skipped a diagnostic after a type-checker ` +
      `failure: ${e instanceof Error ? e.message : String(e)}`
  );
}

/**
 * Extract source and target types from an assignment or argument context.
 *
 * Handles:
 * - Variable declarations: `const x: TargetType = sourceExpr`
 * - Assignments: `x = sourceExpr` (where x has a declared type)
 * - Call arguments: `fn(sourceExpr)` where param has TargetType
 */
function extractAssignmentTypes(
  node: ts.Node,
  checker: ts.TypeChecker
): { sourceType: ts.Type; targetType: ts.Type } | undefined {
  // Walk up to find the relevant parent context
  let current: ts.Node | undefined = node;

  for (let i = 0; i < 10 && current; i++) {
    // Variable declaration: const x: T = expr
    if (ts.isVariableDeclaration(current) && current.initializer && current.type) {
      try {
        const targetType = checker.getTypeFromTypeNode(current.type);
        const sourceType = checker.getTypeAtLocation(current.initializer);
        return { sourceType, targetType };
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Variable declaration without explicit type annotation — target inferred
    if (ts.isVariableDeclaration(current) && current.initializer && !current.type) {
      try {
        const targetType = checker.getTypeAtLocation(current.name);
        const sourceType = checker.getTypeAtLocation(current.initializer);
        if (targetType !== sourceType) {
          return { sourceType, targetType };
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Binary expression (assignment): x = expr
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      try {
        const targetType = checker.getTypeAtLocation(current.left);
        const sourceType = checker.getTypeAtLocation(current.right);
        return { sourceType, targetType };
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Call expression argument: fn(expr) — match the argument to its parameter
    if (ts.isCallExpression(current) && current.arguments.length > 0) {
      const argResult = matchCallArgument(current, node, checker);
      if (argResult) return argResult;
    }

    // Return statement: return expr (in a function with declared return type)
    if (ts.isReturnStatement(current) && current.expression) {
      try {
        const sourceType = checker.getTypeAtLocation(current.expression);
        const fn = findEnclosingFunction(current);
        if (fn?.type) {
          const targetType = checker.getTypeFromTypeNode(fn.type);
          return { sourceType, targetType };
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Property assignment in object literal: { key: expr }
    if (ts.isPropertyAssignment(current) && current.initializer) {
      try {
        const contextualType = checker.getContextualType(current.initializer);
        if (contextualType) {
          const sourceType = checker.getTypeAtLocation(current.initializer);
          return { sourceType, targetType: contextualType };
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    current = current.parent;
  }

  return undefined;
}

/**
 * For a call expression, find which argument the diagnostic node corresponds to
 * and return the source (argument) and target (parameter) types.
 */
function matchCallArgument(
  call: ts.CallExpression,
  diagNode: ts.Node,
  checker: ts.TypeChecker
): { sourceType: ts.Type; targetType: ts.Type } | undefined {
  let argIndex = -1;
  for (let i = 0; i < call.arguments.length; i++) {
    const arg = call.arguments[i];
    if (arg === diagNode || isDescendantOf(diagNode, arg)) {
      argIndex = i;
      break;
    }
  }
  if (argIndex < 0) return undefined;

  try {
    const sig = checker.getResolvedSignature(call);
    if (!sig) return undefined;

    const params = sig.getParameters();
    if (argIndex >= params.length) return undefined;

    const paramType = checker.getTypeOfSymbolAtLocation(params[argIndex], call);
    const argType = checker.getTypeAtLocation(call.arguments[argIndex]);
    return { sourceType: argType, targetType: paramType };
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] matchCallArgument: ${e}`);
    }
    return undefined;
  }
}

function isDescendantOf(child: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = child.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function findEnclosingFunction(
  node: ts.Node
): ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

// ===========================================================================
// Rule 2: TypeRewriteAssignment — suppress TS2322/TS2345/TS2355 for @opaque
// ===========================================================================

/**
 * Create the TypeRewriteAssignment diagnostic suppression rule.
 *
 * Suppresses TS2322, TS2345, and TS2355 when one side of an assignment is a
 * type registered in the `typeRewriteRegistry` (populated by `@opaque` in
 * PEP-012) and the other side matches the registered underlying representation.
 *
 * At runtime, an `@opaque` type IS its underlying type — the opaque interface
 * only exists in the type system. So assignments like
 * `const o: Option<number> = nullableValue` are safe when `Option<T>` maps to
 * `T | null`.
 *
 * @see PEP-011 Wave 5
 * @see PEP-012 — Type Macros (`@opaque`)
 */
export function createTypeRewriteAssignmentRule(): DiagnosticSuppressionRule {
  return {
    name: "TypeRewriteAssignment",
    errorCodes: [2322, 2345, 2355],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;

      // TS2355 is special: "A function whose declared type is neither 'void' nor 'any'
      // must return a value." — the diagnostic is on the function declaration, not an
      // assignment. We handle it by checking if the return type is a registered opaque
      // type (the function returns the underlying type implicitly).
      if (diagnostic.code === 2355) {
        return checkReturnTypeRewrite(node, checker);
      }

      // For TS2322/TS2345, extract source and target from the assignment context.
      const types = extractAssignmentTypes(node, checker);
      if (!types) return false;

      const { sourceType, targetType } = types;

      return checkTypeRewriteAssignability(sourceType, targetType, checker);
    },
  };
}

/**
 * Check whether source→target assignment is valid because one side is a
 * registered opaque type and the other matches its underlying representation.
 *
 * The opaque side is identified by its SYMBOL (name + declaring file), the way
 * the transformer's symbol-scoped erasure identifies it (commit c96a5925), not
 * by the `typeToString` text: an unrelated same-named `Option` from another
 * module must not borrow a registered entry. The underlying template is then
 * instantiated with the type's real arguments, matched to the declaration's
 * own type-parameter names (deep-review macros-other #18: a hardcoded
 * `T, U, V, ...` positional list left fp's `Option<A>` unsubstituted).
 */
function checkTypeRewriteAssignability(
  sourceType: ts.Type,
  targetType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  // Case 1: target is an opaque type, source matches its underlying
  const target = resolveTypeRewrite(targetType, checker);
  if (target) {
    for (const st of collectTypeTextVariants(
      sourceType,
      checker.typeToString(sourceType),
      checker
    )) {
      if (matchesRewriteUnderlying(st, target)) return true;
    }
  }

  // Case 2: source is an opaque type, target matches its underlying
  const source = resolveTypeRewrite(sourceType, checker);
  if (source) {
    for (const tt of collectTypeTextVariants(
      targetType,
      checker.typeToString(targetType),
      checker
    )) {
      if (matchesRewriteUnderlying(tt, source)) return true;
    }
  }

  return false;
}

interface ResolvedTypeRewrite {
  entry: TypeRewriteEntry;
  /** `underlyingTypeText` with the type's arguments substituted for its parameters. */
  underlyingText: string;
}

function matchesRewriteUnderlying(candidateText: string, rewrite: ResolvedTypeRewrite): boolean {
  if (rewrite.entry.matchesUnderlying && rewrite.entry.matchesUnderlying(candidateText)) {
    return true;
  }
  return isUnderlyingMatch(candidateText, rewrite.underlyingText);
}

/**
 * Find the type-rewrite entry for `type` by its symbol, and instantiate the
 * entry's underlying template with the type's arguments.
 *
 * An entry with a `declarationFile` (or `sourceModule`) only applies to a
 * symbol declared in that file/module. An entry carrying neither (hand-built
 * registrations) falls back to a name match.
 */
function resolveTypeRewrite(
  type: ts.Type,
  checker: ts.TypeChecker
): ResolvedTypeRewrite | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return undefined;
  const name = symbol.getName();
  const candidates = getAllTypeRewrites().filter((e) => e.typeName === name);
  if (candidates.length === 0) return undefined;

  const declarations = symbol.getDeclarations() ?? [];
  const declFiles = declarations.map((d) => d.getSourceFile().fileName);
  let entry: TypeRewriteEntry | undefined;
  for (let i = candidates.length - 1; i >= 0 && !entry; i--) {
    const c = candidates[i];
    if (
      (c.declarationFile || c.sourceModule) &&
      declFiles.some((f) => typeRewriteEntryCoversFile(f, c))
    ) {
      entry = c;
    }
  }
  for (let i = candidates.length - 1; i >= 0 && !entry; i--) {
    const c = candidates[i];
    if (!c.declarationFile && !c.sourceModule) entry = c;
  }
  if (!entry) return undefined;

  // Type parameters, by name, from the declaration itself.
  let paramNames: string[] = [];
  for (const decl of declarations) {
    if (
      (ts.isInterfaceDeclaration(decl) ||
        ts.isTypeAliasDeclaration(decl) ||
        ts.isClassDeclaration(decl)) &&
      decl.typeParameters
    ) {
      paramNames = decl.typeParameters.map((tp) => tp.name.text);
      break;
    }
  }

  let typeArgs: readonly ts.Type[] = [];
  if (type.aliasSymbol) {
    typeArgs = type.aliasTypeArguments ?? [];
  } else if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    typeArgs = checker.getTypeArguments(type as ts.TypeReference);
  }

  const substitutions = new Map<string, string>();
  for (let i = 0; i < paramNames.length && i < typeArgs.length; i++) {
    substitutions.set(paramNames[i], checker.typeToString(typeArgs[i]));
  }
  return {
    entry,
    underlyingText: substituteTypeParams(entry.underlyingTypeText, substitutions),
  };
}

/**
 * Replace whole-word type-parameter names in a type text, all at once (so
 * `<A, B>` instantiated as `<B, A>` cannot substitute twice). This compares
 * type texts for matching only; no code is generated from the result.
 */
function substituteTypeParams(
  template: string,
  substitutions: ReadonlyMap<string, string>
): string {
  if (substitutions.size === 0) return template;
  const names = [...substitutions.keys()].map((n) => n.replace(/[$]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\w$])(?:${names.join("|")})(?![\\w$])`, "g");
  return template.replace(pattern, (m) => substitutions.get(m) ?? m);
}

/**
 * Collect type name variants for matching: the literal form, the widened
 * base type, and stripped generics.
 */
function collectTypeTextVariants(
  type: ts.Type,
  typeText: string,
  checker: ts.TypeChecker
): string[] {
  const variants = [typeText];

  // Widen literal types: "user@test.com" → string, 42 → number, true → boolean
  try {
    const baseType = checker.getBaseTypeOfLiteralType(type);
    const baseName = checker.typeToString(baseType);
    if (baseName !== typeText && !variants.includes(baseName)) {
      variants.push(baseName);
    }
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] collectTypeTextVariants: ${e}`);
    }
  }

  return variants;
}

/**
 * Check if a type text matches an underlying type text representation.
 *
 * Handles simple cases like exact match and normalized whitespace comparison.
 * For complex cases (union types with different orderings, etc.), the
 * `matchesUnderlying` callback on the registry entry should be used.
 */
function isUnderlyingMatch(candidateText: string, underlyingText: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (norm(candidateText) === norm(underlyingText)) return true;

  // Handle union type ordering: "null | T" vs "T | null"
  const normalizeParts = (s: string) =>
    s
      .split("|")
      .map((p) => p.trim())
      .sort()
      .join(" | ");

  if (normalizeParts(candidateText) === normalizeParts(underlyingText)) return true;

  return false;
}

// ===========================================================================
// Rule 5: MacroDecorator — suppress TS1206 for typesugar decorators on interfaces
// ===========================================================================

/**
 * Known typesugar decorator names that the transformer handles on interfaces,
 * type aliases, and other non-class declarations where TypeScript doesn't
 * normally allow decorators.
 */
const MACRO_DECORATOR_NAMES = new Set([
  "derive",
  "typeclass",
  "service",
  "hkt",
  "adt",
  "opaque",
  "mock",
  "existential",
  "tailrec",
  "contract",
]);

/**
 * Create the MacroDecorator diagnostic suppression rule.
 *
 * Suppresses TS1206 ("Decorators are not valid here") when the decorator is a
 * known typesugar macro. TypeScript doesn't allow decorators on interfaces or
 * type aliases, but the typesugar transformer handles them at compile time.
 */
export function createMacroDecoratorRule(): DiagnosticSuppressionRule {
  return {
    name: "MacroDecorator",
    errorCodes: [1206],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      _checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined) return false;

      // Find the node at the diagnostic position — should be the @ decorator
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node) return false;

      // Walk up to find a decorator
      let current: ts.Node | undefined = node;
      for (let i = 0; i < 5 && current; i++) {
        if (ts.isDecorator(current)) {
          // Extract the decorator name
          const expr = current.expression;
          let name: string | undefined;
          if (ts.isIdentifier(expr)) {
            name = expr.text;
          } else if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
            name = expr.expression.text;
          }
          // A name in the table, or any registered attribute macro
          // (`@reflect` from @typesugar/reflect was missing from the table,
          // so `typesugar check` reported TS1206 on its documented
          // `@reflect interface User`). Which macro a decorator names is
          // syntax, so the name decides.
          if (name && (MACRO_DECORATOR_NAMES.has(name) || globalRegistry.getAttribute(name))) {
            return true;
          }
        }
        current = current.parent;
      }

      return false;
    },
  };
}

// ===========================================================================
// Rule 7: MacroCallChain — suppress errors inside typesugar match() chains
// ===========================================================================

/** "Object is possibly 'null'" and friends (TS2531-2533, TS18047-18049). */
const POSSIBLY_NULLISH_CODES: readonly number[] = [2531, 2532, 2533, 18047, 18048, 18049];

/** The chain methods the `match` macro parses (std/src/macros/match.ts parseArms). */
const MATCH_CHAIN_METHODS = new Set(["case", "or", "as", "if", "then", "else"]);

/**
 * Create the MacroCallChain diagnostic suppression rule.
 *
 * Applies only to a fluent chain rooted at `@typesugar/std`'s `match` (the
 * callee resolved through imports to that package, as the transformer
 * resolves it — deep-review macros-other #17: any function named `match`,
 * including ts-pattern's, used to qualify, and every TS2339/TS2304 within 20
 * parents was hidden). Within such a chain it suppresses:
 *
 * - TS2339 on a chain method itself (`.case`, `.then`, ... on `never`), which
 *   the macro consumes;
 * - TS2304 ("Cannot find name") and TS18004 (shorthand with no value) only for
 *   a name the arm's own pattern binds (`.case({ kind: "circle", r })`,
 *   `.case([p, ...rest])`, `.case(Some(x))`, `.as(name)`), used in that arm's
 *   pattern, `.as`, `.if` or `.then`. The transformer emits `const r = ...`
 *   for exactly those names. Any other unknown name is a real error.
 * - "possibly null/undefined" (TS2531-2533, TS18047-18049) reported on the
 *   receiver of a chain link (`.case` / `.else` / ...). The fluent chain's
 *   stub types (`FluentMatchArms` in match-runtime.ts) keep a nullish arm
 *   result beside the chain rather than inside it, so continuing after
 *   `.then(null)` makes the receiver possibly null to the checker. The macro
 *   consumes the whole chain, so that receiver never exists at run time.
 *   The same error inside an arm's own argument is real and is not touched.
 */
export function createMacroCallChainRule(): DiagnosticSuppressionRule {
  return {
    name: "MacroCallChain",
    errorCodes: [2339, 2304, 18004, ...POSSIBLY_NULLISH_CODES],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined) return false;

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node || isSyntheticNode(node)) return false;

      if (diagnostic.code === 2339) {
        return isMatchChainMethodName(node, checker, sourceFile);
      }

      if (POSSIBLY_NULLISH_CODES.includes(diagnostic.code)) {
        // The span is the receiver expression: `<receiver>.case(...)`.
        const access = node.parent;
        if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== node) {
          return false;
        }
        return isMatchChainMethodName(access.name, checker, sourceFile);
      }

      if (!ts.isIdentifier(node)) return false;
      const name = node.text;

      // Every enclosing chain link whose arguments contain the node, innermost
      // first: a name may be bound by an outer arm and used in a nested match.
      for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if (!ts.isCallExpression(current)) continue;
        if (!current.arguments.some((a) => isWithin(node, a))) continue;
        const chain = flattenMatchChain(current, checker, sourceFile);
        if (!chain) continue;
        if (armBindingsAt(chain.links).has(name)) return true;
      }
      return false;
    },
  };
}

interface MatchChainLink {
  method: string;
  args: readonly ts.Expression[];
}

/**
 * Flatten `match(x).case(p).then(r)...` ending at `call` into its links
 * (outermost-last). Returns `undefined` unless `call` is a chain link (not the
 * root `match(x)` call itself) of a chain rooted at typesugar's `match`.
 */
function flattenMatchChain(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): { links: MatchChainLink[] } | undefined {
  const links: MatchChainLink[] = [];
  let expr: ts.CallExpression = call;
  for (let i = 0; i < 200; i++) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) {
      if (links.length === 0) return undefined; // the root call's own args
      if (!isTypesugarMatch(callee, checker, sourceFile)) return undefined;
      links.reverse();
      return { links };
    }
    if (!ts.isPropertyAccessExpression(callee) || !ts.isCallExpression(callee.expression)) {
      return undefined;
    }
    if (!MATCH_CHAIN_METHODS.has(callee.name.text)) return undefined;
    links.push({ method: callee.name.text, args: expr.arguments });
    expr = callee.expression;
  }
  return undefined;
}

/** Names bound by the arm that the LAST link belongs to. */
function armBindingsAt(links: readonly MatchChainLink[]): Set<string> {
  const names = new Set<string>();
  const last = links[links.length - 1];
  if (last.method === "else") return names;
  // Walk back to the arm's `.case` (an arm is `.case [.or]* [.as] [.if] .then`).
  for (let i = links.length - 1; i >= 0; i--) {
    const link = links[i];
    if (link.method === "then" && i !== links.length - 1) break;
    if (link.method === "case" || link.method === "or" || link.method === "as") {
      for (const arg of link.args.slice(0, 1)) collectPatternBindings(arg, names);
    }
    if (link.method === "case") break;
  }
  return names;
}

/**
 * Syntactically collect the variable names a match pattern binds (mirrors
 * `analyzePattern`/`collectBindings` in std/src/macros/match.ts): bare
 * identifiers, array elements and spreads, object shorthands, property values,
 * and extractor arguments (`Some(x)`), but never an extractor's callee.
 */
function collectPatternBindings(pattern: ts.Expression, out: Set<string>): void {
  if (ts.isIdentifier(pattern)) {
    if (pattern.text !== "_" && pattern.text !== "undefined") out.add(pattern.text);
  } else if (ts.isParenthesizedExpression(pattern)) {
    collectPatternBindings(pattern.expression, out);
  } else if (ts.isArrayLiteralExpression(pattern)) {
    for (const el of pattern.elements) collectPatternBindings(el, out);
  } else if (ts.isSpreadElement(pattern)) {
    collectPatternBindings(pattern.expression, out);
  } else if (ts.isObjectLiteralExpression(pattern)) {
    for (const prop of pattern.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) out.add(prop.name.text);
      else if (ts.isPropertyAssignment(prop)) collectPatternBindings(prop.initializer, out);
      else if (ts.isSpreadAssignment(prop)) collectPatternBindings(prop.expression, out);
    }
  } else if (ts.isCallExpression(pattern)) {
    for (const arg of pattern.arguments) collectPatternBindings(arg, out);
  }
}

/** Is `node` the name of a chain method (`.case`, `.then`, ...) of a typesugar match chain? */
function isMatchChainMethodName(
  node: ts.Node,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  const access = node.parent;
  if (!ts.isIdentifier(node) || !access || !ts.isPropertyAccessExpression(access)) return false;
  if (access.name !== node) return false;
  const call = access.parent;
  if (!call || !ts.isCallExpression(call) || call.expression !== access) return false;
  return flattenMatchChain(call, checker, sourceFile) !== undefined;
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (n === ancestor) return true;
  }
  return false;
}

/** Packages whose `match` export is the typesugar macro (match.ts `module`). */
function isTypesugarMatchModule(spec: string): boolean {
  return spec === "@typesugar/std" || spec.startsWith("@typesugar/std/") || spec === "typesugar";
}

/** The package a declaration file belongs to (mirrors import-resolution.ts resolveModuleSpecifier). */
function packageOfFile(fileName: string): string | undefined {
  const normalized = fileName.replace(/\\/g, "/");
  const nm = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(normalized);
  if (nm) return nm[1];
  const pk = /\/packages\/([a-z0-9-]+)\//.exec(normalized);
  if (pk) return pk[1] === "typesugar" ? "typesugar" : `@typesugar/${pk[1]}`;
  return undefined;
}

/**
 * Does `callee` refer to typesugar's `match` macro? Resolved through import
 * aliases to a declaration in `@typesugar/std` (or the `typesugar` umbrella);
 * when the import cannot be resolved at all, the import specifier decides,
 * as the transformer's name-and-import fallback does. A local or third-party
 * `match` never qualifies.
 */
function isTypesugarMatch(
  callee: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(callee);
  } catch (e) {
    reportCheckerFailure("MacroCallChain", e);
    return false;
  }
  if (!symbol) return false;

  const wasImported = (symbol.flags & ts.SymbolFlags.Alias) !== 0;
  let resolved = symbol;
  if (wasImported) {
    try {
      resolved = checker.getAliasedSymbol(symbol);
    } catch (e) {
      reportCheckerFailure("MacroCallChain", e);
      return false;
    }
  }

  const decls = resolved.getDeclarations() ?? [];
  if (decls.length > 0) {
    if (resolved.getName() !== "match") return false;
    return decls.some((d) => {
      const pkg = packageOfFile(d.getSourceFile().fileName);
      return pkg !== undefined && isTypesugarMatchModule(pkg);
    });
  }

  // Unresolvable import: decide by the import declaration's specifier.
  if (!wasImported) return false;
  const importDecl = symbol.declarations?.[0];
  for (let n: ts.Node | undefined = importDecl; n; n = n.parent) {
    if (ts.isImportDeclaration(n)) {
      if (!ts.isStringLiteral(n.moduleSpecifier)) return false;
      const importedName =
        importDecl && ts.isImportSpecifier(importDecl)
          ? (importDecl.propertyName ?? importDecl.name).text
          : undefined;
      return importedName === "match" && isTypesugarMatchModule(n.moduleSpecifier.text);
    }
  }
  return false;
}

// ===========================================================================
// Rule 8: MatchSwitch — the `match:` statement form (std match-switch.ts)
// ===========================================================================

/** The labeled-block macro behind `match: switch`, as registered by @typesugar/std. */
const MATCH_SWITCH_MACRO = "matchSwitch";

const labelActivationCache = new WeakMap<ts.Program, Map<string, boolean>>();

/** Does `sourceFile` activate `match:` (imports a `@syntax-labels matchSwitch` marker)? */
function matchSwitchActivated(program: ts.Program, sourceFile: ts.SourceFile): boolean {
  let perFile = labelActivationCache.get(program);
  if (!perFile) {
    perFile = new Map();
    labelActivationCache.set(program, perFile);
  }
  const cached = perFile.get(sourceFile.fileName);
  if (cached !== undefined) return cached;
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker, program);
  const result = tracker.isLabelSyntaxActivated(sourceFile.fileName, MATCH_SWITCH_MACRO);
  perFile.set(sourceFile.fileName, result);
  return result;
}

// ===========================================================================
// ContractBlock — contracts' `ensures:` result binding
// ===========================================================================

/** The label macro `@typesugar/contracts/syntax` activates (`@syntax-labels contract`). */
const CONTRACT_LABEL_MACRO = "contract";

function contractLabelsActivated(program: ts.Program, sourceFile: ts.SourceFile): boolean {
  let perFile = contractActivationCache.get(program);
  if (!perFile) {
    perFile = new Map();
    contractActivationCache.set(program, perFile);
  }
  const cached = perFile.get(sourceFile.fileName);
  if (cached !== undefined) return cached;
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker, program);
  const result = tracker.isLabelSyntaxActivated(sourceFile.fileName, CONTRACT_LABEL_MACRO);
  perFile.set(sourceFile.fileName, result);
  return result;
}

const contractActivationCache = new WeakMap<ts.Program, Map<string, boolean>>();

/**
 * The `ensures:` statement `node` is inside, when it is one the contracts
 * macro reads: a labeled statement directly in a function's body
 * (contracts' parseContractBlocks reads only the body's own statements).
 */
function enclosingEnsures(node: ts.Node): ts.LabeledStatement | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isLabeledStatement(n) && n.label.text === "ensures") {
      const block = n.parent;
      return ts.isBlock(block) && block.parent && ts.isFunctionLike(block.parent) ? n : undefined;
    }
    if (ts.isFunctionLike(n) && !ts.isArrowFunction(n)) return undefined;
  }
  return undefined;
}

/**
 * The arrow of the arrow form (`ensures: (r) => ...`, or a lone
 * `ensures: { r => ... }`), as contracts' parseEnsuresBlock reads it.
 */
function ensuresArrow(statement: ts.Statement): ts.ArrowFunction | undefined {
  let stmt = statement;
  if (ts.isBlock(stmt)) {
    const stmts = stmt.statements.filter((s) => !ts.isEmptyStatement(s));
    if (stmts.length === 1) stmt = stmts[0];
  }
  return ts.isExpressionStatement(stmt) && ts.isArrowFunction(stmt.expression)
    ? stmt.expression
    : undefined;
}

/**
 * Create the ContractBlock diagnostic suppression rule.
 *
 * In a file that activates contract labels (`import
 * "@typesugar/contracts/syntax"`), the contracts macro binds the function's
 * return value inside an `ensures:` block, so the checker's view of the
 * unexpanded block has errors the expansion removes:
 *
 * - TS2304 "Cannot find name 'result'" for the implicit `result` of the
 *   block and expression forms (`ensures: { result >= 0; }`). Only that name,
 *   only in such a block: any other unknown name, or `result` elsewhere in
 *   the function, is a real error.
 * - TS7006 "Parameter implicitly has an 'any' type" for the arrow form's
 *   parameter written without a type (`ensures: (result) => { ... }`): the
 *   macro binds it to the return value.
 *
 * Needs the program in the evaluation context (for the activation check);
 * without it nothing is suppressed.
 */
export function createContractBlockRule(): DiagnosticSuppressionRule {
  return {
    name: "ContractBlock",
    errorCodes: [2304, 7006],

    shouldSuppress(diagnostic, _checker, sourceFile, context): boolean {
      if (diagnostic.start === undefined || !context?.program) return false;
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node || isSyntheticNode(node) || !ts.isIdentifier(node)) return false;
      const ensures = enclosingEnsures(node);
      if (!ensures) return false;
      const arrow = ensuresArrow(ensures.statement);
      if (diagnostic.code === 7006) {
        const param = node.parent;
        if (
          !arrow ||
          arrow.parameters.length !== 1 ||
          !ts.isParameter(param) ||
          param !== arrow.parameters[0] ||
          param.name !== node ||
          param.type
        ) {
          return false;
        }
      } else if (arrow || node.text !== "result") {
        return false;
      }
      return contractLabelsActivated(context.program, sourceFile);
    },
  };
}

/** The `match:`-labelled switch `node` is the label of, or a part of. */
function enclosingMatchSwitch(node: ts.Node): ts.LabeledStatement | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isLabeledStatement(n) && n.label.text === "match" && ts.isSwitchStatement(n.statement)) {
      return n;
    }
  }
  return undefined;
}

/**
 * Create the MatchSwitch diagnostic suppression rule.
 *
 * In a file that activates `match:` (`import "@typesugar/std/syntax/match"`),
 * a `match: switch` is expanded by the macro, so the checker's view of the
 * unexpanded switch has errors the expansion removes:
 *
 * - TS2304 / TS18004 for a name a case's pattern binds
 *   (`case { type: "Point", coordinates: [x, y] }:`), used in that case's
 *   pattern or its own statements. The expansion declares exactly those
 *   names, in a block around exactly those statements. A name bound by one
 *   case and used in another is still reported: it IS undeclared there.
 * - TS7028 ("Unused label", under `allowUnusedLabels: false`) on the `match`
 *   label itself, which the expansion removes.
 * - TS2366 ("Function lacks ending return statement") / TS7030 ("Not all
 *   code paths return a value") on a function whose body ends in a `match:`
 *   switch that cannot complete: its last case ends in `return` or `throw`
 *   and no `break` leaves it. The checker can't see that patterns on an
 *   object cover its type; the macro checks that they do (TS9226 otherwise),
 *   so the end of the function is unreachable. A switch that can complete,
 *   or code around it, is still reported.
 *
 * Needs the program in the evaluation context (for the activation check);
 * without it nothing is suppressed.
 */
export function createMatchSwitchRule(): DiagnosticSuppressionRule {
  return {
    name: "MatchSwitch",
    errorCodes: [2304, 18004, 7028, 2366, 7030],

    shouldSuppress(diagnostic, _checker, sourceFile, context): boolean {
      if (diagnostic.start === undefined || !context?.program) return false;
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node || isSyntheticNode(node)) return false;
      if (diagnostic.code === 2366 || diagnostic.code === 7030) {
        const fn = functionOfEndDiagnostic(node);
        const body = fn?.body;
        if (!body || !ts.isBlock(body)) return false;
        const last = body.statements[body.statements.length - 1];
        if (
          !last ||
          !ts.isLabeledStatement(last) ||
          last.label.text !== "match" ||
          !ts.isSwitchStatement(last.statement)
        ) {
          return false;
        }
        if (!matchSwitchActivated(context.program, sourceFile)) return false;
        return !switchCanComplete(last.statement, last.label.text);
      }
      if (!ts.isIdentifier(node)) return false;
      const labeled = enclosingMatchSwitch(node);
      if (!labeled) return false;
      if (!matchSwitchActivated(context.program, sourceFile)) return false;

      if (diagnostic.code === 7028) return node === labeled.label;

      const clause = (() => {
        for (let n: ts.Node | undefined = node; n && n !== labeled; n = n.parent) {
          if (ts.isCaseClause(n) && n.parent.parent === labeled.statement) return n;
        }
        return undefined;
      })();
      if (!clause) return false;
      // Only a pattern binds (an object/array pattern or an extractor call);
      // a bare identifier case is a value, and an unknown one is a real error.
      const pattern = clause.expression;
      if (
        !ts.isObjectLiteralExpression(pattern) &&
        !ts.isArrayLiteralExpression(pattern) &&
        !ts.isCallExpression(pattern)
      ) {
        return false;
      }
      const bound = new Set<string>();
      collectPatternBindings(pattern, bound);
      return bound.has(node.text);
    },
  };
}

/**
 * The function a "reachable end" diagnostic (TS2366, TS7030) is about: it is
 * reported on the return type annotation, or, without one, on the function's
 * name (an arrow function: the function itself).
 */
function functionOfEndDiagnostic(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isGetAccessorDeclaration(n)
    ) {
      const onFunction =
        n === node || n.name === node || (n.type !== undefined && isWithin(node, n.type));
      return onFunction ? n : undefined;
    }
  }
  return undefined;
}

/**
 * Can control leave this switch normally (other than by no case matching,
 * which the match macro rules out)? Cases fall through in order, so only the
 * last case can fall off the end; any `break` that targets the switch (an
 * unlabelled one outside nested loops and switches, or `break <label>`)
 * leaves it. Conservative: a last statement it can't prove ends abruptly
 * counts as completing.
 */
function switchCanComplete(sw: ts.SwitchStatement, label: string): boolean {
  const clauses = sw.caseBlock.clauses;
  const lastClause = clauses[clauses.length - 1];
  if (!lastClause) return true;
  const lastStatement = lastClause.statements[lastClause.statements.length - 1];
  if (!lastStatement || !endsAbruptly(lastStatement)) return true;

  const breaksOut = (node: ts.Node, nested: boolean, shadowed: boolean): boolean => {
    if (ts.isBreakStatement(node)) {
      return node.label ? !shadowed && node.label.text === label : !nested;
    }
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
    const nowNested = nested || ts.isIterationStatement(node, false) || ts.isSwitchStatement(node);
    const nowShadowed = shadowed || (ts.isLabeledStatement(node) && node.label.text === label);
    return ts.forEachChild(node, (c) => breaksOut(c, nowNested, nowShadowed)) === true;
  };
  return clauses.some((c) => c.statements.some((st) => breaksOut(st, false, false)));
}

/** Does `statement` always end with `return` or `throw`? (Syntax only; conservative.) */
function endsAbruptly(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && endsAbruptly(last);
  }
  if (ts.isIfStatement(statement)) {
    return (
      statement.elseStatement !== undefined &&
      endsAbruptly(statement.thenStatement) &&
      endsAbruptly(statement.elseStatement)
    );
  }
  return false;
}

// ===========================================================================
// ComprehensionBlock — do-notation's own syntax (std let-yield.ts / par-yield.ts)
// ===========================================================================

/** The label macros `@typesugar/std/syntax/do` activates (`@syntax-labels letYield` / `parYield`). */
const LET_YIELD_MACRO = "letYield";
const PAR_YIELD_MACRO = "parYield";
/** Labels of a sequential comprehension (`letYieldMacro.label`) and their continuations. */
const SEQ_COMPREHENSION_LABELS: ReadonlySet<string> = new Set(["let", "seq"]);
const SEQ_CONTINUATION_LABELS: ReadonlySet<string> = new Set(["yield", "pure", "return"]);
/** Labels of a parallel comprehension (`parYieldMacro.label`) and their continuations. */
const PAR_COMPREHENSION_LABELS: ReadonlySet<string> = new Set(["par", "all"]);
const PAR_CONTINUATION_LABELS: ReadonlySet<string> = new Set(["yield", "pure"]);

interface ComprehensionActivation {
  seq: boolean;
  par: boolean;
  tracker: ResolutionScopeTracker;
}

const comprehensionActivationCache = new WeakMap<
  ts.Program,
  Map<string, ComprehensionActivation>
>();

/** Which comprehension labels `sourceFile` activates (imports a `@syntax-labels` marker for). */
function comprehensionActivation(
  program: ts.Program,
  sourceFile: ts.SourceFile
): ComprehensionActivation {
  let perFile = comprehensionActivationCache.get(program);
  if (!perFile) {
    perFile = new Map();
    comprehensionActivationCache.set(program, perFile);
  }
  const cached = perFile.get(sourceFile.fileName);
  if (cached) return cached;
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker, program);
  const result = {
    seq: tracker.isLabelSyntaxActivated(sourceFile.fileName, LET_YIELD_MACRO),
    par: tracker.isLabelSyntaxActivated(sourceFile.fileName, PAR_YIELD_MACRO),
    tracker,
  };
  perFile.set(sourceFile.fileName, result);
  return result;
}

type ComprehensionKind = "seq" | "par";

/**
 * Is `stmt` a comprehension the transformer expands: an activated
 * `let:`/`seq:`/`par:`/`all:` label on a block (transformer.ts dispatches
 * only a label on the statement shape its macro expects), outside an
 * opted-out scope.
 */
function comprehensionKindOf(
  stmt: ts.Node,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): ComprehensionKind | undefined {
  if (!ts.isLabeledStatement(stmt) || !ts.isBlock(stmt.statement)) return undefined;
  const label = stmt.label.text;
  const kind: ComprehensionKind | undefined =
    act.seq && SEQ_COMPREHENSION_LABELS.has(label)
      ? "seq"
      : act.par && PAR_COMPREHENSION_LABELS.has(label)
        ? "par"
        : undefined;
  if (!kind || isInOptedOutScope(sourceFile, stmt, act.tracker, "macros")) return undefined;
  return kind;
}

/** The statement list `stmt` is in, when it is in one. */
function siblingStatements(stmt: ts.Node): readonly ts.Statement[] | undefined {
  const p = stmt.parent;
  if (!p) return undefined;
  if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p)) return p.statements;
  if (ts.isCaseClause(p) || ts.isDefaultClause(p)) return p.statements;
  return undefined;
}

/**
 * The comprehension whose continuation (`yield:`/`pure:`/`return:`) `stmt`
 * is: the transformer takes the statement right after the comprehension,
 * when it carries one of the macro's continuation labels.
 */
function comprehensionOfContinuation(
  stmt: ts.Node,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): ts.LabeledStatement | undefined {
  if (!ts.isLabeledStatement(stmt)) return undefined;
  const siblings = siblingStatements(stmt);
  const i = siblings?.indexOf(stmt) ?? -1;
  if (!siblings || i < 1) return undefined;
  const main = siblings[i - 1];
  const kind = comprehensionKindOf(main, sourceFile, act);
  if (!kind || !ts.isLabeledStatement(main)) return undefined;
  const allowed = kind === "seq" ? SEQ_CONTINUATION_LABELS : PAR_CONTINUATION_LABELS;
  return allowed.has(stmt.label.text) ? main : undefined;
}

/**
 * The block of steps `block` is, if any: a comprehension's own block, or a
 * `par:`/`all:` group directly inside a sequential one's (let-yield.ts
 * extractSteps reads those as parallel groups).
 */
function comprehensionBlockKind(
  block: ts.Node,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): ComprehensionKind | undefined {
  if (!ts.isBlock(block) || !block.parent) return undefined;
  const own = comprehensionKindOf(block.parent, sourceFile, act);
  if (own) return own;
  return isParGroupInComprehension(block.parent, sourceFile, act) ? "par" : undefined;
}

function isParGroupInComprehension(
  stmt: ts.Node,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): boolean {
  if (
    !ts.isLabeledStatement(stmt) ||
    !PAR_COMPREHENSION_LABELS.has(stmt.label.text) ||
    !ts.isBlock(stmt.statement)
  ) {
    return false;
  }
  const outer = stmt.parent;
  return (
    ts.isBlock(outer) &&
    outer.parent !== undefined &&
    comprehensionKindOf(outer.parent, sourceFile, act) === "seq"
  );
}

/**
 * The binding a step statement makes, read as let-yield.ts / par-yield.ts
 * extractSteps read it: `name << e`, `name << e || alt`, `name << e ?? alt`
 * (a bind; `bind` is the `<<` expression) or `name = e` (a pure map step).
 */
function comprehensionStepBinding(
  stmt: ts.Statement
): { name: ts.Identifier; bind?: ts.BinaryExpression; map?: ts.BinaryExpression } | undefined {
  if (!ts.isExpressionStatement(stmt) || !ts.isBinaryExpression(stmt.expression)) return undefined;
  const e = stmt.expression;
  const op = e.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsToken) {
    return ts.isIdentifier(e.left) ? { name: e.left, map: e } : undefined;
  }
  const bind =
    op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken ? e.left : e;
  if (
    ts.isBinaryExpression(bind) &&
    bind.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken &&
    ts.isIdentifier(bind.left)
  ) {
    return { name: bind.left, bind };
  }
  return undefined;
}

/** The names a step binds for the steps after it (a `par:` group: all of its steps'). */
function namesBoundByStep(stmt: ts.Statement, out: Set<string>): void {
  if (ts.isLabeledStatement(stmt) && PAR_COMPREHENSION_LABELS.has(stmt.label.text)) {
    if (ts.isBlock(stmt.statement)) {
      for (const s of stmt.statement.statements) namesBoundByStep(s, out);
    }
    return;
  }
  const binding = comprehensionStepBinding(stmt);
  // `_ << e` discards its value: nothing is bound.
  if (binding && binding.name.text !== "_") out.add(binding.name.text);
}

/**
 * The step statement `node` is the binding name of (`user` in `user << e`,
 * `label` in `label = e`), with its binding, when that statement is a step
 * of a comprehension.
 */
function comprehensionStepOfName(
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): ReturnType<typeof comprehensionStepBinding> {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isExpressionStatement(n)) {
      const binding = comprehensionStepBinding(n);
      return binding?.name === node && comprehensionBlockKind(n.parent, sourceFile, act)
        ? binding
        : undefined;
    }
    if (!ts.isBinaryExpression(n)) return undefined;
  }
  return undefined;
}

/**
 * The names comprehensions bind that are in scope at `node` after
 * expansion: in a sequential comprehension, those of the steps before the
 * one `node` is in (a `par:` group's steps see none of each other's); in a
 * continuation, those of every step of its comprehension; and so on out
 * through enclosing comprehensions. Undefined when `node` is in none.
 */
function comprehensionNamesInScopeAt(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): Set<string> | undefined {
  const names = new Set<string>();
  let inside = false;
  let child: ts.Node = node;
  for (let n: ts.Node | undefined = node.parent; n; child = n, n = n.parent) {
    const kind = comprehensionBlockKind(n, sourceFile, act);
    if (kind && ts.isBlock(n)) {
      inside = true;
      if (kind === "seq") {
        for (const s of n.statements) {
          if (s === child) break;
          namesBoundByStep(s, names);
        }
      }
      continue;
    }
    const main = comprehensionOfContinuation(n, sourceFile, act);
    if (main && ts.isBlock(main.statement)) {
      inside = true;
      for (const s of main.statement.statements) namesBoundByStep(s, names);
    }
  }
  return inside ? names : undefined;
}

/** Codes for a label TypeScript rejects or flags: `let`/`yield` are reserved in strict code; unused label. */
const LABEL_CODES: readonly number[] = [1212, 1213, 1214, 7028];
/** "Cannot find name" and its variants with a suggestion, and the shorthand-property form. */
const UNRESOLVED_NAME_CODES: readonly number[] = [2304, 2552, 2662, 2663, 18004];
/**
 * What TypeScript reports about a bound name that also names an outer
 * declaration (a DOM global such as `name` or `top`, an outer `const`): it
 * checks the use against THAT declaration's type. A property that type lacks,
 * an argument, a call, possibly-null, an operand, use before declaration.
 */
const SHADOWED_NAME_CODES: readonly number[] = [
  2339, 2551, 2345, 2349, 2351, 2531, 2532, 2533, 18046, 18047, 18048, 18049, 2362, 2363, 2365,
  2367, 2448, 2454, 2488, 2538, 2554, 2769, 7053,
];
/** An arithmetic operand / operator type error (`<<` on a monadic value). */
const BIND_OPERATOR_CODES: readonly number[] = [2362, 2363, 2365];
/** "Right operand of ?? is unreachable": a bind's `<<` is a number to TypeScript, never nullish. */
const BIND_FALLBACK_CODE = 2869;
/** An assignment to an outer name a map step (`name = e`) shadows: const, type, non-variable. */
const MAP_ASSIGNMENT_CODES: readonly number[] = [2322, 2539, 2588, 2628, 2629, 2630, 2631, 2632];

/**
 * The identifier a diagnostic at `node` is about: `node` itself, or, for a
 * diagnostic on a property name or a member/call/non-null chain
 * (`user.nme`, `user!.posts[0]`), the identifier the chain starts from.
 */
function diagnosticSubject(node: ts.Node): ts.Identifier | undefined {
  let n: ts.Node = node;
  if (
    ts.isIdentifier(n) &&
    n.parent &&
    ts.isPropertyAccessExpression(n.parent) &&
    n.parent.name === n
  ) {
    n = n.parent.expression;
  }
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
    else if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = n.expression;
    else if (ts.isCallExpression(n)) n = n.expression;
    else break;
  }
  return ts.isIdentifier(n) ? n : undefined;
}

/**
 * Is `id` the tag the expression-position preprocessor reads a
 * comprehension's value through (arrow-comprehension-preprocess.ts:
 * `(x) => { COMP; return __letyield_N; }`, `COMP; const r = __letyield_N;`),
 * in the statement right after that comprehension? The let:/par: macros
 * declare it (`const __letyield_N = <chain>`). `typesugar check`/`build`
 * drop diagnostics on it when they map positions back (comprehension-gate.ts
 * mapRewrittenDiagnostic); `typesugar watch` serves the rewritten text
 * without that mapping, and reported TS2304 on it.
 */
function isComprehensionValueTag(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  act: ComprehensionActivation
): boolean {
  if (!/^__letyield_\d+$/.test(id.text)) return false;
  let stmt: ts.Node = id;
  while (stmt.parent && !siblingStatements(stmt)) stmt = stmt.parent;
  const siblings = siblingStatements(stmt);
  const i = siblings?.indexOf(stmt as ts.Statement) ?? -1;
  if (!siblings || i < 1) return false;
  const prev = siblings[i - 1];
  return (
    comprehensionKindOf(prev, sourceFile, act) !== undefined ||
    comprehensionOfContinuation(prev, sourceFile, act) !== undefined
  );
}

/**
 * Create the ComprehensionBlock diagnostic suppression rule.
 *
 * In a file that activates do-notation (`import "@typesugar/std/syntax/do"`,
 * or a package's own marker such as `@typesugar/effect/syntax/do`), a
 * comprehension (`let:`/`seq:`/`par:`/`all:` on a block, with the
 * `yield:`/`pure:`/`return:` statement after it) is expanded into a
 * flatMap/map chain, so the checker's view of the unexpanded syntax has
 * errors the expansion removes:
 *
 * - TS1212/TS1213/TS1214 (`let` and `yield` are reserved words in strict
 *   code) and TS7028 (unused label) on the comprehension's labels, its
 *   continuation's, and a `par:`/`all:` group's inside a `let:`.
 * - TS2304 (and TS2552/TS2662/TS2663, the same with a suggestion; TS18004 for
 *   a shorthand property `({ user })`) for a name a step binds (`user <<
 *   e`, `label = e`), at the step itself, in a later step of a sequential
 *   comprehension, or in the continuation: where the expansion declares it.
 *   A name used before the step that binds it, by another step of the same
 *   `par:` group, or outside the comprehension is still reported.
 * - TS2362/TS2363/TS2365 on a bind's `<<` (its operands aren't numbers), and
 *   TS2869 on a `<< e ?? fallback` bind (to TypeScript `<<` is never nullish).
 * - TS2322/TS2588/... on a map step's `name = e` when `name` also names an
 *   outer constant or a value of another type (the step declares a new one).
 * - When a bound name also names an outer declaration (a DOM global such as
 *   `name` or `top`, an outer variable), TypeScript checks its uses as that
 *   declaration: the errors that come from its type there
 *   (SHADOWED_NAME_CODES), on the name or a member/call chain starting at it.
 * - TS2304 on the expression-position preprocessor's `__letyield_N` tag in
 *   the statement right after the comprehension (isComprehensionValueTag).
 *
 * Nothing else is hidden, so an error in a step's own expression is still
 * reported (`fetchUsr(id)`, `fetchAge(42)` against a `string` parameter).
 * Before expansion a bound name has no type, though: an expression that
 * USES one (`fetchAge(user.nme)`) is not type-checked until it is expanded
 * — in the IDE, which checks the expansion, or with `typesugar check
 * --strict`.
 *
 * Needs the program in the evaluation context (for the activation check);
 * without it nothing is suppressed.
 */
export function createComprehensionBlockRule(): DiagnosticSuppressionRule {
  return {
    name: "ComprehensionBlock",
    errorCodes: [
      ...new Set([
        ...LABEL_CODES,
        ...UNRESOLVED_NAME_CODES,
        ...SHADOWED_NAME_CODES,
        ...BIND_OPERATOR_CODES,
        BIND_FALLBACK_CODE,
        ...MAP_ASSIGNMENT_CODES,
      ]),
    ],

    shouldSuppress(diagnostic, _checker, sourceFile, context): boolean {
      if (diagnostic.start === undefined || !context?.program) return false;
      // No comprehension label in the text: skip the import scan.
      if (!/\b(?:let|seq|par|all)\s*:/.test(sourceFile.text)) return false;
      const act = comprehensionActivation(context.program, sourceFile);
      if (!act.seq && !act.par) return false;
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node || isSyntheticNode(node)) return false;
      const code = diagnostic.code;

      if (LABEL_CODES.includes(code)) {
        const labeled = node.parent;
        return (
          ts.isIdentifier(node) &&
          labeled !== undefined &&
          ts.isLabeledStatement(labeled) &&
          labeled.label === node &&
          (comprehensionKindOf(labeled, sourceFile, act) !== undefined ||
            comprehensionOfContinuation(labeled, sourceFile, act) !== undefined ||
            isParGroupInComprehension(labeled, sourceFile, act))
        );
      }

      if (BIND_OPERATOR_CODES.includes(code) || code === BIND_FALLBACK_CODE) {
        const bin = code === 2365 || code === BIND_FALLBACK_CODE ? node : node.parent;
        if (bin && ts.isBinaryExpression(bin) && ts.isIdentifier(bin.left)) {
          const at = code === 2362 ? bin.left : code === 2363 ? bin.right : bin;
          const fallbackOk =
            code !== BIND_FALLBACK_CODE ||
            (ts.isBinaryExpression(bin.parent) &&
              bin.parent.left === bin &&
              bin.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);
          if (
            at === node &&
            fallbackOk &&
            comprehensionStepOfName(bin.left, sourceFile, act)?.bind === bin
          ) {
            return true;
          }
        }
        if (code === BIND_FALLBACK_CODE) return false;
      }

      if (MAP_ASSIGNMENT_CODES.includes(code) && ts.isIdentifier(node)) {
        if (comprehensionStepOfName(node, sourceFile, act)?.map !== undefined) return true;
      }

      if (!UNRESOLVED_NAME_CODES.includes(code) && !SHADOWED_NAME_CODES.includes(code)) {
        return false;
      }
      // The name a step binds, at that step or where the expansion has it
      // in scope. "Cannot find name" is about the identifier itself; the
      // shadowing errors may be about a chain starting at it.
      const subject = UNRESOLVED_NAME_CODES.includes(code)
        ? ts.isIdentifier(node)
          ? node
          : undefined
        : diagnosticSubject(node);
      if (!subject) return false;
      if (comprehensionStepOfName(subject, sourceFile, act)) return true;
      if (code === 2304 && isComprehensionValueTag(subject, sourceFile, act)) return true;
      return comprehensionNamesInScopeAt(subject, sourceFile, act)?.has(subject.text) ?? false;
    },
  };
}

// ===========================================================================
// Rule 6: OperatorOverload — suppress TS2365 for @op operator overloading
// ===========================================================================

/** Per-program operator-syntax activation, computed the way the transform pass does. */
const operatorActivationCache = new WeakMap<
  ts.Program,
  Map<string, { activated: Set<string>; tracker: ResolutionScopeTracker }>
>();

function operatorActivation(
  program: ts.Program,
  sourceFile: ts.SourceFile
): { activated: Set<string>; tracker: ResolutionScopeTracker } {
  let perFile = operatorActivationCache.get(program);
  if (!perFile) {
    perFile = new Map();
    operatorActivationCache.set(program, perFile);
  }
  const cached = perFile.get(sourceFile.fileName);
  if (cached) return cached;
  // A private tracker: same scan as transform.ts's scanImportsForScope call,
  // without depending on whether (or for which program) a transform ran.
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker, program);
  const activated = new Set([
    ...tracker.getActivatedOperatorSyntax(sourceFile.fileName),
    ...tracker.getDefinedTypeclasses(sourceFile.fileName),
  ]);
  const result = { activated, tracker };
  perFile.set(sourceFile.fileName, result);
  return result;
}

function activatedOperatorTypeclasses(program: ts.Program, sourceFile: ts.SourceFile): Set<string> {
  return operatorActivation(program, sourceFile).activated;
}

/**
 * The operator-chain typing's hooks for the diagnostic filter: the opt-out
 * scopes from this file's own scan (as the rewrite's `isOperatorRewriteOptedOut`
 * reads them from the transform's), and checker failures reported once.
 */
function filterChainHooks(
  sourceFile: ts.SourceFile,
  tracker: ResolutionScopeTracker,
  rule: string
): OperatorChainHooks {
  return {
    optedOut: (node) =>
      isInOptedOutScope(sourceFile, node, tracker, "operators") ||
      isInOptedOutScope(sourceFile, node, tracker, "extensions"),
    warn: (_node, message) => reportCheckerFailure(rule, message),
  };
}

/**
 * The binary expression whose LEFT (TS2362) or RIGHT (TS2363) operand is
 * exactly the diagnostic's span: TypeScript reports those at the operand.
 * By position, from the innermost node there up, so `a * b - c`'s TS2362 at
 * `a` is the inner `*`, not the outer `-`.
 */
function binaryOfOperandDiagnostic(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
  side: "left" | "right"
): ts.BinaryExpression | undefined {
  for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
    if (ts.isBinaryExpression(cur)) {
      const operand = side === "left" ? cur.left : cur.right;
      if (operand.getStart(sourceFile) === start && operand.end === start + length) return cur;
    }
    if (ts.isStatement(cur) || ts.isSourceFile(cur)) break;
  }
  return undefined;
}

/**
 * Create the OperatorOverload diagnostic suppression rule.
 *
 * Suppresses TS2365 ("Operator 'X' cannot be applied to types 'A' and 'B'")
 * only when the transformer's operator rewrite (`tryRewriteTypeclassOperator`)
 * will replace that expression: the file activates (imports or defines) a
 * typeclass mapping the operator via `@op`, the LEFT operand is a
 * non-primitive type, and an instance of that typeclass for the left
 * operand's type is in scope (or the type `@derive`s it). Deep-review
 * macros-other #10: it used to suppress every TS2365 with any object operand
 * (`money + 1`, `[1, 2] + 3`).
 *
 * The operator index needs the `ts.Program`, which the caller must pass in
 * the evaluation context (`filterDiagnostics(..., { program })`); without it
 * nothing is suppressed.
 */
export function createOperatorOverloadRule(): DiagnosticSuppressionRule {
  return {
    name: "OperatorOverload",
    // 2365: `+`, comparisons ("Operator 'X' cannot be applied to types");
    // 2362/2363: the arithmetic operators' left/right operand ("must be of
    // type 'any', 'number', 'bigint' or an enum type"), reported at the
    // operand -- suppressed exactly when the operator is rewritten
    // (operatorRewriteResult, the rewrite's own decision).
    errorCodes: [2365, 2362, 2363],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile,
      context?: DiagnosticSuppressionContext
    ): boolean {
      const program = context?.program;
      if (!program) return false;
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;

      if (diagnostic.code === 2362 || diagnostic.code === 2363) {
        const operandOf = binaryOfOperandDiagnostic(
          node,
          sourceFile,
          diagnostic.start,
          diagnostic.length,
          diagnostic.code === 2362 ? "left" : "right"
        );
        if (!operandOf) return false;
        const { activated, tracker } = operatorActivation(program, sourceFile);
        const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;
        return (
          operatorRewriteResult(
            ctx,
            operandOf,
            activated,
            filterChainHooks(sourceFile, tracker, "OperatorOverload")
          ) !== undefined
        );
      }

      let binary: ts.BinaryExpression | undefined;
      for (let cur: ts.Node | undefined = node, i = 0; cur && i < 5; cur = cur.parent, i++) {
        if (ts.isBinaryExpression(cur)) {
          binary = cur;
          break;
        }
      }
      if (!binary || isSyntheticNode(binary)) return false;

      const op = getOperatorString(binary.operatorToken.kind);
      if (!op) return false;

      const activated = activatedOperatorTypeclasses(program, sourceFile);
      if (activated.size === 0) return false;
      const candidates = getOperatorCandidates(program, activated, op);
      if (candidates.length === 0) return false;

      // The rewrite's own decision (operatorRewriteResult): operands typed as
      // rewritten (a chain `a * 2 + b`, or a const bound to one, `const p =
      // a * b; p + a`, which TypeScript types number), a non-primitive left
      // type by its flags, one instance from scope, the operands' declared
      // types for a narrowed operand, and a right operand that fits.
      const { tracker } = operatorActivation(program, sourceFile);
      const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;
      if (
        operatorRewriteResult(
          ctx,
          binary,
          activated,
          filterChainHooks(sourceFile, tracker, "OperatorOverload")
        ) !== undefined
      ) {
        return true;
      }

      // Not rewritten, but the left operand's type DECLARES `@derive(TC)` for
      // a candidate: the rewrite reports TS9001 at the operator instead
      // (reportDerivedWithoutInstance), which replaces this error.
      try {
        const leftType = checker.getTypeAtLocation(binary.left);
        const rightType = checker.getTypeAtLocation(binary.right);
        const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
        if ((leftType.flags & nullish) !== 0 || (rightType.flags & nullish) !== 0) return false;
        // Primitive by the type's flags, not its printed name (CLAUDE.md).
        if (isPrimitiveByFlags(leftType) || !(leftType.flags & ts.TypeFlags.Object)) return false;
        const declared = new Set<string>();
        const symbol = leftType.getSymbol() ?? leftType.aliasSymbol;
        for (const decl of symbol?.getDeclarations() ?? []) {
          for (const tc of deriveNamesFromDeclaration(decl)) declared.add(tc);
        }
        return candidates.some((c) => declared.has(c.typeclass));
      } catch (e) {
        reportCheckerFailure("OperatorOverload", e);
        return false;
      }
    },

    // TypeScript types the operator expression as number (an error for `+`),
    // so once its operand errors are gone nothing reports a rewritten value
    // used as a number: `(a * b).toFixed(2)`, `const n: number = a * b`
    // (review 6). Reported here, as the expanded code's error.
    replacementDiagnostics(diagnostic, checker, sourceFile, context) {
      const program = context?.program;
      if (!program || diagnostic.start === undefined || diagnostic.length === undefined) {
        return [];
      }
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return [];
      let binary: ts.BinaryExpression | undefined;
      if (diagnostic.code === 2362 || diagnostic.code === 2363) {
        binary = binaryOfOperandDiagnostic(
          node,
          sourceFile,
          diagnostic.start,
          diagnostic.length,
          diagnostic.code === 2362 ? "left" : "right"
        );
      } else {
        for (let cur: ts.Node | undefined = node, i = 0; cur && i < 5; cur = cur.parent, i++) {
          if (ts.isBinaryExpression(cur)) {
            binary = cur;
            break;
          }
        }
      }
      if (!binary || isSyntheticNode(binary)) return [];
      const misuse = rewrittenValueMisuse(program, checker, sourceFile, binary, "OperatorOverload");
      return misuse ? [misuse] : [];
    },
  };
}

// ===========================================================================
// RewrittenOperatorResult — TS2322/TS2345 on the value of a rewritten operator
// ===========================================================================

/**
 * Create the RewrittenOperatorResult diagnostic suppression rule.
 *
 * TypeScript types `a * b` on two objects as `number` (an arithmetic
 * operator's result, whatever the operands), so the value of a rewritten
 * operator that returns the instance type (`numericRational.mul(a, b)`, a
 * `Rational`) fails where a `Rational` is expected:
 * `rationalToString(a * b)` (TS2345), `const p: Rational = a * b`, `return
 * a * b` (TS2322). Suppressed only when the value is such an operator
 * expression -- or a same-file `const` with no annotation bound to one
 * (`const product = a * b; rationalToString(product)`), whose type is its
 * initializer's -- the operator is rewritten (operatorRewriteResult, the
 * rewrite's own decision), and its rewritten type is assignable to the
 * target.
 *
 * tsc reports only the FIRST failing argument of a call, so suppressing the
 * TS2345 on `g(a * b, 5)`'s `a * b` would hide `5`'s error: the later
 * arguments are re-checked (`replacementDiagnostics`), each typed as
 * rewritten when it is a rewritten operator, and the first that doesn't fit
 * its parameter is reported as tsc would report it on the expanded code.
 *
 * The opposite direction -- a rewritten value where a `number` is expected
 * (`const n: number = a * b`, `(a * b).toFixed(2)`), which TypeScript accepts
 * -- is reported by the OperatorOverload rule, in place of the operand errors
 * it suppresses (see `rewrittenValueMisuse`). Other uses of an unannotated
 * const bound to a rewritten operator (`product.num`) are still typed
 * `number` by TypeScript and are not covered: annotate the const (`const
 * product: Rational = a * b`) to give them the right type.
 */
export function createRewrittenOperatorResultRule(): DiagnosticSuppressionRule {
  return {
    name: "RewrittenOperatorResult",
    errorCodes: [2322, 2345],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile,
      context?: DiagnosticSuppressionContext
    ): boolean {
      const program = context?.program;
      if (!program || diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;
      const value = assignedValueExpression(node, diagnostic.code);
      if (!value) return false;
      const { activated, tracker } = operatorActivation(program, sourceFile);
      if (activated.size === 0) return false;
      const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;
      const hooks = filterChainHooks(sourceFile, tracker, "RewrittenOperatorResult");
      try {
        const rewritten =
          rewrittenOperandType(ctx, value, activated, hooks) ??
          // `f(a * b)` with `f(x: number): string; f(x: Rational): Rational`:
          // TypeScript picked the `number` overload; the rewritten argument
          // picks another, whose return type is the call's (review 7).
          overloadReturnTypeWithRewrittenArguments(ctx, value, activated, hooks);
        if (!rewritten) return false;
        const types = extractAssignmentTypes(node, checker);
        if (!types) return false;
        return checker.isTypeAssignableTo(rewritten, types.targetType);
      } catch (e) {
        reportCheckerFailure("RewrittenOperatorResult", e);
        return false;
      }
    },

    replacementDiagnostics(diagnostic, checker, sourceFile, context) {
      const program = context?.program;
      if (
        diagnostic.code !== 2345 ||
        !program ||
        diagnostic.start === undefined ||
        diagnostic.length === undefined
      ) {
        return [];
      }
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      const value = node && assignedValueExpression(node, 2345);
      const call = value?.parent;
      if (!value || !call || !(ts.isCallExpression(call) || ts.isNewExpression(call))) return [];
      const args = call.arguments ?? ts.factory.createNodeArray<ts.Expression>();
      const { activated, tracker } = operatorActivation(program, sourceFile);
      const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;
      const hooks = filterChainHooks(sourceFile, tracker, "RewrittenOperatorResult");
      // Throws propagate: the framework then keeps the original diagnostic.
      // An overloaded callee: the parameter types below are the overload
      // TypeScript chose for the `number` it sees; when some overload takes
      // every argument as rewritten, there is no error (review 7).
      const typeOfArg = (arg: ts.Expression) =>
        rewrittenOperandType(ctx, arg, activated, hooks) ?? judgedArgumentType(checker, arg);
      if (anyOverloadAccepts(checker, call, typeOfArg) === true) return [];
      for (const arg of args.slice(args.indexOf(value) + 1)) {
        // A spread no longer lines arguments up with parameters; tsc's own
        // checks of what follows are unaffected by the suppression anyway.
        if (ts.isSpreadElement(arg)) break;
        if (isSyntheticNode(arg)) continue;
        const target = checker.getContextualType(arg);
        if (!target || containsTypeParameter(target)) continue;
        const actual =
          rewrittenOperandType(ctx, arg, activated, hooks) ?? checker.getTypeAtLocation(arg);
        if (!checker.isTypeAssignableTo(actual, target)) {
          return [
            expandedCodeError(
              sourceFile,
              arg,
              2345,
              `Argument of type '${checker.typeToString(actual)}' is not assignable to ` +
                `parameter of type '${checker.typeToString(target)}'.`
            ),
          ];
        }
      }
      return [];
    },
  };
}

const RELATIONAL_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

/**
 * Operators TypeScript rejects an object operand of (TS2362/TS2363/TS2365):
 * arithmetic, bitwise, relational. Not equality, `in`, `instanceof`.
 */
const OPERAND_MUST_BE_PRIMITIVE: ReadonlySet<ts.SyntaxKind> = new Set(
  [...PRIMITIVE_RESULT_OPERATORS].filter(
    (k) =>
      k !== ts.SyntaxKind.EqualsEqualsToken &&
      k !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
      k !== ts.SyntaxKind.ExclamationEqualsToken &&
      k !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
      k !== ts.SyntaxKind.InKeyword &&
      k !== ts.SyntaxKind.InstanceOfKeyword
  )
);

/**
 * An argument's type for judging it against a parameter: the checker's,
 * except where that type came from the parameter itself (a function or
 * object literal, contextually typed by the overload TypeScript chose):
 * undefined, "not judged" -- taken to fit.
 */
function judgedArgumentType(checker: ts.TypeChecker, arg: ts.Expression): ts.Type | undefined {
  let e = arg;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isObjectLiteralExpression(e)) {
    return undefined;
  }
  if (isSyntheticNode(e)) return undefined;
  return checker.getTypeAtLocation(e);
}

/** The call or construct signatures of `call`'s callee, in declaration order. */
function calleeSignatures(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression
): readonly ts.Signature[] {
  if (isSyntheticNode(call.expression)) return [];
  const type = checker.getTypeAtLocation(call.expression);
  return checker.getSignaturesOfType(
    type,
    ts.isNewExpression(call) ? ts.SignatureKind.Construct : ts.SignatureKind.Call
  );
}

/**
 * Does `sig` take arguments of `argTypes` (an undefined entry is not judged)?
 * Undefined when it can't be told without inference (a generic signature, a
 * rest parameter that isn't an array).
 */
function signatureAccepts(
  checker: ts.TypeChecker,
  sig: ts.Signature,
  argTypes: readonly (ts.Type | undefined)[]
): boolean | undefined {
  if (sig.typeParameters?.length) return undefined;
  const params = sig.getParameters();
  const paramDecl = (p: ts.Symbol) => {
    const d = p.valueDeclaration;
    return d && ts.isParameter(d) ? d : undefined;
  };
  const last = params.length > 0 ? paramDecl(params[params.length - 1]) : undefined;
  const hasRest = !!last?.dotDotDotToken;
  const fixed = hasRest ? params.length - 1 : params.length;
  let min = 0;
  while (min < fixed) {
    const d = paramDecl(params[min]);
    if (!d || d.questionToken || d.initializer) break;
    min++;
  }
  if (argTypes.length < min || (!hasRest && argTypes.length > fixed)) return false;
  for (let i = 0; i < argTypes.length; i++) {
    const actual = argTypes[i];
    if (!actual) continue;
    let param: ts.Type | undefined;
    if (i < fixed) {
      param = checker.getTypeOfSymbol(params[i]);
    } else {
      param = checker.getIndexTypeOfType(
        checker.getTypeOfSymbol(params[params.length - 1]),
        ts.IndexKind.Number
      );
    }
    if (!param || containsTypeParameter(param)) return undefined;
    if (!checker.isTypeAssignableTo(actual, param)) return false;
  }
  return true;
}

/** Each argument's type per `typeOf`, or undefined when an argument is spread (arguments no longer line up). */
function argumentTypes(
  call: ts.CallExpression | ts.NewExpression,
  typeOf: (arg: ts.Expression) => ts.Type | undefined
): (ts.Type | undefined)[] | undefined {
  const args = call.arguments ?? [];
  if (args.some((a) => ts.isSpreadElement(a))) return undefined;
  return args.map(typeOf);
}

/**
 * For a callee with more than one signature (overloads): does some signature
 * take every argument, typed by `typeOf` (a rewritten operator as rewritten)?
 * True also when one can't be judged (never invent an error). Undefined for
 * a callee with one signature or none, where the contextual type is the
 * parameter's.
 */
function anyOverloadAccepts(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
  typeOf: (arg: ts.Expression) => ts.Type | undefined
): boolean | undefined {
  const sigs = calleeSignatures(checker, call);
  if (sigs.length < 2) return undefined;
  const types = argumentTypes(call, typeOf);
  if (!types) return true;
  return sigs.some((sig) => signatureAccepts(checker, sig, types) !== false);
}

/**
 * `value` (parentheses aside) is a call to an overloaded callee with a
 * rewritten operator among its arguments: the return type of the overload
 * the expanded code resolves to (the first, in declaration order, that takes
 * the arguments as rewritten). Undefined when no argument is rewritten, the
 * callee isn't overloaded, or the choice can't be told.
 */
function overloadReturnTypeWithRewrittenArguments(
  ctx: MacroContext,
  value: ts.Expression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | undefined {
  let call = value;
  while (ts.isParenthesizedExpression(call)) call = call.expression;
  if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) return undefined;
  const checker = ctx.typeChecker;
  const sigs = calleeSignatures(checker, call);
  if (sigs.length < 2) return undefined;
  let rewrittenAny = false;
  const types = argumentTypes(call, (arg) => {
    const t = rewrittenOperandType(ctx, arg, activated, hooks);
    if (t) rewrittenAny = true;
    return t ?? judgedArgumentType(checker, arg);
  });
  if (!types || !rewrittenAny) return undefined;
  for (const sig of sigs) {
    const accepts = signatureAccepts(checker, sig, types);
    if (accepts === undefined) return undefined;
    if (accepts) return checker.getReturnTypeOfSignature(sig);
  }
  return undefined;
}

/** `t` is, or contains at its top level, a type parameter or other not-yet-instantiated type. */
function containsTypeParameter(t: ts.Type): boolean {
  if (t.flags & ts.TypeFlags.Instantiable) return true;
  return t.isUnionOrIntersection() && t.types.some((m) => containsTypeParameter(m));
}

/** An error at `node`, reported the way tsc would report it on the expanded code. */
function expandedCodeError(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: number,
  message: string,
  note?: string
): ts.Diagnostic {
  const start = node.getStart(sourceFile);
  return {
    file: sourceFile,
    start,
    length: node.getEnd() - start,
    code,
    category: ts.DiagnosticCategory.Error,
    messageText: note
      ? {
          messageText: message,
          category: ts.DiagnosticCategory.Error,
          code,
          next: [{ messageText: note, category: ts.DiagnosticCategory.Message, code: 0 }],
        }
      : message,
  };
}

/**
 * The error a rewritten operator's value has where TypeScript, typing it as
 * `number`, sees none (review 6): `binary` is rewritten to a method returning
 * the instance type `R` (operatorRewriteResult, the rewrite's own decision),
 * and its value (parentheses aside)
 *
 * - has a property read that `R` lacks (`(a * b).toFixed(2)`): TS2339;
 * - is the operand of an operator that is not itself rewritten (`a * b > 0`),
 *   which then applies to an `R`: TS2365;
 * - flows into a position whose contextual type accepts the `number`
 *   TypeScript sees but not `R` (`const n: number = a * b`, a `number`
 *   parameter, a `number` return): TS2322, or TS2345 for an argument.
 *
 * Contextual types that still contain type parameters are skipped (inference
 * would follow the rewritten type). Undefined when none applies.
 */
function rewrittenValueMisuse(
  program: ts.Program,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  binary: ts.BinaryExpression,
  rule: string
): ts.Diagnostic | undefined {
  const { activated, tracker } = operatorActivation(program, sourceFile);
  if (activated.size === 0) return undefined;
  const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;
  const hooks = filterChainHooks(sourceFile, tracker, rule);
  const result = operatorRewriteResult(ctx, binary, activated, hooks);
  if (!result || result === true) return undefined;
  const R = result;
  const op = binary.operatorToken.getText(sourceFile);
  const note =
    `'${op}' here is rewritten by typesugar to a typeclass method that returns ` +
    `'${checker.typeToString(R)}', not a number.`;

  let outer: ts.Expression = binary;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const parent = outer.parent;

  if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
    const name = parent.name.text;
    if (!checker.getPropertyOfType(R, name)) {
      return expandedCodeError(
        sourceFile,
        parent.name,
        2339,
        `Property '${name}' does not exist on type '${checker.typeToString(R)}'.`,
        note
      );
    }
    return undefined;
  }
  if (
    ts.isElementAccessExpression(parent) &&
    parent.expression === outer &&
    ts.isStringLiteralLike(parent.argumentExpression)
  ) {
    const name = parent.argumentExpression.text;
    if (!checker.getPropertyOfType(R, name)) {
      return expandedCodeError(
        sourceFile,
        parent.argumentExpression,
        2339,
        `Property '${name}' does not exist on type '${checker.typeToString(R)}'.`,
        note
      );
    }
    return undefined;
  }
  if (ts.isBinaryExpression(parent) && OPERAND_MUST_BE_PRIMITIVE.has(parent.operatorToken.kind)) {
    // The enclosing operator is a chain step: the rewrite decides it.
    if (operatorRewriteResult(ctx, parent, activated, hooks) !== undefined) return undefined;
    const isLeft = parent.left === outer;
    const kind = parent.operatorToken.kind;
    if (kind === ts.SyntaxKind.PlusToken || RELATIONAL_OPERATORS.has(kind)) {
      const other = checker.getBaseTypeOfLiteralType(
        checker.getTypeAtLocation(isLeft ? parent.right : parent.left)
      );
      const [l, r] = isLeft ? [R, other] : [other, R];
      return expandedCodeError(
        sourceFile,
        parent,
        2365,
        `Operator '${parent.operatorToken.getText(sourceFile)}' cannot be applied to types ` +
          `'${checker.typeToString(l)}' and '${checker.typeToString(r)}'.`,
        note
      );
    }
    return expandedCodeError(
      sourceFile,
      outer,
      isLeft ? 2362 : 2363,
      `The ${isLeft ? "left" : "right"}-hand side of an arithmetic operation must be of type ` +
        `'any', 'number', 'bigint' or an enum type.`,
      note
    );
  }

  const target = checker.getContextualType(outer);
  if (!target || containsTypeParameter(target)) return undefined;
  // Only where TypeScript itself reports nothing: the number it sees fits.
  if (!checker.isTypeAssignableTo(checker.getTypeAtLocation(outer), target)) return undefined;
  if (checker.isTypeAssignableTo(R, target)) return undefined;
  const isArgument =
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    (parent.arguments?.includes(outer) ?? false);
  if (isArgument) {
    // With overloads, `target` is the parameter of the overload TypeScript
    // chose for the `number` it sees: another may take `R` (review 7,
    // `f(x: number): string; f(x: Rational): Rational` and `f(a * b)`).
    const typeOfArg = (arg: ts.Expression) =>
      arg === outer
        ? R
        : (rewrittenOperandType(ctx, arg, activated, hooks) ?? judgedArgumentType(checker, arg));
    const verdict = anyOverloadAccepts(
      checker,
      parent as ts.CallExpression | ts.NewExpression,
      typeOfArg
    );
    if (verdict === true) return undefined;
    if (verdict === false) {
      return expandedCodeError(sourceFile, outer, 2769, `No overload matches this call.`, note);
    }
  }
  return isArgument
    ? expandedCodeError(
        sourceFile,
        outer,
        2345,
        `Argument of type '${checker.typeToString(R)}' is not assignable to parameter of ` +
          `type '${checker.typeToString(target)}'.`,
        note
      )
    : expandedCodeError(
        sourceFile,
        outer,
        2322,
        `Type '${checker.typeToString(R)}' is not assignable to type '${checker.typeToString(target)}'.`,
        note
      );
}

/**
 * The expression whose value a TS2322/TS2345 at `node` is about: the call
 * argument containing it (TS2345), or a variable's initializer, an
 * assignment's right side, a return value (TS2322).
 */
function assignedValueExpression(node: ts.Node, code: number): ts.Expression | undefined {
  for (let cur: ts.Node | undefined = node, i = 0; cur && i < 10; cur = cur.parent, i++) {
    if (code === 2345) {
      const parent: ts.Node | undefined = cur.parent;
      if (
        parent &&
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.arguments?.includes(cur as ts.Expression)
      ) {
        return cur as ts.Expression;
      }
      continue;
    }
    if (ts.isVariableDeclaration(cur)) return cur.initializer;
    if (ts.isReturnStatement(cur)) return cur.expression;
    if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return cur.right;
    }
    if (ts.isStatement(cur)) return undefined;
  }
  return undefined;
}

/**
 * Handle TS2355 by checking if the function's return type is a registered
 * opaque type. If so, the function body may return the underlying type
 * implicitly, which the transformer will handle.
 */
function checkReturnTypeRewrite(node: ts.Node, checker: ts.TypeChecker): boolean {
  const fn = findEnclosingFunctionFromNode(node);
  if (!fn?.type) return false;

  try {
    const returnType = checker.getTypeFromTypeNode(fn.type);
    if (resolveTypeRewrite(returnType, checker)) return true;
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] checkReturnTypeRewrite: ${e}`);
    }
    return false;
  }

  return false;
}

/**
 * Find the enclosing function-like declaration from any node.
 * Similar to `findEnclosingFunction` but starts from the node itself.
 */
function findEnclosingFunctionFromNode(
  node: ts.Node
):
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}
