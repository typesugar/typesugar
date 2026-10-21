/**
 * Source-based typeclass-instance extraction for auto-specialization
 * (PEP-053 Wave 2).
 *
 * Single shared implementation used by both transformer pipelines. Given a
 * call-site argument expression, resolves it back to the instance's defining
 * object literal — across import aliases, identifier-alias consts, zero-arg
 * factory functions, and companion paths — and extracts its method bodies for
 * inlining.
 *
 * Correctness rule for cross-module extraction: a method body lifted out of
 * another module may reference bindings that exist only in that module
 * (module-local helpers, imports). Inlining such a body into the call site
 * would capture unresolvable identifiers, so those methods are dropped and the
 * call falls back to dictionary passing — which is always correct (PEP-053
 * "fallback over import emission" decision).
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
import {
  cloneNodeDeep,
  extractTypeArgumentsContent,
  globalRegistry,
  isSyntheticNode,
} from "@typesugar/core";
import {
  type DictMethod,
  type DictMethodMap,
  type MemberMethodResolver,
  extractMethodsFromObjectLiteral,
  registerInstanceMethodsFromAST,
  methodDependsOnReceiver,
} from "./specialize.js";
import { findInstanceInScopeByName } from "./instance-resolver.js";

/**
 * The context extraction needs: a full MacroContext, since resolving a
 * companion path (`Point.Numeric`) goes through the instance resolver's scope
 * walk, which asks the `derived` macro whether a `derived<TC<T>>()` const
 * derived (and may try the derivation). Both transformer pipelines' contexts
 * are one.
 */
export type InstanceExtractionContext = MacroContext;

/** Alias/identifier chains longer than this bail out (cycle guard). */
const MAX_RESOLUTION_DEPTH = 5;

// ---------------------------------------------------------------------------
// Instance name extraction
// ---------------------------------------------------------------------------

/**
 * Get the instance dictionary name from a call-site argument expression.
 * Handles identifiers, property accesses (full dotted path for companion
 * paths, e.g. "Point.Eq"), parenthesized/as-wrapped forms, and zero-arg
 * factory calls (`eitherFunctor<E>()` → "eitherFunctor").
 */
export function getInstanceName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    // Return full dotted path for companion paths (e.g. "Point.Eq")
    const objName = getInstanceName(expr.expression);
    if (objName) {
      return `${objName}.${expr.name.text}`;
    }
    return expr.name.text;
  }
  if (ts.isParenthesizedExpression(expr)) {
    return getInstanceName(expr.expression);
  }
  if (ts.isAsExpression(expr)) {
    return getInstanceName(expr.expression);
  }
  if (ts.isCallExpression(expr) && expr.arguments.length === 0) {
    // Zero-arg factory instance: `eitherFunctor<E>()`. Type arguments are
    // erased, so every call yields the same methods — key by the factory name.
    return getInstanceName(expr.expression);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Acceptance criteria (@impl tag OR typeclass-shaped type annotation)
// ---------------------------------------------------------------------------

/**
 * Check if a declaration has @impl or @instance in its JSDoc.
 * Handles JSDoc on both the declaration and its parent statement.
 */
export function hasImplAnnotation(decl: ts.Declaration): boolean {
  const jsDocs = ts.getJSDocTags(decl);
  for (const tag of jsDocs) {
    if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
      return true;
    }
  }

  // JSDoc is often attached to the VariableStatement, not the declaration
  if (ts.isVariableDeclaration(decl)) {
    const parent = decl.parent?.parent;
    if (parent && ts.isVariableStatement(parent)) {
      const parentTags = ts.getJSDocTags(parent);
      for (const tag of parentTags) {
        if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Does this variable declaration carry a typeclass-shaped type annotation —
 * `const x: Functor<F> = …` (a PascalCase type reference with ≥1 type
 * argument)? Recognizes a typeclass instance for source-based inlining
 * WITHOUT an explicit `@impl` tag — and therefore without triggering the
 * `@impl` attribute macro's companion generation (PEP-052). Mirrors the
 * instance scanner's type-annotation discovery.
 */
export function hasTypeclassTypeAnnotation(varDecl: ts.VariableDeclaration | undefined): boolean {
  const typeNode = varDecl?.type;
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return false;
  if (!ts.isIdentifier(typeNode.typeName)) return false;
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(typeNode.typeName.text)) return false;
  return (typeNode.typeArguments?.length ?? 0) >= 1;
}

/**
 * Extract the brand (type name) from an @impl annotation.
 * E.g., @impl Functor<Array> → "Array".
 * Handles JSDoc on both the declaration and its parent statement.
 */
export function extractBrandFromImpl(decl: ts.Declaration): string | undefined {
  const extractFromTags = (tags: readonly ts.JSDocTag[]): string | undefined => {
    for (const tag of tags) {
      if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
        const comment =
          typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
        if (comment) {
          const extracted = extractTypeArgumentsContent(comment.trim());
          if (extracted !== undefined) return extracted;
        }
      }
    }
    return undefined;
  };

  const result = extractFromTags(ts.getJSDocTags(decl));
  if (result) return result;

  if (ts.isVariableDeclaration(decl)) {
    const parent = decl.parent?.parent;
    if (parent && ts.isVariableStatement(parent)) {
      return extractFromTags(ts.getJSDocTags(parent));
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Declaration resolution (aliases, identifier chains, factories, companions)
// ---------------------------------------------------------------------------

interface ResolvedInstanceLiteral {
  objLiteral: ts.ObjectLiteralExpression;
  /** The variable declaration carrying @impl/annotation/brand, if any. */
  varDecl?: ts.VariableDeclaration;
  /** The declaration to read @impl JSDoc from (var decl or factory function). */
  brandDecl: ts.Declaration;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    expr = expr.expression;
  }
  return expr;
}

/**
 * Resolve a symbol at a location, following import aliases to the original
 * declaration (PEP-053 Wave 2 gap 1 — cross-module instances resolve to their
 * ImportSpecifier without this, and extraction bails).
 */
function resolveAliasedSymbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      return undefined;
    }
  }
  return symbol;
}

/**
 * Is this a typeclass-shaped type reference (PascalCase, ≥1 type argument)?
 * Used for factory return-type acceptance: `(): Functor<EitherF<E>> => …`.
 */
function isTypeclassShapedTypeNode(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return false;
  if (!ts.isIdentifier(typeNode.typeName)) return false;
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(typeNode.typeName.text)) return false;
  return (typeNode.typeArguments?.length ?? 0) >= 1;
}

/**
 * If this function body is (or trivially returns) an object literal, return
 * it. Accepts a concise object-literal arrow body, or a block whose LAST
 * statement returns an object literal with only variable statements before it
 * (`const functor = eitherFunctor<E>(); return { map: functor.map, … }` —
 * indirect members resolve through the member resolver, so the bindings
 * themselves never need inlining).
 */
function objectLiteralFromFunctionBody(
  body: ts.ConciseBody | ts.Block | undefined
): ts.ObjectLiteralExpression | undefined {
  if (!body) return undefined;
  if (!ts.isBlock(body)) {
    const unwrapped = unwrapExpression(body);
    return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
  }
  const statements = body.statements;
  if (statements.length === 0) return undefined;
  for (let i = 0; i < statements.length - 1; i++) {
    if (!ts.isVariableStatement(statements[i])) return undefined;
  }
  const last = statements[statements.length - 1];
  if (!ts.isReturnStatement(last) || !last.expression) return undefined;
  const returned = unwrapExpression(last.expression);
  return ts.isObjectLiteralExpression(returned) ? returned : undefined;
}

/**
 * Resolve an instance expression to its defining object literal, chasing:
 * - import aliases (gap 1)
 * - zero-arg factory calls (gap 2)
 * - identifier-alias consts, `const stdFlatMapArray = flatMapArray` (gap 3)
 *
 * Acceptance (`@impl`/`@instance` tag OR typeclass-shaped type annotation —
 * gap 5's unified rule) may be satisfied anywhere along the alias chain.
 */
/** Is this variable declared `const` (so the binding itself can't be reassigned)? */
function isConstDeclaration(decl: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(decl.parent) && (decl.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

const mutatedObjectNamesCache = new WeakMap<ts.SourceFile, Set<string>>();

function baseIdentifierText(expr: ts.Expression): string | undefined {
  while (
    ts.isParenthesizedExpression(expr) ||
    ts.isPropertyAccessExpression(expr) ||
    ts.isElementAccessExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    expr = expr.expression;
  }
  return ts.isIdentifier(expr) ? expr.text : undefined;
}

const MUTATING_OBJECT_CALLS = new Set([
  "Object.assign",
  "Object.defineProperty",
  "Object.defineProperties",
  "Object.setPrototypeOf",
  "Reflect.set",
  "Reflect.defineProperty",
  "Reflect.deleteProperty",
]);

/**
 * Names (by text — deliberately coarse) of objects whose members are written
 * somewhere in this file: `x.m = …`, `x[k] = …`, `x.m++`, `delete x.m`,
 * `Object.assign(x, …)` and friends. Inlining a member of such an object
 * would freeze the ORIGINAL method body in place of whatever the object holds
 * at call time, so those objects are never treated as instances. (Mutation
 * from another module through an import is not detected — a documented
 * residual; typeclass instances are expected to be immutable.)
 */
function mutatedObjectNames(sf: ts.SourceFile): Set<string> {
  const cached = mutatedObjectNamesCache.get(sf);
  if (cached) return cached;
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const base = baseIdentifierText(node.left);
      if (base) names.add(base);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const base = baseIdentifierText(node.operand);
      if (base) names.add(base);
    } else if (ts.isDeleteExpression(node)) {
      const base = baseIdentifierText(node.expression);
      if (base) names.add(base);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      MUTATING_OBJECT_CALLS.has(
        `${node.expression.expression.text}.${node.expression.name.text}`
      ) &&
      node.arguments.length > 0
    ) {
      const base = baseIdentifierText(node.arguments[0]);
      if (base) names.add(base);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  mutatedObjectNamesCache.set(sf, names);
  return names;
}

/**
 * Could this declaration's object be changed after initialization, so that
 * its literal's method bodies no longer describe what a call does?
 */
function isPossiblyMutatedInstance(decl: ts.VariableDeclaration): boolean {
  if (!isConstDeclaration(decl)) return true;
  if (!ts.isIdentifier(decl.name)) return true;
  return mutatedObjectNames(decl.getSourceFile()).has(decl.name.text);
}

function resolveInstanceObjectLiteral(
  checker: ts.TypeChecker,
  expr: ts.Expression,
  depth: number,
  inheritedAccepted: boolean
): ResolvedInstanceLiteral | undefined {
  if (depth <= 0) return undefined;
  expr = unwrapExpression(expr);

  // Zero-arg factory call: `eitherFunctor<E>()`
  if (ts.isCallExpression(expr)) {
    if (expr.arguments.length !== 0) return undefined;
    const callee = unwrapExpression(expr.expression);
    if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) return undefined;
    const symbol = resolveAliasedSymbol(checker, callee);
    const declarations = symbol?.getDeclarations();
    if (!declarations) return undefined;

    for (const decl of declarations) {
      let fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined;
      let hostDecl: ts.Declaration = decl;
      if (ts.isFunctionDeclaration(decl)) {
        fn = decl;
      } else if (ts.isVariableDeclaration(decl) && decl.initializer) {
        const init = unwrapExpression(decl.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          fn = init;
          hostDecl = decl;
        }
      }
      if (!fn) continue;
      // Only value-parameter-free factories are safe: type parameters are
      // erased, but value parameters would be captured by the method bodies.
      if (fn.parameters.length !== 0) continue;

      const accepted =
        inheritedAccepted || hasImplAnnotation(hostDecl) || isTypeclassShapedTypeNode(fn.type);
      if (!accepted) continue;

      const objLiteral = objectLiteralFromFunctionBody(fn.body);
      if (!objLiteral) continue;

      return {
        objLiteral,
        brandDecl: hostDecl,
        varDecl: ts.isVariableDeclaration(hostDecl) ? hostDecl : undefined,
      };
    }
    return undefined;
  }

  if (!ts.isIdentifier(expr) && !ts.isPropertyAccessExpression(expr)) return undefined;

  const symbol = resolveAliasedSymbol(checker, expr);
  const declarations = symbol?.getDeclarations();
  if (!declarations) return undefined;

  for (const decl of declarations) {
    if (!ts.isVariableDeclaration(decl) || !decl.initializer) continue;

    const accepted =
      inheritedAccepted || hasImplAnnotation(decl) || hasTypeclassTypeAnnotation(decl);

    // A `let`/`var` binding can be reassigned and a mutated object no longer
    // matches its literal — neither is a sound inlining source.
    if (isPossiblyMutatedInstance(decl)) continue;

    const init = unwrapExpression(decl.initializer);
    if (ts.isObjectLiteralExpression(init)) {
      if (!accepted) continue;
      return { objLiteral: init, varDecl: decl, brandDecl: decl };
    }

    // Identifier-alias const (`const stdFlatMapArray = flatMapArray`) or a
    // const holding a factory call (`const inst = eitherFunctor<E>()`) —
    // chase the initializer.
    if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init) || ts.isCallExpression(init)) {
      const chased = resolveInstanceObjectLiteral(checker, init, depth - 1, accepted);
      if (chased) {
        // Prefer brand info from the outermost annotated declaration.
        if (accepted && (hasImplAnnotation(decl) || hasTypeclassTypeAnnotation(decl))) {
          return { ...chased, varDecl: decl, brandDecl: decl };
        }
        return chased;
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Indirect-member resolution (gap 4: `map: optionFunctor.map`, `{ map }`)
// ---------------------------------------------------------------------------

function dictMethodFromFunctionNode(
  node: ts.Node,
  hygiene: InstanceExtractionContext["hygiene"]
): DictMethod | undefined {
  if (
    !ts.isArrowFunction(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isFunctionDeclaration(node) &&
    !ts.isMethodDeclaration(node)
  ) {
    return undefined;
  }
  const params = node.parameters.map((p, i) => {
    if (ts.isIdentifier(p.name)) return p.name.text;
    return hygiene ? hygiene.mangleName(`param_${i}`) : `__param${i}`;
  });
  return { node: node as unknown as ts.Expression, params };
}

function makeMemberResolver(ctx: InstanceExtractionContext, depth: number): MemberMethodResolver {
  const checker = ctx.typeChecker;
  return (expr) => {
    if (depth <= 0) return undefined;
    try {
      // `map: optionFunctor.map` — resolve the referenced instance, then
      // splice in that method.
      if (ts.isPropertyAccessExpression(expr)) {
        const memberName = expr.name.text;
        const owner = resolveInstanceObjectLiteral(checker, expr.expression, depth - 1, true);
        if (!owner) return undefined;
        for (const prop of owner.objLiteral.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            if (prop.name.text !== memberName) continue;
            const init = unwrapExpression(prop.initializer);
            return dictMethodFromFunctionNode(init, ctx.hygiene);
          }
          if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
            if (prop.name.text !== memberName) continue;
            return dictMethodFromFunctionNode(prop, ctx.hygiene);
          }
        }
        return undefined;
      }

      // `map: mapOption` or shorthand `{ map }` — resolve the identifier to a
      // function declaration/const.
      if (ts.isIdentifier(expr)) {
        let symbol: ts.Symbol | undefined;
        if (expr.parent && ts.isShorthandPropertyAssignment(expr.parent)) {
          symbol = checker.getShorthandAssignmentValueSymbol(expr.parent) ?? undefined;
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
            try {
              symbol = checker.getAliasedSymbol(symbol);
            } catch {
              return undefined;
            }
          }
        } else {
          symbol = resolveAliasedSymbol(checker, expr);
        }
        const declarations = symbol?.getDeclarations();
        if (!declarations) return undefined;
        for (const decl of declarations) {
          if (ts.isFunctionDeclaration(decl) && decl.body) {
            return dictMethodFromFunctionNode(decl, ctx.hygiene);
          }
          if (ts.isVariableDeclaration(decl) && decl.initializer) {
            const init = unwrapExpression(decl.initializer);
            const method = dictMethodFromFunctionNode(init, ctx.hygiene);
            if (method) return method;
          }
        }
        return undefined;
      }
    } catch {
      // TypeChecker may throw on unresolvable symbols — skip this member
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Cross-module safety: free-identifier scan
// ---------------------------------------------------------------------------

function isNodeWithin(node: ts.Node, container: ts.Node): boolean {
  return (
    node.getSourceFile() === container.getSourceFile() &&
    node.pos >= container.pos &&
    node.end <= container.end
  );
}

/** Is this declaration at module scope (no enclosing function-like)? */
function isModuleScopeDeclaration(decl: ts.Declaration): boolean {
  let node: ts.Node | undefined = decl.parent;
  while (node && !ts.isSourceFile(node)) {
    if (ts.isFunctionLike(node)) return false;
    node = node.parent;
  }
  return true;
}

/**
 * A method body lifted out of its declaration is only safe to inline if every
 * identifier it references resolves to a global/ambient declaration, a binding
 * inside the method itself, or (for same-module extraction) a module-scope
 * binding of the call site's own file. Everything else would dangle after
 * inlining:
 * - cross-module: the instance module's local helpers or imports
 *   (flatMapIterable's `iterableMap`, effect instances' `Effect.map`)
 * - any module: factory-local bindings (`const functor = eitherFunctor<E>()`
 *   inside a factory body) — those exist only inside the factory, never at
 *   the call site's module scope.
 * Unsafe methods are dropped so the call falls back to dictionary passing.
 *
 * Also unsafe: bodies that depend on their receiver/activation (`this`,
 * `super`, `arguments`, `new.target`, own `await`/`yield`; async/generator
 * methods) — `this.state` means something else at the call site (tc#2).
 *
 * On success returns the symbols the body's outside references resolve to
 * here, keyed by name, so each call site can verify the same names resolve to
 * the same symbols there (tc#18). Returns undefined when unsafe.
 */
/**
 * Is `node` a call (or tagged template) of a macro: a callee named like a
 * registered expression or tagged-template macro that is not a declaration of
 * the user's own (it is imported, declared only in a `.d.ts`, or unresolved)?
 * A false positive only costs an inlining: the method is then called through
 * its dictionary, which is always correct.
 */
function callsMacro(checker: ts.TypeChecker, node: ts.Node): boolean {
  const callee = ts.isCallExpression(node)
    ? node.expression
    : ts.isTaggedTemplateExpression(node)
      ? node.tag
      : undefined;
  if (!callee || !ts.isIdentifier(callee)) return false;
  const name = callee.text;
  if (
    globalRegistry.getCandidates(name, "expression").length === 0 &&
    globalRegistry.getCandidates(name, "tagged-template").length === 0
  ) {
    return false;
  }
  // A synthetic callee is outside the checker's contract (CLAUDE.md): by name.
  if (isSyntheticNode(callee)) return true;
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(callee);
  } catch {
    return true; // can't tell: treat it as the macro
  }
  if (!symbol || symbol.flags & ts.SymbolFlags.Alias) return true;
  const decls = symbol.getDeclarations() ?? [];
  return decls.length === 0 || decls.every((d) => d.getSourceFile().isDeclarationFile);
}

/**
 * Does `node` (an instance method's body) contain a macro call? Such a method
 * is never inlined from its source: see {@link callsMacro}.
 */
export function containsMacroCall(checker: ts.TypeChecker, node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || ts.isTypeNode(n)) return;
    if (callsMacro(checker, n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isSafeToInlineMethod(
  checker: ts.TypeChecker,
  methodNode: ts.Node,
  allowModuleScopeOf: ts.SourceFile | undefined
): Map<string, ts.Symbol> | undefined {
  if (methodDependsOnReceiver(methodNode)) return undefined;

  let safe = true;
  const freeSymbols = new Map<string, ts.Symbol>();

  const checkIdentifier = (id: ts.Identifier, shorthand?: ts.ShorthandPropertyAssignment): void => {
    let symbol: ts.Symbol | undefined;
    try {
      symbol = shorthand
        ? checker.getShorthandAssignmentValueSymbol(shorthand)
        : checker.getSymbolAtLocation(id);
    } catch {
      safe = false;
      return;
    }
    const declarations = symbol?.getDeclarations();
    if (!symbol || !declarations || declarations.length === 0) return; // e.g. `undefined`
    if (declarations.every((d) => isNodeWithin(d, methodNode))) return; // method-local
    freeSymbols.set(id.text, symbol);
    for (const decl of declarations) {
      if (decl.getSourceFile().isDeclarationFile) continue; // lib/ambient
      if (isNodeWithin(decl, methodNode)) continue; // method-local binding
      if (
        allowModuleScopeOf &&
        decl.getSourceFile() === allowModuleScopeOf &&
        isModuleScopeDeclaration(decl)
      ) {
        continue; // same-module top-level binding — in scope at the call site
      }
      safe = false;
      return;
    }
  };

  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (ts.isTypeNode(node)) return; // types are erased
    if (callsMacro(checker, node)) {
      // The transformer expands this call in the instance's OWN file; the
      // source is what was written, not what runs. Inlining it would copy the
      // raw macro call (`summon<Clone<Tree>>()`) into the call site, where it
      // is never expanded and throws at run time.
      safe = false;
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression); // `.name` resolves to a type member — skip it
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) visit(node.name);
      visit(node.initializer);
      return;
    }
    if (ts.isMethodDeclaration(node)) {
      // Skip the name; visit params (defaults) and body
      node.parameters.forEach(visit);
      if (node.body) visit(node.body);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      // `{ helper }` — the name IS a value reference
      checkIdentifier(node.name, node);
      if (node.objectAssignmentInitializer) visit(node.objectAssignmentInitializer);
      return;
    }
    if (ts.isIdentifier(node)) {
      checkIdentifier(node);
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(methodNode);
  return safe ? freeSymbols : undefined;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

function computeBrand(
  resolved: ResolvedInstanceLiteral,
  fallback: string,
  currentSourceFile: ts.SourceFile
): string {
  let brand = extractBrandFromImpl(resolved.brandDecl);

  const varDecl = resolved.varDecl;
  if (!brand && varDecl?.type) {
    try {
      const declFile = varDecl.getSourceFile() ?? currentSourceFile;
      if (ts.isTypeReferenceNode(varDecl.type) && varDecl.type.typeArguments) {
        const firstTypeArg = varDecl.type.typeArguments[0];
        if (firstTypeArg) {
          brand = firstTypeArg.getText(declFile);
        }
      }
      if (!brand) {
        const typeStr = varDecl.type.getText(declFile);
        const extracted = extractTypeArgumentsContent(typeStr);
        if (extracted) {
          brand = extracted;
        }
      }
    } catch {
      // getText() may fail on synthetic nodes — fall through to name fallback
    }
  }

  // NOTE: factory return-type annotations (`(): EitherFunctor<E>`) are NOT
  // mined for a brand — their first type argument is a bare type parameter
  // ("E"), which would collide across factories and poison the
  // specialization cache key. The instance name is unique; use it.
  return brand ?? fallback;
}

const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;

/**
 * Companion-path fallback (gap 6): `Point.Numeric` has no declaration in the
 * checker's program (companions are emitted at transform time), so resolve it
 * by scope — the same machinery method sugar trusts — to the generating
 * instance const, then extract from that declaration.
 */
function resolveCompanionInstanceExpression(
  ctx: InstanceExtractionContext,
  expr: ts.PropertyAccessExpression
): ts.Expression | undefined {
  if (!ts.isIdentifier(expr.expression)) return undefined;
  const typeName = expr.expression.text;
  const tcName = expr.name.text;
  if (!PASCAL_CASE.test(typeName) || !PASCAL_CASE.test(tcName)) return undefined;

  const hit = findInstanceInScopeByName(ctx, tcName, typeName);
  if (!hit) return undefined;

  const file = hit.modulePath ? ctx.program.getSourceFile(hit.modulePath) : ctx.sourceFile;
  if (!file) return undefined;

  // Find the top-level declaration named exportName in the defining file.
  for (const stmt of file.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === hit.exportName && decl.initializer) {
        return decl.name;
      }
    }
  }
  return undefined;
}

/**
 * Try to extract instance methods from source for auto-specialization.
 *
 * Accepts instances that are `@impl`/`@instance`-annotated OR carry a
 * typeclass-shaped type annotation (`const x: Functor<F> = {...}`); resolves
 * across import aliases, identifier-alias consts, zero-arg factories, and
 * companion paths. Successful extractions are registered in the
 * specialization registry (so subsequent calls hit the cache) and returned.
 */
export function tryExtractInstanceFromSource(
  ctx: InstanceExtractionContext,
  argExpr: ts.Expression
): DictMethodMap | undefined {
  const argName = getInstanceName(argExpr);
  if (!argName) return undefined;

  try {
    const checker = ctx.typeChecker;
    let resolved = resolveInstanceObjectLiteral(checker, argExpr, MAX_RESOLUTION_DEPTH, false);

    if (!resolved) {
      const unwrapped = unwrapExpression(argExpr);
      if (ts.isPropertyAccessExpression(unwrapped)) {
        const companionConst = resolveCompanionInstanceExpression(ctx, unwrapped);
        if (companionConst) {
          // The scanner already vetted this as an instance (impl-tag or
          // type-annotation) — acceptance is inherited.
          resolved = resolveInstanceObjectLiteral(
            checker,
            companionConst as ts.Expression,
            MAX_RESOLUTION_DEPTH,
            true
          );
        }
      }
    }

    if (!resolved) return undefined;

    const brand = computeBrand(resolved, argName, ctx.sourceFile);
    const memberResolver = makeMemberResolver(ctx, MAX_RESOLUTION_DEPTH);
    const extracted = extractMethodsFromObjectLiteral(
      resolved.objLiteral,
      ctx.hygiene,
      memberResolver
    );
    if (extracted.size === 0) return undefined;

    const methods = new Map<string, DictMethod>();
    for (const [name, method] of extracted) {
      if (!method.node) {
        methods.set(name, method);
        continue;
      }
      // Judge each method by its own source file (indirect members can come
      // from a different file than the object literal itself). Same-module
      // methods may additionally reference the file's module-scope bindings —
      // those are in scope at the call site; factory-local bindings are not,
      // in any module.
      const methodFile = method.node.getSourceFile();
      const allowModuleScopeOf = methodFile === ctx.sourceFile ? ctx.sourceFile : undefined;
      const freeSymbols = isSafeToInlineMethod(checker, method.node, allowModuleScopeOf);
      if (!freeSymbols) {
        continue; // falls back to dictionary passing — always correct
      }
      // Clone so downstream inlining (which strips positions/comments
      // in place) can never corrupt the defining file's AST.
      methods.set(name, { ...method, node: cloneNodeDeep(method.node), freeSymbols });
    }

    if (methods.size > 0) {
      registerInstanceMethodsFromAST(argName, brand, methods, ctx.program);
      return { brand, methods };
    }
  } catch {
    // TypeChecker or AST traversal may throw — fall back to registry lookup
  }

  return undefined;
}
