/**
 * Diagnostics System for typesugar
 *
 * Provides Rust/Elm-quality error messages with:
 * - Structured error codes in TS custom range (9001-9999)
 * - Rich diagnostics with multiple labeled spans
 * - Machine-applicable code suggestions
 * - Builder API for macro authors
 *
 * @example
 * ```typescript
 * ctx.diagnostic(TS9001)
 *   .at(callExpr)
 *   .withArgs({ typeclass: "Eq", type: "Point" })
 *   .label(fieldNode, "this field has type `Color`")
 *   .note("Eq<Color> is required because Point has a `color: Color` field")
 *   .help("Add @derive(Eq) to Color")
 *   .suggestion(fieldNode, "add-derive-eq", "@derive(Eq)\ninterface Color {")
 *   .emit();
 * ```
 */

import type * as ts from "typescript";

// ============================================================================
// Diagnostic Categories
// ============================================================================

export enum DiagnosticCategory {
  TypeclassResolution = "typeclass",
  MacroSyntax = "syntax",
  MacroExpansion = "expansion",
  DeriveFailed = "derive",
  ImportResolution = "import",
  Comptime = "comptime",
  Configuration = "config",
  HKT = "hkt",
  Extension = "extension",
  Operator = "operator",
  OptOut = "opt-out",
  Internal = "internal",
}

// ============================================================================
// Diagnostic Descriptor (Error Catalog Entry)
// ============================================================================

export interface DiagnosticDescriptor {
  /** Unique error code in range 9001-9999 */
  readonly code: number;

  /** Default severity (can be overridden per-emit) */
  readonly severity: "error" | "warning" | "info";

  /** Category for filtering and grouping */
  readonly category: DiagnosticCategory;

  /** Message template with {placeholders} for interpolation */
  readonly messageTemplate: string;

  /** Long-form explanation for docs and --explain */
  readonly explanation: string;

  /** URL to documentation page */
  readonly seeAlso?: string;
}

// ============================================================================
// Rich Diagnostic Types
// ============================================================================

/**
 * A labeled span pointing at specific code with a message.
 * Used for secondary annotations like Rust's "defined here" notes.
 */
export interface LabeledSpan {
  /** The node to point at */
  node: ts.Node;
  /** Message to display at this span */
  message: string;
  /** Whether this is the primary span (default: false) */
  primary?: boolean;
}

/**
 * A machine-applicable code suggestion (fix).
 * The IDE can apply this automatically.
 */
export interface CodeSuggestion {
  /** Unique identifier for this suggestion type */
  id: string;
  /** Human-readable description of the fix */
  description: string;
  /** The node to replace */
  node: ts.Node;
  /** The replacement text */
  replacement: string;
  /** Whether this is the preferred/default fix */
  isPreferred?: boolean;
}

/**
 * Rich diagnostic with multiple spans, notes, help, and suggestions.
 * This is the structured form that renders to CLI/IDE/ESLint output.
 */
export interface RichDiagnostic {
  /** The error code from the catalog */
  code: number;

  /** Severity level */
  severity: "error" | "warning" | "info";

  /** Category for filtering */
  category: DiagnosticCategory;

  /** Primary message (with placeholders interpolated) */
  message: string;

  /** The primary span (main error location) */
  primarySpan?: {
    node: ts.Node;
    sourceFile: ts.SourceFile;
  };

  /** Secondary labeled spans (additional context) */
  labels: LabeledSpan[];

  /** Additional notes (not attached to spans) */
  notes: string[];

  /** Help text (actionable suggestion in prose) */
  help?: string;

  /** Machine-applicable code suggestions */
  suggestions: CodeSuggestion[];

  /** Long-form explanation from the catalog */
  explanation?: string;

  /** URL to documentation */
  seeAlso?: string;
}

// ============================================================================
// Diagnostic Builder
// ============================================================================

/**
 * Fluent builder for constructing rich diagnostics.
 *
 * @example
 * ```typescript
 * new DiagnosticBuilder(TS9001, sourceFile, emitter)
 *   .at(callExpr)
 *   .withArgs({ typeclass: "Eq", type: "Point" })
 *   .label(fieldNode, "this field has type `Color`")
 *   .note("Eq<Color> is required for all fields")
 *   .help("Add @derive(Eq) to Color")
 *   .emit();
 * ```
 */
export class DiagnosticBuilder {
  private diagnostic: RichDiagnostic;
  private args: Record<string, string> = {};

  constructor(
    private readonly descriptor: DiagnosticDescriptor,
    private readonly sourceFile: ts.SourceFile,
    private readonly emitter: (diagnostic: RichDiagnostic) => void
  ) {
    this.diagnostic = {
      code: descriptor.code,
      severity: descriptor.severity,
      category: descriptor.category,
      message: descriptor.messageTemplate,
      labels: [],
      notes: [],
      suggestions: [],
      explanation: descriptor.explanation,
      seeAlso: descriptor.seeAlso,
    };
  }

  /**
   * Set the primary span for this diagnostic.
   */
  at(node: ts.Node): this {
    this.diagnostic.primarySpan = { node, sourceFile: this.sourceFile };
    return this;
  }

  /**
   * Provide arguments for message template interpolation.
   */
  withArgs(args: Record<string, string | number | undefined>): this {
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) {
        this.args[key] = String(value);
      }
    }
    return this;
  }

  /**
   * Add a secondary labeled span.
   */
  label(node: ts.Node, message: string): this {
    this.diagnostic.labels.push({ node, message, primary: false });
    return this;
  }

  /**
   * Add a note (not attached to a specific span).
   */
  note(message: string): this {
    this.diagnostic.notes.push(message);
    return this;
  }

  /**
   * Add help text (actionable suggestion in prose).
   */
  help(message: string): this {
    this.diagnostic.help = message;
    return this;
  }

  /**
   * Add a machine-applicable code suggestion.
   */
  suggestion(
    node: ts.Node,
    id: string,
    replacement: string,
    description?: string,
    isPreferred?: boolean
  ): this {
    this.diagnostic.suggestions.push({
      id,
      description: description ?? `Apply fix: ${id}`,
      node,
      replacement,
      isPreferred,
    });
    return this;
  }

  /**
   * Interpolate message template with provided arguments.
   */
  private interpolateMessage(): string {
    let message = this.descriptor.messageTemplate;
    for (const [key, value] of Object.entries(this.args)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }
    return message;
  }

  /**
   * Emit the diagnostic via the registered emitter.
   */
  emit(): void {
    this.diagnostic.message = this.interpolateMessage();
    this.emitter(this.diagnostic);
  }
}

// ============================================================================
// Error Catalog: Typeclass Resolution (9001-9099)
// ============================================================================

export const TS9001: DiagnosticDescriptor = {
  code: 9001,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "No instance found for `{typeclass}<{type}>`",
  explanation: `The typeclass system could not find or auto-derive an instance.

Possible causes:
1. The type has no @instance declaration for this typeclass
2. Auto-derivation failed (e.g., a field lacks a required instance)
3. The type is opaque or from a library without typeclass support

Solutions:
- Add @derive({typeclass}) to the type definition
- Provide an explicit @instance implementation
- Check that all fields have the required instances`,
  seeAlso: "https://typesugar.dev/errors/TS9001",
};

export const TS9002: DiagnosticDescriptor = {
  code: 9002,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "@instance must annotate a const declaration",
  explanation: `@instance is used to register a typeclass instance.

Correct:
  @instance
  const showPoint: Show<Point> = { show: (p) => \`(\${p.x}, \${p.y})\` };

Incorrect:
  @instance  // ✗ Not a const
  function showPoint() { ... }

  @instance  // ✗ Missing type annotation
  const showPoint = { ... };`,
  seeAlso: "https://typesugar.dev/errors/TS9002",
};

export const TS9003: DiagnosticDescriptor = {
  code: 9003,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "@instance requires explicit type annotation (e.g., Typeclass<Type>)",
  explanation: `The @instance decorator needs to know both the typeclass and the type.

Correct:
  @instance
  const showPoint: Show<Point> = { ... };
                   ^^^^^^^^^^^^ Type annotation tells us:
                                - Typeclass: Show
                                - For type: Point

Incorrect:
  @instance
  const showPoint = { ... };  // Missing type annotation`,
  seeAlso: "https://typesugar.dev/errors/TS9003",
};

export const TS9004: DiagnosticDescriptor = {
  code: 9004,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "@instance type must be a generic type reference (e.g., Show<Point>)",
  explanation: `The type annotation must reference a registered typeclass with a type argument.

Correct forms:
  Show<Point>     — typeclass Show, for type Point
  Eq<User>        — typeclass Eq, for type User
  Ord<Date>       — typeclass Ord, for type Date

Incorrect:
  Point           — not a typeclass reference
  Show            — missing the type argument`,
  seeAlso: "https://typesugar.dev/errors/TS9004",
};

export const TS9005: DiagnosticDescriptor = {
  code: 9005,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "summon requires a type argument: summon<Typeclass<Type>>()",
  explanation: `summon<T>() resolves a typeclass instance at compile time.

Correct:
  summon<Show<Point>>()   — resolves Show instance for Point
  summon<Eq<User>>()      — resolves Eq instance for User

Incorrect:
  summon()               — missing type argument
  summon<Point>()        — Point is not a typeclass`,
  seeAlso: "https://typesugar.dev/errors/TS9005",
};

export const TS9006: DiagnosticDescriptor = {
  code: 9006,
  severity: "warning",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Duplicate instance {typeclass}<{type}> registered",
  explanation: `Two or more instances of {typeclass}<{type}> have been registered.

This creates ambiguity in instance resolution. The transformer will use
the first registered instance, but this may not be the intended behavior.

To fix:
1. Remove duplicate @instance declarations
2. Or use explicit instance selection with summon()`,
  seeAlso: "https://typesugar.dev/errors/TS9006",
};

export const TS9007: DiagnosticDescriptor = {
  code: 9007,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "summon type argument '{typeArg}' is not a registered typeclass",
  explanation: `summon<T>() expects T to be a typeclass name that was registered with @typeclass.

Common typeclasses: Show, Eq, Ord, Clone, Hash, Default, Json

If you're using a custom typeclass, ensure it's decorated with @typeclass:
  @typeclass
  interface MyTypeclass<A> { ... }`,
  seeAlso: "https://typesugar.dev/errors/TS9007",
};

export const TS9008: DiagnosticDescriptor = {
  code: 9008,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "summon type argument must be a type reference like Show<Point>",
  explanation: `summon<T>() expects T to be a typeclass applied to a type.

Correct:
  summon<Show<Point>>()
  summon<Eq<User>>()

Incorrect:
  summon<Point>()       // Point is not a typeclass
  summon<Show>()        // Missing the type argument
  summon<string>()      // Primitive, not a typeclass`,
  seeAlso: "https://typesugar.dev/errors/TS9008",
};

export const TS9009: DiagnosticDescriptor = {
  code: 9009,
  severity: "warning",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "@implicits on '{function}' found no implicit parameters",
  explanation: `The @implicits decorator was applied to a function that has no parameters
matching the implicit parameter pattern.

Implicit parameters must be:
- Typed as Typeclass<T> where Typeclass is a registered typeclass
- T is a type parameter of the function

Example:
  @implicits
  function show<A>(a: A, S: Show<A>): string { ... }
                         ^^^^^^^^
                         This is an implicit parameter

If no parameters match this pattern, the decorator has no effect.`,
  seeAlso: "https://typesugar.dev/errors/TS9009",
};

// Coherence Checking (9050-9059)

export const TS9050: DiagnosticDescriptor = {
  code: 9050,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Conflicting instance of `{typeclass}` for type `{type}`",
  explanation: `Multiple instances of the same typeclass exist for this type.

Typesugar requires coherence: each (typeclass, type) pair must have exactly one instance.
This error occurs when:
1. Two @instance declarations exist for the same typeclass and type
2. Both @derive and @instance are used for the same pair
3. Two libraries provide conflicting instances

The error shows both instance locations. To fix:
- Remove one of the instances
- Use a newtype wrapper if you need different behaviors
- Configure instance priority in typesugar.config.ts`,
  seeAlso: "https://typesugar.dev/errors/TS9050",
};

export const TS9051: DiagnosticDescriptor = {
  code: 9051,
  severity: "warning",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Instance of `{typeclass}` for `{type}` shadows imported instance",
  explanation: `A local instance definition shadows an instance from an imported module.

This is usually intentional (to provide a custom implementation), but can be surprising
if you expected the imported instance to be used.

The warning shows both instances:
- First: the imported instance being shadowed
- Second: the local instance that takes precedence

To silence this warning:
- Remove the local instance if you want the imported one
- Add a comment \`// @ts-expect-error TS9051\` if shadowing is intentional`,
  seeAlso: "https://typesugar.dev/errors/TS9051",
};

export const TS9052: DiagnosticDescriptor = {
  code: 9052,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Ambiguous instance resolution for `{typeclass}<{type}>`",
  explanation: `Multiple instances are equally valid for this typeclass and type.

This differs from a conflict: both instances have the same priority,
so typesugar cannot determine which to use.

Common causes:
1. Two @derive decorators on the same type for the same typeclass
2. Two imported libraries both provide instances with the same priority
3. Overlapping generic instances (e.g., Show<Array<T>> vs Show<Array<number>>)

To fix:
- Make one instance more specific (higher priority)
- Remove one of the instances
- Use explicit \`summon<TC>(moduleName)\` to disambiguate`,
  seeAlso: "https://typesugar.dev/errors/TS9052",
};

// ============================================================================
// Error Catalog: Import Suggestions (9060-9069)
// ============================================================================

export const TS9060: DiagnosticDescriptor = {
  code: 9060,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Typeclass `{name}` is not in scope",
  explanation: `The typeclass \`{name}\` is used but not imported.

typesugar typeclasses must be imported to be used:

  import { {name} } from "@typesugar/std";
  // or
  import { {name} } from "typesugar";

Common typeclasses:
- Eq, Ord, Show, Clone, Debug, Hash, Default — from @typesugar/std
- Functor, Monad, Applicative — from @typesugar/fp`,
  seeAlso: "https://typesugar.dev/errors/TS9060",
};

export const TS9061: DiagnosticDescriptor = {
  code: 9061,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Macro `{name}` is not defined",
  explanation: `The macro \`{name}\` is called but not imported.

typesugar macros must be imported to be used:

  import { {name} } from "typesugar";

Common macros:
- comptime — compile-time evaluation
- specialize — zero-cost inlining
- match — pattern matching
- derive — auto-derive instances
- cfg — conditional compilation`,
  seeAlso: "https://typesugar.dev/errors/TS9061",
};

export const TS9062: DiagnosticDescriptor = {
  code: 9062,
  severity: "error",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Method `{method}` does not exist on type `{type}`",
  explanation: `The method \`{method}\` is called on \`{type}\`, but:
1. It's not a native method of \`{type}\`
2. No extension method \`{method}\` is in scope

Extension methods require an import:

  import { StringExt } from "@typesugar/std";  // for string methods
  import { NumberExt } from "@typesugar/std";  // for number methods
  import { ArrayExt } from "@typesugar/std";   // for array methods

Or if it's a typeclass method, ensure the typeclass is in scope.`,
  seeAlso: "https://typesugar.dev/errors/TS9062",
};

export const TS9063: DiagnosticDescriptor = {
  code: 9063,
  severity: "info",
  category: DiagnosticCategory.TypeclassResolution,
  messageTemplate: "Did you mean to import `{symbol}` from `{module}`?",
  explanation: `typesugar found a symbol \`{symbol}\` that matches your usage.

Suggested import:
  import { {symbol} } from "{module}";

This is a suggestion, not an error. The symbol is available but not imported.`,
  seeAlso: "https://typesugar.dev/errors/TS9063",
};

// ============================================================================
// Error Catalog: Derive Failures (9100-9199)
// ============================================================================

export const TS9101: DiagnosticDescriptor = {
  code: 9101,
  severity: "error",
  category: DiagnosticCategory.DeriveFailed,
  messageTemplate:
    "Cannot auto-derive {typeclass}<{type}>: field `{field}` has type `{fieldType}` which lacks {typeclass}",
  explanation: `Auto-derivation constructs a {typeclass} instance from the instances of each field.

To derive {typeclass}<{type}>, every field must have a {typeclass} instance.
Field \`{field}\` has type \`{fieldType}\`, which has no {typeclass} instance.

Solutions:
1. Add @derive({typeclass}) to {fieldType}
2. Provide a manual @instance {typeclass}<{fieldType}>
3. If {fieldType} is external, create a newtype wrapper`,
  seeAlso: "https://typesugar.dev/errors/TS9101",
};

export const TS9102: DiagnosticDescriptor = {
  code: 9102,
  severity: "error",
  category: DiagnosticCategory.DeriveFailed,
  messageTemplate: "@derive({typeclass}) requires an interface, class, or type alias",
  explanation: `The @derive decorator can only be applied to:
- interface declarations
- class declarations
- type alias declarations

It cannot be applied to:
- function declarations
- variable declarations
- other kinds of declarations`,
  seeAlso: "https://typesugar.dev/errors/TS9102",
};

export const TS9103: DiagnosticDescriptor = {
  code: 9103,
  severity: "error",
  category: DiagnosticCategory.DeriveFailed,
  messageTemplate: "@deriving on union types requires a discriminant field",
  explanation: `When deriving typeclasses for discriminated unions (sum types),
each variant must have a common discriminant field.

Example of correct usage:
  type Shape =
    | { kind: "circle"; radius: number }
    | { kind: "rect"; width: number; height: number };
                ^^^^
                Common discriminant field "kind"

Without a discriminant, the runtime cannot determine which variant to use.`,
  seeAlso: "https://typesugar.dev/errors/TS9103",
};

export const TS9104: DiagnosticDescriptor = {
  code: 9104,
  severity: "error",
  category: DiagnosticCategory.DeriveFailed,
  messageTemplate: "Cannot derive {typeclass}: type {type} has no fields",
  explanation: `Product type derivation requires at least one field.

Empty types like \`interface Empty {}\` cannot derive most typeclasses
because there's nothing to compare, hash, clone, etc.

Solutions:
1. Add fields to the type
2. Provide a manual @instance implementation
3. Use a singleton pattern if the type is intentionally empty`,
  seeAlso: "https://typesugar.dev/errors/TS9104",
};

export const TS9105: DiagnosticDescriptor = {
  code: 9105,
  severity: "warning",
  category: DiagnosticCategory.DeriveFailed,
  messageTemplate: "@derive(Builder) is not applicable to sum types",
  explanation: `The Builder derive generates a fluent builder pattern for product types.
Sum types (discriminated unions) have multiple variants, each potentially
needing its own builder.

For sum types, consider:
1. Deriving Builder for each variant type separately
2. Using smart constructors instead of builders`,
  seeAlso: "https://typesugar.dev/errors/TS9105",
};

// ============================================================================
// Error Catalog: Macro Syntax (9200-9299)
// ============================================================================

export const TS9201: DiagnosticDescriptor = {
  code: 9201,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "{macro} expects {expected} argument(s), got {received}",
  explanation: `The macro was called with the wrong number of arguments.

Check the macro documentation for the correct signature.`,
  seeAlso: "https://typesugar.dev/errors/TS9201",
};

export const TS9202: DiagnosticDescriptor = {
  code: 9202,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "{macro} argument {index} must be a {expected}, got {received}",
  explanation: `The macro received an argument of the wrong type.

Macros have specific requirements for their arguments that are
checked at compile time.`,
  seeAlso: "https://typesugar.dev/errors/TS9202",
};

export const TS9203: DiagnosticDescriptor = {
  code: 9203,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "{macro} can only be applied to {expected}",
  explanation: `This decorator/attribute macro has restrictions on what it can decorate.

Check the macro documentation for valid targets.`,
  seeAlso: "https://typesugar.dev/errors/TS9203",
};

export const TS9204: DiagnosticDescriptor = {
  code: 9204,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "{macro} requires {expected} type argument(s)",
  explanation: `The macro requires type arguments to be provided.

Example: typeInfo<User>() instead of typeInfo()`,
  seeAlso: "https://typesugar.dev/errors/TS9204",
};

export const TS9205: DiagnosticDescriptor = {
  code: 9205,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Expected a compile-time constant string literal",
  explanation: `This argument must be a string literal known at compile time.

Correct:
  cfg("debug", x, y)
  includeStr("./template.txt")

Incorrect:
  const path = "./template.txt";
  includeStr(path)  // Variable, not a literal`,
  seeAlso: "https://typesugar.dev/errors/TS9205",
};

export const TS9206: DiagnosticDescriptor = {
  code: 9206,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Function must have a name for {macro}",
  explanation: `This macro requires a named function declaration.

Correct:
  @tailrec
  function factorial(n: number): number { ... }

Incorrect:
  @tailrec
  const factorial = (n: number) => { ... }`,
  seeAlso: "https://typesugar.dev/errors/TS9206",
};

export const TS9207: DiagnosticDescriptor = {
  code: 9207,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Function must have a body for {macro}",
  explanation: `This macro requires a function with an implementation body.

Incorrect:
  @tailrec
  declare function factorial(n: number): number;  // No body`,
  seeAlso: "https://typesugar.dev/errors/TS9207",
};

export const TS9208: DiagnosticDescriptor = {
  code: 9208,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Invalid argument type: expected {expected}",
  explanation: `The macro received an argument of an unexpected type.

Check the macro documentation for the correct argument types.`,
  seeAlso: "https://typesugar.dev/errors/TS9208",
};

export const TS9209: DiagnosticDescriptor = {
  code: 9209,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Cannot evaluate expression at compile time",
  explanation: `This expression cannot be evaluated at compile time.

Compile-time evaluation requires:
- Literal values (numbers, strings, booleans)
- Simple arithmetic and string operations
- Pure functions without side effects
- No references to runtime values`,
  seeAlso: "https://typesugar.dev/errors/TS9209",
};

export const TS9210: DiagnosticDescriptor = {
  code: 9210,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Macro {macro} is not registered",
  explanation: `The referenced macro name is not found in the registry.

Check that:
1. The macro is imported from the correct package
2. The macro name is spelled correctly
3. The macro package is installed`,
  seeAlso: "https://typesugar.dev/errors/TS9210",
};

export const TS9211: DiagnosticDescriptor = {
  code: 9211,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "{macro} expects exactly {expected} argument(s)",
  explanation: `This macro has strict argument count requirements.`,
  seeAlso: "https://typesugar.dev/errors/TS9211",
};

export const TS9212: DiagnosticDescriptor = {
  code: 9212,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Failed to read file: {path}",
  explanation: `The compile-time file read operation failed.

Check that:
1. The file path is correct and relative to the source file
2. The file exists and is readable
3. The path uses forward slashes (/) on all platforms`,
  seeAlso: "https://typesugar.dev/errors/TS9212",
};

export const TS9213: DiagnosticDescriptor = {
  code: 9213,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Failed to parse JSON from file: {path}",
  explanation: `The file was read but contains invalid JSON.

Check that:
1. The file contains valid JSON syntax
2. The file is not truncated or corrupted`,
  seeAlso: "https://typesugar.dev/errors/TS9213",
};

export const TS9214: DiagnosticDescriptor = {
  code: 9214,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Macro expansion failed: {reason}",
  explanation: `The macro's expand function threw an error or returned an invalid result.

This might be a bug in the macro implementation.`,
  seeAlso: "https://typesugar.dev/errors/TS9214",
};

export const TS9215: DiagnosticDescriptor = {
  code: 9215,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "@operator must be inside a class declaration",
  explanation: `The @operator decorator registers a method as an operator implementation.
It must be placed on a method inside a class.

Correct:
  class Vector {
    @operator("+")
    add(other: Vector): Vector { ... }
  }`,
  seeAlso: "https://typesugar.dev/errors/TS9215",
};

export const TS9216: DiagnosticDescriptor = {
  code: 9216,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "{macro} requires at least {min} argument(s)",
  explanation: `This macro requires a minimum number of arguments.`,
  seeAlso: "https://typesugar.dev/errors/TS9216",
};

export const TS9217: DiagnosticDescriptor = {
  code: 9217,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Static assertion failed: {message}",
  explanation: `A static_assert() or compileError() check failed.

The condition evaluated to false at compile time, or compileError()
was reached unconditionally.`,
  seeAlso: "https://typesugar.dev/errors/TS9217",
};

export const TS9218: DiagnosticDescriptor = {
  code: 9218,
  severity: "warning",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Compile-time warning: {message}",
  explanation: `A compileWarning() was triggered.

This is an advisory message from the compile-time code.`,
  seeAlso: "https://typesugar.dev/errors/TS9218",
};

export const TS9219: DiagnosticDescriptor = {
  code: 9219,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "static_assert condition must be a compile-time constant",
  explanation: `The condition in static_assert() must be evaluable at compile time.

Correct:
  static_assert(1 + 1 === 2, "math works")
  static_assert(typeof x === "string", "x must be string")

Incorrect:
  static_assert(fetchData().length > 0, "...")  // Runtime call`,
  seeAlso: "https://typesugar.dev/errors/TS9219",
};

export const TS9220: DiagnosticDescriptor = {
  code: 9220,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "@tailrec: {reason}",
  explanation: `The @tailrec decorator requires functions to be in tail-recursive form.

A tail-recursive call must be:
1. The last expression before returning
2. Not wrapped in other operations (like x + recurse(...))
3. Actually present (the function must call itself)`,
  seeAlso: "https://typesugar.dev/errors/TS9220",
};

export const TS9221: DiagnosticDescriptor = {
  code: 9221,
  severity: "error",
  category: DiagnosticCategory.MacroSyntax,
  messageTemplate: "Cannot specialize: {reason}",
  explanation: `The specialize() macro could not inline the function.

Common causes:
1. The function has no registered method bodies
2. The function signature doesn't match expected patterns
3. The instance doesn't have method implementations`,
  seeAlso: "https://typesugar.dev/errors/TS9221",
};

// ============================================================================
// Error Catalog: HKT Issues (9300-9399)
// ============================================================================

export const TS9301: DiagnosticDescriptor = {
  code: 9301,
  severity: "error",
  category: DiagnosticCategory.HKT,
  messageTemplate: 'Higher-kinded type {type} must define a \`_\` property that uses \`this["_"]\`',
  explanation: `Type-level functions for HKT must be parameterized via the \`_\` property.

Correct:
  interface ArrayF { _: Array<this["_"]> }
  interface MapF<K> { _: Map<K, this["_"]> }

Incorrect:
  interface StringF { _: string }  // Not parameterized!

If $<F, A> always resolves to the same type regardless of A,
the HKT encoding is phantom/unsound.`,
  seeAlso: "https://typesugar.dev/errors/TS9301",
};

export const TS9302: DiagnosticDescriptor = {
  code: 9302,
  severity: "error",
  category: DiagnosticCategory.HKT,
  messageTemplate: "@hkt can only be applied to interfaces or type aliases",
  explanation: `The @hkt decorator marks a type as a higher-kinded type constructor.
It can only be applied to interface or type alias declarations.`,
  seeAlso: "https://typesugar.dev/errors/TS9302",
};

// ============================================================================
// Error Catalog: Extension Methods (9400-9499)
// ============================================================================

export const TS9401: DiagnosticDescriptor = {
  code: 9401,
  severity: "error",
  category: DiagnosticCategory.Extension,
  messageTemplate: "No extension method '{method}' found for type '{type}'",
  explanation: `The called method is not available as an extension on this type.

Extension methods come from:
1. Typeclass instances (@instance, @derive)
2. Explicit registerExtensions() calls
3. Import-scoped extension namespaces

Check that the required typeclass or extension is imported and registered.`,
  seeAlso: "https://typesugar.dev/errors/TS9401",
};

export const TS9402: DiagnosticDescriptor = {
  code: 9402,
  severity: "error",
  category: DiagnosticCategory.Extension,
  messageTemplate: "registerExtensions expects 2 arguments: (typeName, namespace)",
  explanation: `registerExtensions() registers methods from a namespace as extensions.

Usage:
  registerExtensions("number", NumberOps);

This makes all functions in NumberOps available as methods on number.`,
  seeAlso: "https://typesugar.dev/errors/TS9402",
};

export const TS9403: DiagnosticDescriptor = {
  code: 9403,
  severity: "error",
  category: DiagnosticCategory.Extension,
  messageTemplate: "registerExtension expects 2 arguments: (typeName, function)",
  explanation: `registerExtension() registers a single function as an extension method.

Usage:
  registerExtension("string", capitalize);

This makes capitalize() available as a method on string.`,
  seeAlso: "https://typesugar.dev/errors/TS9403",
};

// ============================================================================
// Error Catalog: Comptime (9500-9599)
// ============================================================================

export const TS9501: DiagnosticDescriptor = {
  code: 9501,
  severity: "error",
  category: DiagnosticCategory.Comptime,
  messageTemplate: "Compile-time evaluation failed: {error}",
  explanation: `The comptime() block threw an error during compile-time evaluation.

This could be:
1. A runtime error in the evaluated code
2. An operation not supported in compile-time context
3. A dependency on runtime values`,
  seeAlso: "https://typesugar.dev/errors/TS9501",
};

export const TS9502: DiagnosticDescriptor = {
  code: 9502,
  severity: "error",
  category: DiagnosticCategory.Comptime,
  messageTemplate: "comptime() requires exactly 1 argument (a function to evaluate)",
  explanation: `comptime() evaluates a function at compile time.

Correct:
  comptime(() => fibonacci(10))

Incorrect:
  comptime(fibonacci, 10)  // Too many args
  comptime()               // Missing arg`,
  seeAlso: "https://typesugar.dev/errors/TS9502",
};

// ============================================================================
// Error Catalog: Import/Module Resolution (9700-9799)
// ============================================================================

export const TS9701: DiagnosticDescriptor = {
  code: 9701,
  severity: "error",
  category: DiagnosticCategory.ImportResolution,
  messageTemplate: "Did you mean to import '{suggestion}' from '{module}'?",
  explanation: `An unresolved identifier matches a known typeclass or extension.

The symbol exists but isn't imported. Add the suggested import
to resolve this error.`,
  seeAlso: "https://typesugar.dev/errors/TS9701",
};

export const TS9702: DiagnosticDescriptor = {
  code: 9702,
  severity: "warning",
  category: DiagnosticCategory.ImportResolution,
  messageTemplate: "Operator `{operator}` on {type} is not rewritten in explicit mode",
  explanation: `In explicit resolution mode, operators are only rewritten when
the typeclass is explicitly imported and used.

To enable automatic rewriting:
1. Import the typeclass: import { Eq } from "@typesugar/std"
2. Or switch to automatic mode in typesugar.config.json`,
  seeAlso: "https://typesugar.dev/errors/TS9702",
};

export const TS9703: DiagnosticDescriptor = {
  code: 9703,
  severity: "error",
  category: DiagnosticCategory.ImportResolution,
  messageTemplate: "Ambiguous resolution: both '{source1}' and '{source2}' provide '{symbol}'",
  explanation: `Multiple imports provide the same symbol, creating ambiguity.

Solutions:
1. Use explicit imports to disambiguate
2. Alias one of the imports: import { x as y } from "..."`,
  seeAlso: "https://typesugar.dev/errors/TS9703",
};

// ============================================================================
// Error Catalog: Operator System (9800-9899)
// ============================================================================

export const TS9800: DiagnosticDescriptor = {
  code: 9800,
  severity: "error",
  category: DiagnosticCategory.Operator,
  messageTemplate: "Operator '{operator}' cannot be overloaded with @operator",
  explanation: `Certain operators have fixed semantics and cannot be overloaded:
- Assignment operators (=, +=, etc.)
- Logical operators (&&, ||)
- Comma operator (,)

Use method calls or alternative patterns for these operations.`,
  seeAlso: "https://typesugar.dev/errors/TS9800",
};

export const TS9801: DiagnosticDescriptor = {
  code: 9801,
  severity: "error",
  category: DiagnosticCategory.Operator,
  messageTemplate: "Binary operator '{operator}' requires exactly 1 parameter (the right operand)",
  explanation: `Operator methods follow the pattern: left.operator(right)

Correct:
  @operator("+")
  add(other: Vector): Vector { ... }  // 1 param for right side

Incorrect:
  @operator("+")
  add(a: Vector, b: Vector): Vector { ... }  // Too many params`,
  seeAlso: "https://typesugar.dev/errors/TS9801",
};

export const TS9802: DiagnosticDescriptor = {
  code: 9802,
  severity: "error",
  category: DiagnosticCategory.Operator,
  messageTemplate:
    "Operator '{operator}' is handled by the preprocessor and cannot be registered with @operator",
  explanation: `Custom operators like |>, ::, and <| are transformed at the lexical level by the preprocessor.

They cannot be registered with @operator because @operator is for standard JavaScript operators.

For custom operators:
- Implement a method that __binop__ can dispatch to
- Use @instance to define typeclass behavior`,
  seeAlso: "https://typesugar.dev/errors/TS9802",
};

export const TS9803: DiagnosticDescriptor = {
  code: 9803,
  severity: "warning",
  category: DiagnosticCategory.Operator,
  messageTemplate: "Unknown custom operator '{operator}' with no registered method",
  explanation: `The __binop__ macro encountered an operator that:
- Is not a built-in operator (|>, <|, ::)
- Has no method registered via @operator

The expression will be left as-is, which may cause a runtime error.

To register a custom operator:
  @operator("|>")
  myPipe(right: (a: A) => B): B { ... }

Or use a built-in operator: |>, <|, ::`,
  seeAlso: "https://typesugar.dev/errors/TS9803",
};

// ============================================================================
// Error Catalog: Internal Errors (9900-9999)
// ============================================================================

export const TS9999: DiagnosticDescriptor = {
  code: 9999,
  severity: "error",
  category: DiagnosticCategory.Internal,
  messageTemplate: "Internal error: {message}",
  explanation: `This is an internal error in typesugar that should not happen.

Please report this issue at https://github.com/typesugar/typesugar/issues with:
- The error message
- A minimal reproduction
- Your typesugar version`,
  seeAlso: "https://github.com/typesugar/typesugar/issues",
};

// ============================================================================
// Error Code Registry
// ============================================================================

/** All registered diagnostic descriptors by code */
export const DIAGNOSTIC_CATALOG: Map<number, DiagnosticDescriptor> = new Map([
  // Typeclass Resolution (9001-9099)
  [9001, TS9001],
  [9002, TS9002],
  [9003, TS9003],
  [9004, TS9004],
  [9005, TS9005],
  [9006, TS9006],
  [9007, TS9007],
  [9008, TS9008],
  [9009, TS9009],

  // Coherence Checking (9050-9059)
  [9050, TS9050],
  [9051, TS9051],
  [9052, TS9052],

  // Import Suggestions (9060-9069)
  [9060, TS9060],
  [9061, TS9061],
  [9062, TS9062],
  [9063, TS9063],

  // Derive Failures (9100-9199)
  [9101, TS9101],
  [9102, TS9102],
  [9103, TS9103],
  [9104, TS9104],
  [9105, TS9105],

  // Macro Syntax (9200-9299)
  [9201, TS9201],
  [9202, TS9202],
  [9203, TS9203],
  [9204, TS9204],
  [9205, TS9205],
  [9206, TS9206],
  [9207, TS9207],
  [9208, TS9208],
  [9209, TS9209],
  [9210, TS9210],
  [9211, TS9211],
  [9212, TS9212],
  [9213, TS9213],
  [9214, TS9214],
  [9215, TS9215],
  [9216, TS9216],
  [9217, TS9217],
  [9218, TS9218],
  [9219, TS9219],
  [9220, TS9220],
  [9221, TS9221],

  // HKT Issues (9300-9399)
  [9301, TS9301],
  [9302, TS9302],

  // Extension Methods (9400-9499)
  [9401, TS9401],
  [9402, TS9402],
  [9403, TS9403],

  // Comptime (9500-9599)
  [9501, TS9501],
  [9502, TS9502],

  // Import/Module Resolution (9700-9799)
  [9701, TS9701],
  [9702, TS9702],
  [9703, TS9703],

  // Operator System (9800-9899)
  [9800, TS9800],
  [9801, TS9801],
  [9802, TS9802],
  [9803, TS9803],

  // Internal Errors (9900-9999)
  [9999, TS9999],
]);

/**
 * Get a diagnostic descriptor by code.
 */
export function getDiagnosticDescriptor(code: number): DiagnosticDescriptor | undefined {
  return DIAGNOSTIC_CATALOG.get(code);
}

/**
 * Get all diagnostic descriptors for a category.
 */
export function getDiagnosticsByCategory(category: DiagnosticCategory): DiagnosticDescriptor[] {
  return Array.from(DIAGNOSTIC_CATALOG.values()).filter((d) => d.category === category);
}

// ============================================================================
// Utility: Convert RichDiagnostic to Legacy MacroDiagnostic
// ============================================================================

import type { MacroDiagnostic } from "./types.js";

/**
 * Convert a RichDiagnostic to the legacy MacroDiagnostic format.
 * Used for backward compatibility.
 */
export function richToLegacyDiagnostic(rich: RichDiagnostic): MacroDiagnostic {
  let message = `[TS${rich.code}] ${rich.message}`;

  if (rich.notes.length > 0) {
    message += "\n" + rich.notes.map((n) => `  = note: ${n}`).join("\n");
  }

  if (rich.help) {
    message += `\n  = help: ${rich.help}`;
  }

  return {
    severity: rich.severity,
    message,
    node: rich.primarySpan?.node,
    suggestion: rich.suggestions.length > 0 ? rich.suggestions[0].replacement : undefined,
  };
}

/**
 * Create a RichDiagnostic from a legacy string-based error.
 * Used when migrating from ctx.reportError() to structured diagnostics.
 */
export function legacyToRichDiagnostic(
  message: string,
  severity: "error" | "warning" | "info",
  node?: ts.Node,
  sourceFile?: ts.SourceFile
): RichDiagnostic {
  return {
    code: 9999,
    severity,
    category: DiagnosticCategory.Internal,
    message,
    primarySpan: node && sourceFile ? { node, sourceFile } : undefined,
    labels: [],
    notes: [],
    suggestions: [],
  };
}

// ============================================================================
// CLI Renderer: Rust-Style Error Output
// ============================================================================

/**
 * ANSI color codes for terminal output.
 * Set NO_COLOR or TYPESUGAR_NO_COLOR to disable.
 */
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
} as const;

/**
 * Check if color output should be enabled.
 */
function colorsEnabled(): boolean {
  if (typeof process === "undefined") return false;
  const env = process.env;
  return !env.NO_COLOR && !env.TYPESUGAR_NO_COLOR && env.FORCE_COLOR !== "0";
}

/**
 * Apply color if colors are enabled.
 */
function color(text: string, ...styles: (keyof typeof COLORS)[]): string {
  if (!colorsEnabled()) return text;
  const prefix = styles.map((s) => COLORS[s]).join("");
  return `${prefix}${text}${COLORS.reset}`;
}

/**
 * Get the severity color.
 */
function severityColor(severity: "error" | "warning" | "info"): "red" | "yellow" | "cyan" {
  switch (severity) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    case "info":
      return "cyan";
  }
}

/**
 * Get line and column from a node's position.
 */
function getLineAndColumn(
  sourceFile: ts.SourceFile,
  pos: number
): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: line + 1, column: character + 1 };
}

/**
 * Get the text of a specific line in a source file.
 */
function getLineText(sourceFile: ts.SourceFile, lineNumber: number): string {
  const lines = sourceFile.text.split("\n");
  return lines[lineNumber - 1] ?? "";
}

/**
 * Calculate the width needed for line numbers.
 */
function lineNumberWidth(maxLine: number): number {
  return Math.max(3, String(maxLine).length);
}

/**
 * Format a line number with padding.
 */
function formatLineNumber(lineNum: number, width: number): string {
  return String(lineNum).padStart(width, " ");
}

/**
 * Create an underline annotation string.
 */
function createUnderline(startColumn: number, length: number, char: string = "^"): string {
  const padding = " ".repeat(startColumn - 1);
  const underline = char.repeat(Math.max(1, length));
  return padding + underline;
}

/**
 * Options for CLI rendering.
 */
export interface CLIRenderOptions {
  /** Whether to use colors (default: auto-detect) */
  colors?: boolean;
  /** Maximum number of context lines before/after the error (default: 2) */
  contextLines?: number;
  /** Whether to show the explanation (default: false) */
  showExplanation?: boolean;
  /** Custom writer function (default: console.error) */
  writer?: (line: string) => void;
}

/**
 * Render a RichDiagnostic to CLI output in Rust-style format.
 *
 * @example Output:
 * ```
 * error[TS9001]: No instance found for `Eq<Point>`
 *   --> src/example.ts:15:10
 *    |
 * 14 |   interface Point { x: number; y: number }
 * 15 |   p1 === p2
 *    |      ^^^ Eq<Point> is required here
 *    |
 *    = note: Auto-derivation requires Eq instances for all fields
 *    = help: Add @derive(Eq) to Point
 * ```
 */
export function renderDiagnosticCLI(
  diagnostic: RichDiagnostic,
  options: CLIRenderOptions = {}
): string {
  const { contextLines = 2, showExplanation = false } = options;

  const lines: string[] = [];
  const severityStr = diagnostic.severity;
  const severityClr = severityColor(severityStr);

  // Header line: error[TS9001]: message
  const header = `${color(severityStr, "bold", severityClr)}${color(`[TS${diagnostic.code}]`, "bold", severityClr)}: ${color(diagnostic.message, "bold")}`;
  lines.push(header);

  // Location line: --> file:line:column
  if (diagnostic.primarySpan) {
    const { node, sourceFile } = diagnostic.primarySpan;
    const { line, column } = getLineAndColumn(sourceFile, node.getStart());
    const fileName = sourceFile.fileName;
    lines.push(`  ${color("-->", "blue")} ${fileName}:${line}:${column}`);
  }

  // Source context with annotations
  if (diagnostic.primarySpan) {
    const { node, sourceFile } = diagnostic.primarySpan;
    const startPos = getLineAndColumn(sourceFile, node.getStart());
    const endPos = getLineAndColumn(sourceFile, node.getEnd());

    const minLine = Math.max(1, startPos.line - contextLines);
    const maxLine = endPos.line + contextLines;
    const numWidth = lineNumberWidth(maxLine);
    const gutter = " ".repeat(numWidth);

    // Empty gutter line
    lines.push(` ${gutter} ${color("|", "blue")}`);

    // Source lines with annotations
    for (let lineNum = minLine; lineNum <= maxLine; lineNum++) {
      const lineText = getLineText(sourceFile, lineNum);
      const lineNumStr = formatLineNumber(lineNum, numWidth);
      lines.push(` ${color(lineNumStr, "blue")} ${color("|", "blue")} ${lineText}`);

      // Primary span annotation
      if (lineNum >= startPos.line && lineNum <= endPos.line) {
        // Calculate span on this line
        const lineStartCol = lineNum === startPos.line ? startPos.column : 1;
        const lineEndCol = lineNum === endPos.line ? endPos.column : lineText.length + 1;
        const spanLength = Math.max(1, lineEndCol - lineStartCol);

        const underline = createUnderline(lineStartCol, spanLength, "^");
        lines.push(` ${gutter} ${color("|", "blue")} ${color(underline, severityClr)}`);
      }
    }

    // Secondary labels
    for (const label of diagnostic.labels) {
      if (!label.primary) {
        const labelStart = getLineAndColumn(sourceFile, label.node.getStart());
        const labelEnd = getLineAndColumn(sourceFile, label.node.getEnd());

        // If the label is outside the current context, show it separately
        if (labelStart.line < minLine || labelStart.line > maxLine) {
          lines.push(` ${gutter} ${color("|", "blue")}`);
          const labelLineText = getLineText(sourceFile, labelStart.line);
          const labelLineNum = formatLineNumber(labelStart.line, numWidth);
          lines.push(` ${color(labelLineNum, "blue")} ${color("|", "blue")} ${labelLineText}`);

          const spanLength = Math.max(1, labelEnd.column - labelStart.column);
          const underline = createUnderline(labelStart.column, spanLength, "-");
          lines.push(
            ` ${gutter} ${color("|", "blue")} ${color(underline, "blue")} ${color(label.message, "blue")}`
          );
        }
      }
    }

    // Closing gutter line
    lines.push(` ${gutter} ${color("|", "blue")}`);
  }

  // Notes
  for (const note of diagnostic.notes) {
    lines.push(`   ${color("= note:", "bold")} ${note}`);
  }

  // Help
  if (diagnostic.help) {
    lines.push(`   ${color("= help:", "bold", "green")} ${diagnostic.help}`);
  }

  // Suggestions
  for (const suggestion of diagnostic.suggestions) {
    lines.push(`   ${color("= suggestion:", "bold", "cyan")} ${suggestion.description}`);
    if (suggestion.replacement) {
      const replacementLines = suggestion.replacement.split("\n");
      for (const repLine of replacementLines) {
        lines.push(`     ${color("+", "green")} ${repLine}`);
      }
    }
  }

  // Explanation (if requested)
  if (showExplanation && diagnostic.explanation) {
    lines.push("");
    lines.push(color("Explanation:", "bold"));
    for (const expLine of diagnostic.explanation.split("\n")) {
      lines.push(`  ${expLine}`);
    }
  }

  // See also link
  if (diagnostic.seeAlso) {
    lines.push("");
    lines.push(`For more information, see: ${color(diagnostic.seeAlso, "cyan")}`);
  }

  return lines.join("\n");
}

/**
 * Print a RichDiagnostic to the console (stderr).
 */
export function printDiagnostic(diagnostic: RichDiagnostic, options: CLIRenderOptions = {}): void {
  const writer = options.writer ?? ((line: string) => console.error(line));
  writer(renderDiagnosticCLI(diagnostic, options));
}

/**
 * Render multiple diagnostics with a summary.
 */
export function renderDiagnosticsCLI(
  diagnostics: RichDiagnostic[],
  options: CLIRenderOptions = {}
): string {
  if (diagnostics.length === 0) {
    return "";
  }

  const lines: string[] = [];

  for (const diag of diagnostics) {
    lines.push(renderDiagnosticCLI(diag, options));
    lines.push(""); // Blank line between diagnostics
  }

  // Summary
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(color(`${errorCount} error${errorCount > 1 ? "s" : ""}`, "bold", "red"));
  }
  if (warnCount > 0) {
    parts.push(color(`${warnCount} warning${warnCount > 1 ? "s" : ""}`, "bold", "yellow"));
  }

  if (parts.length > 0) {
    lines.push(`${parts.join(", ")} generated`);
  }

  return lines.join("\n");
}

/**
 * Print multiple diagnostics with a summary.
 */
export function printDiagnostics(
  diagnostics: RichDiagnostic[],
  options: CLIRenderOptions = {}
): void {
  const writer = options.writer ?? ((line: string) => console.error(line));
  writer(renderDiagnosticsCLI(diagnostics, options));
}
