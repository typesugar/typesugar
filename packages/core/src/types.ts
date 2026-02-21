/**
 * Core types for the typemacro macro system
 */

import * as ts from "typescript";

// ============================================================================
// Operator Symbol Types (for Op<> typeclass method annotations)
// ============================================================================

/**
 * List of operators that can be mapped via typeclass method Op<> annotations.
 * These are binary operators that the transformer can rewrite.
 */
export const OPERATOR_SYMBOLS = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "===",
  "!=",
  "!==",
  "&",
  "|",
  "^",
  "<<",
  ">>",
] as const;

/** Union type of all supported operator strings. */
export type OperatorSymbol = (typeof OPERATOR_SYMBOLS)[number];

/**
 * Branded intersection type used as a compile-time marker on typeclass method
 * return types to declare operator mappings.
 *
 * The transformer strips `Op<>` from emitted code — it has zero runtime cost.
 *
 * @example
 * ```typescript
 * interface Numeric<A> {
 *   add(a: A, b: A): A & Op<"+">;
 *   sub(a: A, b: A): A & Op<"-">;
 *   mul(a: A, b: A): A & Op<"*">;
 * }
 * ```
 */
export type Op<_S extends OperatorSymbol> = {};

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
}

// ============================================================================
// Compile-Time Values
// ============================================================================

export type ComptimeValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
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
   * Examples: "typemacro", "typemacro/units"
   *
   * When undefined, the macro is activated by name alone (legacy behavior).
   */
  module?: string;

  /**
   * The exported name of the placeholder in the source module.
   * Defaults to `name` if not specified.
   * Useful when the macro name differs from the export name.
   */
  exportName?: string;
}

/** Expression macro - transforms expressions */
export interface ExpressionMacro extends MacroDefinitionBase {
  kind: "expression";

  /**
   * Expand the macro call into new AST nodes
   * @param ctx - The macro context
   * @param callExpr - The macro call expression
   * @param args - The arguments passed to the macro
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
   * Expand the attribute macro
   * @param ctx - The macro context
   * @param decorator - The decorator node
   * @param target - The decorated declaration
   * @param args - Arguments passed to the decorator
   */
  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
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
   * The label that starts this macro block (e.g., "let" for `let: { ... }`)
   */
  label: string;

  /**
   * Optional continuation labels that follow the main block.
   * For example, ["yield", "pure"] means the macro can consume a
   * following `yield: { ... }` or `pure: { ... }` labeled statement.
   */
  continuationLabels?: string[];

  /**
   * Expand the labeled block macro
   * @param ctx - The macro context
   * @param mainBlock - The main labeled statement (e.g., `let: { ... }`)
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

  /** Get an expression macro by name */
  getExpression(name: string): ExpressionMacro | undefined;

  /** Get an attribute macro by name */
  getAttribute(name: string): AttributeMacro | undefined;

  /** Get a derive macro by name */
  getDerive(name: string): DeriveMacro | undefined;

  /** Get a tagged template macro by name */
  getTaggedTemplate(name: string): TaggedTemplateMacroDef | undefined;

  /** Get a type macro by name */
  getType(name: string): TypeMacro | undefined;

  /** Get a labeled block macro by label name */
  getLabeledBlock(label: string): LabeledBlockMacro | undefined;

  /** Look up a macro by its source module and export name */
  getByModuleExport(mod: string, exportName: string): MacroDefinition | undefined;

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

  /** Optional fix suggestion */
  suggestion?: string;
}

// TaggedTemplateMacro is now TaggedTemplateMacroDef, defined above alongside other macro types

// ============================================================================
// Extension Method Registry (for typeclass-based implicit extensions)
// ============================================================================

/**
 * Information about an extension method provided by a typeclass
 */
export interface ExtensionMethodInfo {
  /** The method name (e.g., "show", "eq", "compare") */
  methodName: string;

  /** The type this extension is for (e.g., "Point", "User") */
  forType: string;

  /** The typeclass that provides this extension (e.g., "Show", "Eq") */
  typeclassName: string;

  /** Whether this is a self-method (first param is `self`) */
  isSelfMethod: boolean;

  /** Extra parameters beyond `self` */
  extraParams: Array<{ name: string; type: string }>;

  /** Return type of the method */
  returnType: string;
}

/**
 * Registry for extension methods provided by typeclasses.
 * The transformer uses this to rewrite implicit extension method calls.
 */
export interface ExtensionMethodRegistry {
  /** Register an extension method */
  register(info: ExtensionMethodInfo): void;

  /** Find an extension method by name and type */
  find(methodName: string, forType: string): ExtensionMethodInfo | undefined;

  /** Get all extension methods for a type */
  getForType(forType: string): ExtensionMethodInfo[];

  /** Clear all registered extensions (for testing) */
  clear(): void;
}

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
