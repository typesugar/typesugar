/**
 * Shared AST utility functions for macro implementations.
 *
 * This module consolidates common AST manipulation helpers that were previously
 * duplicated across multiple macro files.
 */

import ts from "typescript";
import type { MacroContext } from "./types.js";
import { evaluateConfigCondition } from "./config-condition.js";

// =============================================================================
// hasExportModifier — Check for `export` keyword on a node
// =============================================================================

/**
 * Check if a node has an `export` modifier.
 */
export function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

// =============================================================================
// stripDecorator — Remove a specific decorator from a declaration
// =============================================================================

/**
 * Strip a decorator from a declaration, preserving other decorators and modifiers.
 *
 * Handles: MethodDeclaration, PropertyDeclaration, ClassDeclaration,
 * FunctionDeclaration, VariableStatement.
 */
export function stripDecorator(
  ctx: MacroContext,
  target: ts.Declaration,
  decoratorToRemove: ts.Decorator
): ts.Node {
  if (!ts.canHaveDecorators(target)) return target;

  const existingDecorators = ts.getDecorators(target);
  if (!existingDecorators) return target;

  const remainingDecorators = existingDecorators.filter((d) => d !== decoratorToRemove);

  const existingModifiers = ts.canHaveModifiers(target) ? ts.getModifiers(target) : undefined;

  const newModifiers = [...remainingDecorators, ...(existingModifiers ?? [])];

  if (ts.isMethodDeclaration(target)) {
    return ctx.factory.updateMethodDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.asteriskToken,
      target.name,
      target.questionToken,
      target.typeParameters,
      target.parameters,
      target.type,
      target.body
    );
  }

  if (ts.isPropertyDeclaration(target)) {
    return ctx.factory.updatePropertyDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.name,
      target.questionToken ?? target.exclamationToken,
      target.type,
      target.initializer
    );
  }

  if (ts.isClassDeclaration(target)) {
    return ctx.factory.updateClassDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.name,
      target.typeParameters,
      target.heritageClauses,
      target.members
    );
  }

  // Cast to avoid TypeScript's overly-aggressive narrowing to `never`
  // (ts.Declaration includes more types than we explicitly handle above)
  const maybeNode = target as ts.Node;

  if (ts.isVariableStatement(maybeNode)) {
    return ctx.factory.updateVariableStatement(
      maybeNode,
      newModifiers.length > 0 ? newModifiers : undefined,
      maybeNode.declarationList
    );
  }

  const maybeFunc = maybeNode as ts.Declaration;
  if (ts.isFunctionDeclaration(maybeFunc)) {
    return ctx.factory.updateFunctionDeclaration(
      maybeFunc,
      newModifiers.length > 0 ? newModifiers : undefined,
      maybeFunc.asteriskToken,
      maybeFunc.name,
      maybeFunc.typeParameters,
      maybeFunc.parameters,
      maybeFunc.type,
      maybeFunc.body
    );
  }

  return target;
}

// =============================================================================
// isSyntheticNode — Detect synthetic (position-less) AST nodes
// =============================================================================

/**
 * Whether a node is synthetic — generated or cloned by the transformer rather
 * than parsed from source text. Synthetic nodes have no valid source
 * position (`pos`/`end` are `-1`, the convention `stripPositions` and
 * `ts.setTextRange`-based node construction both rely on), so operations that
 * need real source text or trivia (comment scanning, `getText()`,
 * position-based diagnostics) must skip them or fall back to the printer.
 */
export function isSyntheticNode(node: ts.Node): boolean {
  return node.pos < 0 || node.end < 0;
}

/**
 * Whether a node is backed by real source text, i.e. it was produced by the
 * parser (not the node factory) and has a valid position.
 *
 * Stricter than `!isSyntheticNode(node)`: a factory node that was given a real
 * text range with `ts.setTextRange` (JSDoc-derived decorators, every node
 * `visitEachChild`/`factory.update*` rebuilt) has real positions, so
 * `isSyntheticNode` is false, yet `node.getText()` throws on it because it has
 * no parent chain to a source file (deep review core #48). Use this before
 * `getText()`/`getStart()` without an explicit source file. `isSyntheticNode`
 * stays the positions-only check, because the transformer relies on a
 * range-carrying rebuilt node still being expandable, and the checker maps such
 * nodes back to their parse-tree original itself.
 */
export function hasSourceText(node: ts.Node): boolean {
  return !isSyntheticNode(node) && ts.isParseTreeNode(node);
}

// =============================================================================
// forEachDescendant — whole-tree walks without one stack frame per level
// =============================================================================

/**
 * Call `fn` on `root` and each of its descendants, in the order a recursive
 * `ts.forEachChild` walk visits them (pre-order, children in source order),
 * with an explicit stack instead of one recursion per level. A recursive walk
 * over a whole file overflows the call stack on a deep expression (a
 * 5,000-term `"a" + "b" + ...` chain is 5,000 levels deep), which tsc itself
 * handles. `fn` returning `false` skips that node's children.
 */
export function forEachDescendant(root: ts.Node, fn: (node: ts.Node) => boolean | void): void {
  const stack: ts.Node[] = [root];
  const children: ts.Node[] = [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (fn(node) === false) continue;
    children.length = 0;
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

// =============================================================================
// stripPositions — Mark AST nodes as synthetic
// =============================================================================

/**
 * Recursively mark AST nodes as synthetic by setting positions to -1.
 *
 * MUTATES `node` and its descendants in place. Only use it on nodes you own
 * (freshly parsed or built); for the user's real AST (e.g. call-site
 * arguments) use {@link cloneWithoutPositions}.
 *
 * Useful when creating or cloning nodes that should not be associated
 * with specific source positions.
 */
export function stripPositions<T extends ts.Node>(node: T): T {
  ts.setTextRange(node, { pos: -1, end: -1 });
  // forEachChild, not visitEachChild: it also reaches TOKEN children (`?`,
  // `:`, `=>`, operators), which visitEachChild without a tokenVisitor skips --
  // those kept their temp-file offsets, and the printer emitted the user's
  // comments found at the same offsets in the real file.
  // NodeArrays too: the printer places a list's closing token (and the
  // comments before it) by the ARRAY's `end`, so an empty argument list
  // (`v.slice()`) printed whatever comment the real file had at that offset.
  ts.forEachChild(
    node,
    (child) => {
      stripPositions(child);
    },
    (children) => {
      ts.setTextRange(children, { pos: -1, end: -1 });
      children.forEach((child) => stripPositions(child));
    }
  );
  return node;
}

/**
 * Deep-clone an AST subtree into fresh synthetic nodes (pos/end -1, comment
 * ranges cleared).
 *
 * stripPositions/stripCommentsDeep MUTATE the nodes they are given. That is
 * fine for nodes we own, but extraction may lift method bodies out of a
 * DIFFERENT source file (cross-module instance extraction); mutating those
 * would corrupt the other file's AST for its own emit. Clone first, then the
 * clone can be freely mutated downstream.
 */
export function cloneNodeDeep<T extends ts.Node>(node: T): T {
  // The tokenVisitor clones token children (`?`, `=>`, operators) too, so no
  // token keeps an offset into the file it came from (see stripPositions).
  let clone = ts.visitEachChild(
    node,
    (child) => cloneNodeDeep(child),
    undefined as unknown as ts.TransformationContext,
    undefined,
    (token) => cloneNodeDeep(token)
  ) as T;
  if (clone === node) {
    // Leaf node (no children were replaced) — force a shallow clone.
    // factory.cloneNode exists at runtime but is missing from the public
    // NodeFactory typings.
    clone = (ts.factory as unknown as { cloneNode<U extends ts.Node>(n: U): U }).cloneNode(node);
  }
  ts.setTextRange(clone, { pos: -1, end: -1 });
  ts.setCommentRange(clone, { pos: -1, end: -1 });
  ts.setSyntheticLeadingComments(clone, undefined);
  ts.setSyntheticTrailingComments(clone, undefined);
  // factory.update* (used by visitEachChild) links clones back to their
  // originals; sever that so the printer never consults the foreign file.
  ts.setOriginalNode(clone, undefined);
  return clone;
}

/**
 * Deep-clone `node` into fresh nodes, keeping each clone's `original` link to
 * the node it copies (unlike {@link cloneNodeDeep}, which severs it). Keeping
 * the link matters for nodes from the CURRENT file: TypeScript's emit
 * substitutions (CommonJS `exports.x`/`module_1.x` renaming, import elision)
 * find the declaration through `ts.getParseTreeNode(clone)`.
 */
function cloneKeepingOriginal<T extends ts.Node>(node: T): T {
  let clone = ts.visitEachChild(
    node,
    (child) => cloneKeepingOriginal(child),
    undefined as unknown as ts.TransformationContext
  ) as T;
  if (clone === node) {
    clone = (ts.factory as unknown as { cloneNode<U extends ts.Node>(n: U): U }).cloneNode(node);
  }
  ts.setOriginalNode(clone, node);
  return clone;
}

/**
 * Non-mutating {@link stripPositions}: returns a synthetic deep copy (pos/end
 * -1) and leaves `node` — typically the user's real argument node — untouched.
 * Each copy keeps an `original` link to its source node.
 */
export function cloneWithoutPositions<T extends ts.Node>(node: T): T {
  return stripPositions(cloneKeepingOriginal(node));
}

/**
 * Non-mutating {@link stripCommentsDeep}: returns a synthetic, comment-free deep
 * copy and leaves `node` untouched. Each copy keeps an `original` link to its
 * source node.
 */
export function cloneWithoutComments<T extends ts.Node>(node: T): T {
  return stripCommentsDeep(cloneKeepingOriginal(node));
}

/**
 * Recursively strip all comment and position information from an AST subtree.
 *
 * Goes further than stripPositions: also clears comment ranges and synthetic
 * comment arrays to prevent TypeScript's printer from emitting stray comments
 * when real-position nodes are mixed with synthetic ones (e.g. after inlining
 * a macro-generated template with call-site argument nodes).
 *
 * MUTATES `node` and its descendants in place. For the user's real AST use
 * {@link cloneWithoutComments}.
 */
export function stripCommentsDeep<T extends ts.Node>(node: T): T {
  ts.setTextRange(node, { pos: -1, end: -1 });
  ts.setCommentRange(node, { pos: -1, end: -1 });
  ts.setSyntheticLeadingComments(node, undefined);
  ts.setSyntheticTrailingComments(node, undefined);
  // forEachChild reaches token children too (see stripPositions).
  ts.forEachChild(node, (child) => {
    stripCommentsDeep(child);
  });
  return node;
}

// =============================================================================
// jsValueToExpression — Convert runtime JS values to AST expressions
// =============================================================================

/**
 * Context interface for jsValueToExpression (subset of MacroContext).
 */
export interface JsValueContext {
  factory: ts.NodeFactory;
  reportError(node: ts.Node, message: string): void;
}

/**
 * Build an expression for a number, including the values that are not numeric
 * literals: negatives (and `-0`) need a prefix minus, `NaN`/`Infinity` are
 * identifiers. `factory.createNumericLiteral(-1)` asserts (deep review core #31).
 */
export function numberToExpression(factory: ts.NodeFactory, value: number): ts.Expression {
  if (Number.isNaN(value)) return factory.createIdentifier("NaN");
  if (value < 0 || Object.is(value, -0)) {
    return factory.createPrefixUnaryExpression(
      ts.SyntaxKind.MinusToken,
      numberToExpression(factory, -value)
    );
  }
  if (value === Infinity) return factory.createIdentifier("Infinity");
  return factory.createNumericLiteral(value);
}

/**
 * Build an expression for a bigint. `createBigIntLiteral` wants the source text
 * INCLUDING the `n` suffix; `value.toString()` alone prints a plain number.
 */
export function bigintToExpression(factory: ts.NodeFactory, value: bigint): ts.Expression {
  if (value < 0n) {
    return factory.createPrefixUnaryExpression(
      ts.SyntaxKind.MinusToken,
      factory.createBigIntLiteral(`${-value}n`)
    );
  }
  return factory.createBigIntLiteral(`${value}n`);
}

/** `Object.prototype.toString` tag — works across realms (comptime runs in a vm context). */
function toStringTag(value: object): string {
  return Object.prototype.toString.call(value);
}

/**
 * Whether `value` is a plain object (`{}` literal or `Object.create(null)`) in
 * ANY realm — `instanceof`/prototype identity checks fail for values coming out
 * of comptime's `vm` context.
 */
function isPlainObject(value: object): boolean {
  if (toStringTag(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/**
 * Convert a JavaScript value to a TypeScript AST expression.
 *
 * Handles: null, undefined, numbers (including negative, `-0`, Infinity, NaN),
 * strings, booleans, bigint, arrays, RegExp, Date, Map, Set and plain objects —
 * including values created in another realm (comptime's `vm` context).
 *
 * Anything else (functions, symbols, class instances, typed arrays, circular
 * structures) is reported via `ctx.reportError` and emitted as `undefined`,
 * never silently turned into `{}` (deep review core #30).
 *
 * @param ctx - Context providing factory and error reporting
 * @param value - The JS value to convert
 * @param errorNode - Node to report errors against (for non-serializable values)
 */
export function jsValueToExpression(
  ctx: JsValueContext,
  value: unknown,
  errorNode: ts.Node
): ts.Expression {
  return valueToExpression(ctx, value, errorNode, new Set());
}

function valueToExpression(
  ctx: JsValueContext,
  value: unknown,
  errorNode: ts.Node,
  inProgress: Set<object>
): ts.Expression {
  const f = ctx.factory;
  const fail = (what: string): ts.Expression => {
    ctx.reportError(errorNode, `Cannot serialize ${what} to AST`);
    return f.createIdentifier("undefined");
  };

  if (value === null) return f.createNull();
  if (value === undefined) return f.createIdentifier("undefined");
  if (typeof value === "number") return numberToExpression(f, value);
  if (typeof value === "string") return f.createStringLiteral(value);
  if (typeof value === "boolean") return value ? f.createTrue() : f.createFalse();
  if (typeof value === "bigint") return bigintToExpression(f, value);
  if (typeof value !== "object") return fail(`value of type ${typeof value}`);

  if (inProgress.has(value)) return fail("a circular structure");
  inProgress.add(value);
  try {
    const recurse = (v: unknown) => valueToExpression(ctx, v, errorNode, inProgress);
    const tag = toStringTag(value);

    if (Array.isArray(value)) {
      return f.createArrayLiteralExpression(value.map(recurse));
    }

    if (tag === "[object RegExp]") {
      const re = value as RegExp;
      return f.createNewExpression(f.createIdentifier("RegExp"), undefined, [
        f.createStringLiteral(re.source),
        f.createStringLiteral(re.flags),
      ]);
    }

    if (tag === "[object Date]") {
      return f.createNewExpression(f.createIdentifier("Date"), undefined, [
        numberToExpression(f, (value as Date).getTime()),
      ]);
    }

    if (tag === "[object Map]") {
      const entries = [...(value as Map<unknown, unknown>)].map(([k, v]) =>
        f.createArrayLiteralExpression([recurse(k), recurse(v)])
      );
      return f.createNewExpression(f.createIdentifier("Map"), undefined, [
        f.createArrayLiteralExpression(entries),
      ]);
    }

    if (tag === "[object Set]") {
      return f.createNewExpression(f.createIdentifier("Set"), undefined, [
        f.createArrayLiteralExpression([...(value as Set<unknown>)].map(recurse)),
      ]);
    }

    if (!isPlainObject(value)) {
      const ctorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
      return fail(
        `an instance of ${typeof ctorName === "string" && ctorName ? ctorName : tag.slice(8, -1)}`
      );
    }

    const properties: ts.PropertyAssignment[] = [];
    for (const [key, val] of Object.entries(value)) {
      const name =
        key === "__proto__"
          ? // `{ __proto__: x }` sets the prototype; a computed key makes an own property.
            f.createComputedPropertyName(f.createStringLiteral(key))
          : /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
            ? f.createIdentifier(key)
            : f.createStringLiteral(key);
      properties.push(f.createPropertyAssignment(name, recurse(val)));
    }
    return f.createObjectLiteralExpression(properties, true);
  } finally {
    inProgress.delete(value);
  }
}

// =============================================================================
// Shared printer and dummy source file utilities
// =============================================================================

let sharedPrinter: ts.Printer | undefined;
let sharedDummySourceFile: ts.SourceFile | undefined;

/**
 * Get a shared printer instance for converting AST nodes to source text.
 */
export function getPrinter(): ts.Printer {
  return (sharedPrinter ??= ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  }));
}

/**
 * Get a dummy source file for printing synthetic nodes.
 *
 * When printing nodes that were created synthetically (not parsed from a file),
 * a source file context is still required by the printer.
 */
export function getDummySourceFile(): ts.SourceFile {
  return (sharedDummySourceFile ??= ts.createSourceFile(
    "__ast_utils_temp__.ts",
    "",
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  ));
}

/**
 * Print a node to source text, handling synthetic nodes that lack source positions.
 *
 * @param node - The AST node to print
 * @param sourceFile - Optional source file context (uses dummy if not provided)
 */
export function printNode(node: ts.Node, sourceFile?: ts.SourceFile): string {
  const printer = getPrinter();
  const sf = sourceFile ?? getDummySourceFile();

  if (ts.isExpression(node)) {
    return printer.printNode(ts.EmitHint.Expression, node, sf);
  }
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

// =============================================================================
// Condition expression evaluation helpers
// =============================================================================

/**
 * Split an expression on a top-level operator (not inside parentheses).
 */
export function splitTopLevel(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;

    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = "";
      i += op.length - 1;
    } else {
      current += expr[i];
    }
  }

  parts.push(current);
  return parts;
}

/**
 * Find the index of the matching closing parenthesis.
 */
export function findMatchingParen(expr: string, start: number): number {
  let depth = 0;
  for (let i = start; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Get a nested value from an object using dot notation.
 *
 * @example
 * getNestedValue({ a: { b: 1 } }, "a.b") // => 1
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.trim().split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a condition expression against a configuration object.
 *
 * Delegates to the shared condition grammar in `config-condition.ts`
 * (`&&`, `||`, `!`, parentheses, `==`/`===`/`!=`/`!==` against quoted strings,
 * numbers and keywords, dotted-path truthiness). A condition outside the
 * grammar THROWS `ConfigConditionError` rather than silently evaluating to
 * false and stripping code (deep review core #16).
 *
 * @param expr - The condition expression (e.g., "debug && platform === 'node'")
 * @param config - Configuration object to evaluate against
 */
export function evaluateConditionExpr(expr: string, config: Record<string, unknown>): boolean {
  return evaluateConfigCondition(expr, (p) => getNestedValue(config, p));
}

// =============================================================================
// Remove Expression — sentinel for statement-level macro erasure
// =============================================================================

const REMOVE_BRAND = "__typesugar_remove__";
const REMOVE_COMMENT = "__typesugar_remove_comment__";

/**
 * Create a `void 0` expression branded as a removal sentinel.
 *
 * Expression macros that act as statements (staticAssert, compileError, etc.)
 * return this instead of `undefined`. The transformer recognises the brand and
 * replaces the enclosing ExpressionStatement with a comment (if provided)
 * or strips it entirely.
 *
 * @param comment — optional replacement comment (e.g. `staticAssert("msg") ✓`)
 */
export function createRemoveExpression(
  factory: ts.NodeFactory,
  comment?: string
): ts.VoidExpression {
  const node = factory.createVoidExpression(factory.createNumericLiteral(0));
  (node as any)[REMOVE_BRAND] = true;
  if (comment) {
    (node as any)[REMOVE_COMMENT] = comment;
  }
  return node;
}

/**
 * Check whether a node is a removal sentinel created by `createRemoveExpression`.
 */
export function isRemoveExpression(node: ts.Node): boolean {
  return (node as any)[REMOVE_BRAND] === true;
}

/**
 * Get the replacement comment from a removal sentinel, if any.
 */
export function getRemoveComment(node: ts.Node): string | undefined {
  return (node as any)[REMOVE_COMMENT];
}

// =============================================================================
// isJSDocTagAtLineStart — real JSDoc tags vs. prose and fenced examples
// =============================================================================

/**
 * Whether a JSDoc tag sits at a real tag position: the `@` starts its comment
 * line (only whitespace and the leading `*` before it, or only whitespace
 * after `/**` on the comment's first line), and the line is not inside a
 * ``` / ~~~ code fence within that comment. A line-start tag after an
 * `@example`'s unfenced lines is real: JSDoc ends the example there.
 *
 * TypeScript's JSDoc parser treats any whitespace-preceded `@word` as a tag,
 * so prose ("Parsed from @adt tag."), nested example comments
 * (` * /** @hkt *\/`) and fenced examples (` * @derive(Read)` between ```)
 * all come back from `ts.getJSDocTags`. Those must not dispatch macros.
 *
 * A tag with no real source position (synthetic) is accepted, as before.
 */
export function isJSDocTagAtLineStart(tag: ts.JSDocTag): boolean {
  if (tag.pos < 0) return true;
  let jsDoc: ts.Node | undefined = tag.parent;
  while (jsDoc && jsDoc.kind !== ts.SyntaxKind.JSDoc) jsDoc = jsDoc.parent;
  let root: ts.Node | undefined = jsDoc;
  while (root && root.kind !== ts.SyntaxKind.SourceFile) root = root.parent;
  if (!jsDoc || !root || jsDoc.pos < 0) return true;
  const text = (root as ts.SourceFile).text;
  const commentStart = jsDoc.pos;
  const tagPos = tag.pos;
  if (text.charCodeAt(tagPos) !== 64 /* @ */) return true;

  // Prefix of the tag's own line.
  const lineStart = text.lastIndexOf("\n", tagPos - 1) + 1;
  const prefix =
    lineStart <= commentStart
      ? text.slice(commentStart, tagPos).replace(/^\/\*\*/, "")
      : text.slice(lineStart, tagPos).replace(/^[ \t]*\*/, "");
  if (!/^[ \t]*$/.test(prefix)) return false;

  // Code-fence state over the comment lines BEFORE the tag's line.
  let inFence = false;
  const before = text.slice(commentStart, lineStart);
  for (const rawLine of before.split("\n")) {
    const line = rawLine
      .replace(/^[ \t]*\/\*\*/, "")
      .replace(/^[ \t]*\*/, "")
      .trimStart();
    if (line.startsWith("```") || line.startsWith("~~~")) inFence = !inFence;
  }
  // Not inside a fence: a real tag, even after an `@example` tag. In JSDoc an
  // `@example`'s content ends at the next line-start tag (TypeScript parses
  // it that way and an IDE renders it as a tag), so only a fence makes a
  // line-start `@derive` example code. Treating every tag after `@example`
  // as code silently dropped a real `@derive`/`@impl`/`@typeclass` written
  // below an example.
  return !inFence;
}

// =============================================================================
// opaqueTypesAsUnderlying — the runtime view of @opaque types, for type-checking expanded output
// =============================================================================

/**
 * `text` with each `/** @opaque U *\/ interface T<…> { … }` declaration
 * replaced by `type T<…> = U;`: the view of `@opaque` types the EXPANDED code
 * is written against. Expansion erases `Some(x)` to `x` and `opt.map(f)` to
 * `map(opt, f)`, so in expanded code an `Option<number>` is a `number | null`
 * wherever it appears (a parameter, a variable, a return, a property, a type
 * argument), and the companions that take one take that. Checking expanded
 * code against the interface reported every such position as an error (or,
 * where an annotation had been stripped to avoid that, typed the value as the
 * raw payload, or `any` for a parameter, and changed the declarations emitted
 * from the expanded program).
 *
 * Used only to serve source text to a checker of expanded output
 * (`strictOutput`, `typesugar build --strict`); nothing is emitted from it.
 * Text in, text out, because a compiler host serves text: each replacement is
 * padded to the declaration's length with the same number of line breaks, so
 * every diagnostic position after it is unchanged. Returns `text` itself when
 * there is no `@opaque` interface.
 */
export function opaqueTypesAsUnderlying(fileName: string, text: string): string {
  if (!text.includes("@opaque")) return text;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const visitStatements = (statements: readonly ts.Statement[]): void => {
    for (const stmt of statements) {
      if (ts.isModuleDeclaration(stmt) && stmt.body && ts.isModuleBlock(stmt.body)) {
        visitStatements(stmt.body.statements);
        continue;
      }
      if (!ts.isInterfaceDeclaration(stmt)) continue;
      const underlying = opaqueTagText(stmt);
      if (!underlying) continue;
      const start = stmt.getStart(sourceFile);
      const keywords = (ts.getModifiers(stmt) ?? [])
        .filter(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DeclareKeyword
        )
        .map((m) => m.getText(sourceFile) + " ")
        .join("");
      const params = stmt.typeParameters
        ? `<${stmt.typeParameters.map((p) => p.getText(sourceFile)).join(", ")}>`
        : "";
      edits.push({
        start,
        end: stmt.end,
        text: `${keywords}type ${stmt.name.text}${params} = ${underlying};`,
      });
    }
  };
  visitStatements(sourceFile.statements);
  if (edits.length === 0) return text;

  let out = text;
  for (const edit of edits.reverse()) {
    const original = out.slice(edit.start, edit.end);
    const lineBreaks = original.split("\n").length - 1;
    const room = original.length - edit.text.length - lineBreaks;
    const replacement =
      room >= 0 ? edit.text + " ".repeat(room) + "\n".repeat(lineBreaks) : edit.text;
    out = out.slice(0, edit.start) + replacement + out.slice(edit.end);
  }
  return out;
}

/**
 * The underlying type text of an `@opaque` JSDoc tag, joined onto one line.
 * Only a tag that starts a line: "an @opaque type" in prose is not one
 * (typesugar's own `.d.ts` says that, and its interface became `type
 * MethodInlinePattern = type can be inlined ...`, a syntax error).
 */
function opaqueTagText(node: ts.Node): string | undefined {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== "opaque" || !isJSDocTagAtLineStart(tag)) continue;
    const comment =
      typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    const value = comment?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}
