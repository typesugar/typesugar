/**
 * Core types for the typesugar macro system
 */

import * as ts from "typescript";
import type { MacroExpansionCache } from "./cache.js";

// ============================================================================
// Macro Kinds
// ============================================================================

export type MacroKind =
  | "expression"
  | "attribute"
  | "derive"
  | "labeled-block"
  | "tagged-template"
  | "type";

// ============================================================================
// Macro Context - Available to all macros during expansion
// ============================================================================

import type { HygieneContext } from "./hygiene.js";

export interface MacroContext {
  /** The TypeScript Program instance */
  program: ts.Program;

  /** Type checker for semantic analysis */
  typeChecker: ts.TypeChecker;

  /** Current source file being processed */
  sourceFile: ts.SourceFile;

  /** TypeScript factory for creating nodes */
  factory: ts.NodeFactory;

  /** The transformer context */
  transformContext: ts.TransformationContext;

  /** Hygiene context for scoped identifier generation */
  hygiene: HygieneContext;

  /** Optional expansion cache for macro result caching */
  expansionCache?: MacroExpansionCache;

  // -------------------------------------------------------------------------
  // Node Creation Utilities
  // -------------------------------------------------------------------------

  /** Create an identifier node */
  createIdentifier(name: string): ts.Identifier;

  /** Create a numeric literal */
  createNumericLiteral(value: number): ts.NumericLiteral;

  /** Create a string literal */
  createStringLiteral(value: string): ts.StringLiteral;

  /** Create a boolean literal (true/false) */
  createBooleanLiteral(value: boolean): ts.Expression;

  /** Create an array literal from expressions */
  createArrayLiteral(elements: ts.Expression[]): ts.ArrayLiteralExpression;

  /** Create an object literal from properties */
  createObjectLiteral(
    properties: Array<{ name: string; value: ts.Expression }>
  ): ts.ObjectLiteralExpression;

  /** Parse a code string into an expression */
  parseExpression(code: string): ts.Expression;

  /** Parse a code string into statements */
  parseStatements(code: string): ts.Statement[];

  // -------------------------------------------------------------------------
  // Type Utilities
  // -------------------------------------------------------------------------

  /** Get the type of a node */
  getTypeOf(node: ts.Node): ts.Type;

  /** Get the type of a node as a string */
  getTypeString(node: ts.Node): string;

  /** Check if a type is assignable to another */
  isAssignableTo(source: ts.Type, target: ts.Type): boolean;

  /** Get properties of a type */
  getPropertiesOfType(type: ts.Type): ts.Symbol[];

  /** Get the symbol of a node */
  getSymbol(node: ts.Node): ts.Symbol | undefined;

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /** Report a compile-time error */
  reportError(node: ts.Node, message: string): void;

  /** Report a compile-time warning */
  reportWarning(node: ts.Node, message: string): void;

  /** Create a rich diagnostic builder for structured error reporting */
  diagnostic(
    descriptor: import("./diagnostics.js").DiagnosticDescriptor
  ): import("./diagnostics.js").DiagnosticBuilder;

  /**
   * Return the list of diagnostics emitted so far in this macro context.
   * Primarily intended for tests that exercise macro expansion and want to
   * assert on emitted diagnostics; production callers should rely on the
   * pipeline-level diagnostic surface instead. Returns a fresh array — safe
   * to mutate without affecting the context's internal state.
   */
  getDiagnostics(): MacroDiagnostic[];

  // -------------------------------------------------------------------------
  // Compile-Time Evaluation
  // -------------------------------------------------------------------------

  /** Evaluate an expression at compile time */
  evaluate(node: ts.Node): ComptimeValue;

  /** Check if a node can be evaluated at compile time */
  isComptime(node: ts.Node): boolean;

  // -------------------------------------------------------------------------
  // Unique Name Generation
  // -------------------------------------------------------------------------

  /** Generate a unique identifier to avoid name collisions */
  generateUniqueName(prefix: string): ts.Identifier;

  /**
   * Try to use a short preferred name; fall back to `generateUniqueName` on collision.
   *
   * Checks if `preferred` conflicts with any binding visible in the current
   * source file (imports, top-level declarations, parameter names). If no
   * conflict, returns an identifier with the preferred name. Otherwise
   * delegates to `generateUniqueName(preferred)`.
   */
  tryShortName(preferred: string): ts.Identifier;

  // -------------------------------------------------------------------------
  // Reference Hygiene
  // -------------------------------------------------------------------------

  /**
   * Get a safe reference to an external symbol.
   *
   * Uses three-tier resolution to detect conflicts:
   * - Tier 0: Known JS globals (Error, Array, JSON, etc.) — always safe
   * - Tier 1: Check file import map — safe if imported from same module
   * - Tier 2: Check local declarations — conflict if declared
   *
   * If a conflict is detected, generates an aliased import instead.
   *
   * @param symbol - The symbol name to reference (e.g., "Eq", "Show")
   * @param from - The module the symbol should come from (e.g., "@typesugar/std")
   * @returns An identifier — either bare (fast path) or aliased (conflict)
   *
   * @example
   * ```typescript
   * // If user has: const Eq = 42;
   * ctx.safeRef("Eq", "@typesugar/std")
   * // Returns: __Eq_ts0__ (alias, not "Eq")
   * // Pending import: import { Eq as __Eq_ts0__ } from "@typesugar/std"
   * ```
   */
  safeRef(symbol: string, from: string): ts.Identifier;

  /**
   * Like {@link safeRef}, but also GUARANTEES the symbol is imported from `from`.
   *
   * `safeRef` only avoids name collisions; in the common "not in scope" case it
   * returns a bare identifier and leaves importing to the caller. Expression
   * macros return an expression (not statements) and so cannot inject an import
   * statement themselves — use this to reference a runtime symbol the source file
   * may not import (e.g. `MatchError`). The pending import is flushed into the
   * file by the transformer.
   *
   * @example
   * ```typescript
   * // Source file does not import MatchError:
   * ctx.ensureImport("MatchError", "@typesugar/std")
   * // Returns: MatchError (bare) + pending: import { MatchError } from "@typesugar/std"
   * ```
   */
  ensureImport(symbol: string, from: string): ts.Identifier;

  // -------------------------------------------------------------------------
  // Type Confidence
  // -------------------------------------------------------------------------

  /** Check if a type is reliable (not implicit any, not error type) */
  isTypeReliable(type: import("typescript").Type): boolean;

  /** Assert type is reliable; emits diagnostic and returns null if not */
  assertTypeReliable(
    node: import("typescript").Node,
    purpose: string
  ): import("typescript").Type | null;

  // -------------------------------------------------------------------------
  // Tree-Shaking Annotations
  // -------------------------------------------------------------------------

  /**
   * Add a #__PURE__ comment to a node to indicate it has no side effects.
   * Bundlers will drop the result if it's unused.
   */
  markPure<T extends ts.Node>(node: T): T;
}

// ============================================================================
// Compile-Time Values
// ============================================================================

export type ComptimeValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "bigint"; value: bigint } // Finding #14: BigInt support
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "array"; elements: ComptimeValue[] }
  | { kind: "object"; properties: Map<string, ComptimeValue> }
  | { kind: "function"; fn: (...args: ComptimeValue[]) => ComptimeValue }
  | { kind: "type"; type: ts.Type }
  | { kind: "error"; message: string };

// ============================================================================
// Macro Definitions
// ============================================================================

/** Base interface for all macro definitions */
export interface MacroDefinitionBase {
  /** Unique name of the macro */
  name: string;

  /** Optional description for documentation */
  description?: string;

  /**
   * The module specifier that exports this macro's placeholder function.
   * When set, the macro is only activated when the user imports the
   * placeholder from this module (or from a barrel that re-exports it).
   *
   * Examples: "typesugar", "typesugar/units"
   *
   * When undefined, the macro is activated by name alone (legacy behavior).
   *
   * Together with {@link exportName} this is the macro's registry identity:
   * macros from different modules may share a `name` and coexist, and the
   * module the user's import resolves to picks which one expands. Without a
   * `module`, the bare name is the identity, so only one module-less macro
   * per name and kind can be registered.
   */
  module?: string;

  /**
   * The exported name of the placeholder in the source module.
   * Defaults to `name` if not specified.
   * Useful when the macro name differs from the export name.
   */
  exportName?: string;

  /**
   * Names of macros that must expand before this one on the same node.
   *
   * When multiple attribute/derive macros decorate the same declaration,
   * the transformer uses this to topologically sort them. If macro A
   * declares `expandAfter: ["B"]`, then B's decorator is processed first.
   *
   * This does NOT affect cross-node ordering (the transformer is single-pass,
   * top-to-bottom). For cross-node dependencies, the re-visit mechanism
   * handles macro-generated macro calls automatically.
   *
   * Example: A typeclass-aware derive might declare `expandAfter: ["typeclass"]`
   * to ensure the typeclass companion namespace exists before derivation runs.
   */
  expandAfter?: string[];

  /**
   * Opt in to the expression-macro expansion cache (default: not cached).
   *
   * Set `true` only when the expansion is a pure function of the call-site
   * TEXT: no type-checker queries, no files/env/config, no `ensureImport`,
   * `generateUniqueName` or registry writes. The cache key is the macro name,
   * the call text and the source file path, so anything else the expansion
   * depends on would be served stale. As a backstop the transformer still
   * skips storing an expansion that reported a diagnostic, queued an import,
   * or whose arguments were rewritten by a nested expansion.
   */
  cacheable?: boolean;
}

/** Expression macro - transforms expressions */
export interface ExpressionMacro extends MacroDefinitionBase {
  kind: "expression";

  /**
   * When true, the transformer detects method chains rooted in this macro
   * (e.g., `match(x).case(42).then("yes")`) and passes the outermost chain
   * CallExpression to expand() instead of just the root call. The root call's
   * arguments are passed as `args`.
   */
  chainable?: boolean;

  /**
   * Expand the macro call into new AST nodes
   * @param ctx - The macro context
   * @param callExpr - The macro call expression (or outermost chain call if chainable)
   * @param args - The arguments passed to the macro (root call args if chainable)
   */
  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression;
}

/** Attribute macro - transforms declarations */
export interface AttributeMacro extends MacroDefinitionBase {
  kind: "attribute";

  /**
   * Valid targets for this attribute
   */
  validTargets: AttributeTarget[];

  /**
   * Labels that implicitly trigger this attribute macro on an enclosing
   * function/method, even without an explicit decorator. When the transformer
   * sees a function or method whose body contains a top-level labeled block
   * (e.g. `requires:` / `ensures:`) matching one of these labels, it applies
   * this attribute macro as if the function were decorated with it.
   *
   * Used by `@contract` so the documented `requires:`/`ensures:` block form
   * works without an explicit `@contract` decorator. The macro only activates
   * when its package is loaded, so unrelated `label:` statements are unaffected
   * unless the owning package is imported.
   */
  triggerLabels?: string[];

  /**
   * Module whose import activates this macro's trigger-label syntax in a file
   * (a module carrying a `@syntax-labels <name>` marker, PEP-052 Part 2).
   * Feeds the TS9224 "label syntax not activated" hint, and doubles as a
   * resolution-free activation fallback: an import specifier that exactly
   * matches this string activates the macro even in hosts that cannot
   * resolve modules (in-memory/playground hosts, virtual file names).
   */
  syntaxModule?: string;

  /**
   * Expand the attribute macro.
   *
   * `target` is typed as `ts.Node` because in practice the framework hands
   * macros a variety of node shapes (class / interface / type-alias /
   * variable statement / function declaration). Macros that only support
   * specific shapes should narrow via `ts.isXxx` predicates and report a
   * diagnostic on unsupported targets.
   *
   * @param ctx - The macro context
   * @param decorator - The decorator node
   * @param target - The decorated node
   * @param args - Arguments passed to the decorator
   */
  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Node,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[];
}

export type AttributeTarget =
  | "class"
  | "method"
  | "property"
  | "function"
  | "parameter"
  | "interface"
  | "type";

/** Derive macro - generates code for types */
export interface DeriveMacro extends MacroDefinitionBase {
  kind: "derive";

  /**
   * Expand the derive macro for a type
   * @param ctx - The macro context
   * @param target - The type being derived
   * @param typeInfo - Extracted type information
   */
  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[];

  /**
   * The value names this derive declares next to the type (functions,
   * consts), for checks of the source as written, before they exist: an
   * `import { Circle }` from the module, `export { Circle } from` it, or a
   * call `Circle(2)` is not an error there. Optional: a derive that only
   * generates the `Type.TC` companion declares no names of its own.
   */
  generatedNames?(
    checker: ts.TypeChecker,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration
  ): readonly string[];
}

/** Information about a type for derive macros */
export interface DeriveTypeInfo {
  /** Name of the type */
  name: string;

  /** Fields/properties of the type (for product types) */
  fields: DeriveFieldInfo[];

  /** Type parameters if generic */
  typeParameters: ts.TypeParameterDeclaration[];

  /** The original type node */
  type: ts.Type;

  /**
   * The kind of type:
   * - "product": Record/interface/class with fields
   * - "sum": Discriminated union
   * - "primitive": number, string, boolean, etc.
   */
  kind: "product" | "sum" | "primitive";

  /**
   * For sum types: the variants of the union.
   * Each variant has a tag value and its associated fields.
   */
  variants?: DeriveVariantInfo[];

  /**
   * For sum types: the name of the discriminant field (e.g., "kind", "_tag", "type").
   * Used to generate switch statements for exhaustive matching.
   */
  discriminant?: string;

  /**
   * Whether the type is recursive (references itself directly or indirectly).
   * Useful for generating recursive traversals and avoiding infinite loops.
   */
  isRecursive?: boolean;
}

/** Information about a variant in a sum type */
export interface DeriveVariantInfo {
  /** The discriminant value (e.g., "circle", "rect") */
  tag: string;

  /** The type name for this variant (e.g., "Circle", "Rectangle") */
  typeName: string;

  /** The fields of this variant (excluding the discriminant) */
  fields: DeriveFieldInfo[];
}

export interface DeriveFieldInfo {
  /** Field name */
  name: string;

  /** Field type as a string */
  typeString: string;

  /** Field type */
  type: ts.Type;

  /** Is the field optional? */
  optional: boolean;

  /** Is the field readonly? */
  readonly: boolean;

  /**
   * The TypeScript symbol for this field.
   * Used to access JSDoc tags and other declaration-level metadata.
   */
  symbol?: ts.Symbol;
}

/** Tagged template macro - transforms tagged template literals */
export interface TaggedTemplateMacroDef extends MacroDefinitionBase {
  kind: "tagged-template";

  /**
   * Expand a tagged template literal
   * @param ctx - The macro context
   * @param node - The tagged template expression
   */
  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression;

  /**
   * Optional compile-time validation of the template
   * @param ctx - The macro context
   * @param node - The tagged template expression
   * @returns true if valid, false to abort expansion
   */
  validate?(ctx: MacroContext, node: ts.TaggedTemplateExpression): boolean;
}

/** Labeled block macro - transforms labeled statement blocks (e.g., `let: { ... } yield: { ... }`) */
export interface LabeledBlockMacro extends MacroDefinitionBase {
  kind: "labeled-block";

  /**
   * The label(s) that start this macro block (e.g., "let" for `let: { ... }`).
   * Can be a single string or an array of aliases (e.g., ["let", "seq"]).
   */
  label: string | string[];

  /**
   * Optional continuation labels that follow the main block.
   * For example, ["yield", "pure"] means the macro can consume a
   * following `yield: { ... }` or `pure: { ... }` labeled statement.
   */
  continuationLabels?: string[];

  /**
   * The statement the label must be attached to for the macro to apply:
   * `"block"` (the default, `let: { ... }`) or `"switch"` (`match: switch
   * (x) { ... }`). A label on any other statement is an ordinary JavaScript
   * label and is never a dispatch candidate (`all: for (...)` must not be
   * hijacked).
   */
  statement?: "block" | "switch";

  /**
   * Whether the expansion produces a value (vs. a side-effecting block).
   *
   * Comprehensions like `let:/yield:`, `par:/yield:` evaluate to a value
   * (a monadic container). When true and the macro is used at statement
   * position (not assigned, not returned), the transformer emits a
   * discarded-value warning — analogous to TypeScript's `no-unused-expressions`
   * but aware that the value may be lazy (Effect, Iterable, etc.) and is
   * therefore almost certainly a bug.
   *
   * Default: false (no warning — for side-effecting labeled blocks).
   */
  valueProducing?: boolean;

  /**
   * Module whose import activates this macro's label syntax in a file
   * (a module carrying a `@syntax-labels <name>` marker, PEP-052 Part 2).
   * Feeds the TS9224 "label syntax not activated" hint, and doubles as a
   * resolution-free activation fallback: an import specifier that exactly
   * matches this string activates the macro even in hosts that cannot
   * resolve modules (in-memory/playground hosts, virtual file names).
   */
  syntaxModule?: string;

  /**
   * The {@link syntaxModule} only activates the label and has nothing to run
   * (a marker constant). In a file the transformer changed, its side-effect
   * import (`import "<syntaxModule>";`) is removed from the output, so the
   * label syntax costs no runtime import. Leave unset for a module with real
   * runtime content (`@typesugar/std/syntax/do` also provides instances).
   */
  erasableSyntaxModule?: boolean;

  /**
   * Expand the labeled block macro
   * @param ctx - The macro context
   * @param mainBlock - The main labeled statement (e.g., `let: { ... }`, or
   *   `match: switch (...) { ... }` for a `statement: "switch"` macro)
   * @param continuation - The optional continuation labeled statement (e.g., `yield: { ... }`)
   */
  expand(
    ctx: MacroContext,
    mainBlock: ts.LabeledStatement,
    continuation: ts.LabeledStatement | undefined
  ): ts.Statement | ts.Statement[];
}

/** Union of all macro types */
export type MacroDefinition =
  | ExpressionMacro
  | AttributeMacro
  | DeriveMacro
  | TaggedTemplateMacroDef
  | TypeMacro
  | LabeledBlockMacro;

// ============================================================================
// Macro Registry
// ============================================================================

export interface MacroRegistry {
  /** Register a new macro */
  register(macro: MacroDefinition): void;

  /**
   * Get an expression macro by bare name. The bare-name getters return the
   * legacy (module-less) macro of that name if any, else the only
   * module-qualified one, else `undefined` when several modules provide the
   * name (see {@link getCandidates}).
   */
  getExpression(name: string): ExpressionMacro | undefined;

  /** Get an attribute macro by name */
  getAttribute(name: string): AttributeMacro | undefined;

  /** Find an attribute macro that declares `label` in its triggerLabels */
  getAttributeByTriggerLabel(label: string): AttributeMacro | undefined;

  /** Get a derive macro by name */
  getDerive(name: string): DeriveMacro | undefined;

  /** Get a tagged template macro by name */
  getTaggedTemplate(name: string): TaggedTemplateMacroDef | undefined;

  /** Get a type macro by name */
  getType(name: string): TypeMacro | undefined;

  /** Get a labeled block macro by label name */
  getLabeledBlock(label: string): LabeledBlockMacro | undefined;

  /**
   * Look up a macro by its identity: the module it declares and its export
   * name (`exportName ?? name`), optionally restricted to one kind. This is
   * how an import resolves to a macro; two modules' same-named macros are
   * distinct identities (PEP-060 item 8).
   */
  getByModuleExport(
    mod: string,
    exportName: string,
    kind?: MacroDefinition["kind"]
  ): MacroDefinition | undefined;

  /**
   * Every macro of `kind` registered under `name` (its `name`, its
   * `exportName`, or — for labeled blocks — one of its labels), in
   * registration order. More than one means several modules provide the
   * name; disambiguate by the file's imports.
   */
  getCandidates(name: string, kind: MacroDefinition["kind"]): readonly MacroDefinition[];

  /** Check whether a macro requires import-scoping */
  isImportScoped(name: string, kind: MacroDefinition["kind"]): boolean;

  /** Get all registered macros */
  getAll(): MacroDefinition[];
}

// ============================================================================
// Macro Expansion Result
// ============================================================================

export interface MacroExpansionResult {
  /** Whether expansion was successful */
  success: boolean;

  /** Expanded nodes (if successful) */
  nodes?: ts.Node[];

  /** Diagnostics from expansion */
  diagnostics: MacroDiagnostic[];
}

export interface MacroDiagnostic {
  /** Severity level */
  severity: "error" | "warning" | "info";

  /** Diagnostic message */
  message: string;

  /** Source node that caused the diagnostic */
  node?: ts.Node;

  /** typesugar error code (9001-9999), set by DiagnosticBuilder */
  code?: number;

  /** Optional fix suggestion */
  suggestion?: string;
}

// TaggedTemplateMacro is now TaggedTemplateMacroDef, defined above alongside other macro types

// ============================================================================
// Standalone Extension Methods (Scala 3-style concrete type enrichment)
// ============================================================================

/**
 * Information about a standalone extension method for a concrete type.
 *
 * Unlike typeclass-derived extensions (which go through instance resolution),
 * standalone extensions are direct enrichments on concrete types, similar to
 * Scala 3's `extension (n: Int) def isEven = ...`.
 *
 * The rewrite is simpler: no summon/instance lookup, just a direct call to
 * the registered function.
 */
export interface StandaloneExtensionInfo {
  /** The method name (e.g., "clamp") */
  methodName: string;
  /** The type this extension is for (e.g., "number", "string", "Array") */
  forType: string;
  /**
   * How to reference the function at the call site.
   * If qualifier is set: `qualifier.methodName(receiver, args)`
   * If not: `methodName(receiver, args)`
   */
  qualifier?: string;
}

// ============================================================================
// Type-Level Macros (for type transformations)
// ============================================================================

export interface TypeMacro extends MacroDefinitionBase {
  kind: "type";

  /**
   * Transform a type reference
   * @param ctx - The macro context
   * @param typeRef - The type reference node
   * @param args - Type arguments
   */
  expand(
    ctx: MacroContext,
    typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode;
}
