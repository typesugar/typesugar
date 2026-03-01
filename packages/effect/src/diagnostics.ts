/**
 * Effect-TS Diagnostics
 *
 * Package-local diagnostic codes for Effect-specific errors and warnings.
 * These complement the core typesugar diagnostics (TS9xxx) with Effect-aware
 * messaging for service resolution, error completeness, layer dependencies,
 * schema drift, and type simplification.
 *
 * ## Diagnostic Code Ranges
 *
 * - EFFECT001-003: Service/layer resolution
 * - EFFECT010-011: Error completeness checking
 * - EFFECT020-021: Layer dependencies/cycles
 * - EFFECT030: Schema drift detection
 * - EFFECT040: Type simplification suggestions
 *
 * @module
 */

import type * as ts from "typescript";

// ============================================================================
// Effect Diagnostic Category
// ============================================================================

export enum EffectDiagnosticCategory {
  ServiceResolution = "service-resolution",
  ErrorCompleteness = "error-completeness",
  LayerDependency = "layer-dependency",
  SchemaDrift = "schema-drift",
  TypeSimplification = "type-simplification",
}

// ============================================================================
// Effect Diagnostic Descriptor
// ============================================================================

export interface EffectDiagnosticDescriptor {
  /** Unique error code (EFFECT001-EFFECT040) */
  readonly code: string;

  /** Numeric code for tooling compatibility */
  readonly numericCode: number;

  /** Default severity */
  readonly severity: "error" | "warning" | "info";

  /** Category for filtering */
  readonly category: EffectDiagnosticCategory;

  /** Message template with {placeholders} */
  readonly messageTemplate: string;

  /** Long-form explanation */
  readonly explanation: string;

  /** URL to documentation */
  readonly seeAlso?: string;
}

// ============================================================================
// Service/Layer Resolution (EFFECT001-003)
// ============================================================================

/**
 * EFFECT001: No layer provides the required service
 *
 * Emitted when Effect.provide() is called but no layer provides a required service.
 */
export const EFFECT001: EffectDiagnosticDescriptor = {
  code: "EFFECT001",
  numericCode: 9901,
  severity: "error",
  category: EffectDiagnosticCategory.ServiceResolution,
  messageTemplate: "No layer provides `{service}`",
  explanation: `The Effect requires a service that is not provided by any registered layer.

Effect<{successType}, {errorType}, {requirements}> needs:
- {service} (no layer found)

To fix:
1. Define a layer for the service:
   @layer({service})
   const {serviceLower}Live = { ... }

2. Or provide the service directly:
   Effect.provideService(program, {service}, impl)

If the service is from a library, ensure you import its layer.`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT001",
};

/**
 * EFFECT002: Layer provides wrong service type
 *
 * Emitted when a layer claims to provide a service but the implementation
 * doesn't match the service interface.
 */
export const EFFECT002: EffectDiagnosticDescriptor = {
  code: "EFFECT002",
  numericCode: 9902,
  severity: "error",
  category: EffectDiagnosticCategory.ServiceResolution,
  messageTemplate: "Layer `{layer}` provides `{service}` but implementation is incompatible",
  explanation: `The layer declares it provides {service}, but its implementation
doesn't satisfy the service interface.

Missing methods:
{missingMethods}

Mismatched signatures:
{mismatchedSignatures}

Ensure the layer implementation matches the @service interface exactly.`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT002",
};

/**
 * EFFECT003: Ambiguous layer resolution
 *
 * Emitted when multiple layers provide the same service.
 */
export const EFFECT003: EffectDiagnosticDescriptor = {
  code: "EFFECT003",
  numericCode: 9903,
  severity: "warning",
  category: EffectDiagnosticCategory.ServiceResolution,
  messageTemplate: "Multiple layers provide `{service}`",
  explanation: `More than one layer is registered as providing {service}:
{layers}

The first registered layer will be used. To resolve:
1. Remove duplicate layer definitions
2. Use explicit Layer.provide() instead of resolveLayer()
3. Rename one layer to provide a different service`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT003",
};

// ============================================================================
// Error Completeness (EFFECT010-011)
// ============================================================================

/**
 * EFFECT010: Unhandled error types
 *
 * Emitted when Effect.catchTag or similar doesn't cover all error types.
 */
export const EFFECT010: EffectDiagnosticDescriptor = {
  code: "EFFECT010",
  numericCode: 9910,
  severity: "warning",
  category: EffectDiagnosticCategory.ErrorCompleteness,
  messageTemplate: "Error handler doesn't cover all error types",
  explanation: `The error handler covers some but not all error types in the union.

Handled:
{handledErrors}

Unhandled:
{unhandledErrors}

Sources of unhandled errors:
{errorSources}

To fix:
1. Add handlers for the unhandled types:
   .pipe(
     Effect.catchTag("{unhandledExample}", (e) => ...),
   )

2. Or use Effect.catchAll to handle everything:
   .pipe(Effect.catchAll((e) => ...))

3. Or explicitly let errors propagate (if intentional).`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT010",
};

/**
 * EFFECT011: Redundant error handler
 *
 * Emitted when catchTag handles an error type that can't occur.
 */
export const EFFECT011: EffectDiagnosticDescriptor = {
  code: "EFFECT011",
  numericCode: 9911,
  severity: "info",
  category: EffectDiagnosticCategory.ErrorCompleteness,
  messageTemplate: "Redundant error handler for `{errorType}` — this error cannot occur",
  explanation: `The error handler for {errorType} will never be triggered because
the Effect's error type doesn't include {errorType}.

Current error type: {actualErrorType}

This could indicate:
1. Dead code that should be removed
2. An earlier handler already caught this error
3. The error was eliminated by a previous operation`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT011",
};

// ============================================================================
// Layer Dependencies (EFFECT020-021)
// ============================================================================

/**
 * EFFECT020: Circular layer dependency
 *
 * Emitted when layers form a dependency cycle.
 */
export const EFFECT020: EffectDiagnosticDescriptor = {
  code: "EFFECT020",
  numericCode: 9920,
  severity: "error",
  category: EffectDiagnosticCategory.LayerDependency,
  messageTemplate: "Circular layer dependency detected",
  explanation: `The layer dependency graph contains a cycle:

{cycleVisualization}

Layers cannot be composed when they depend on each other (directly or transitively).

To fix:
1. Identify the unnecessary dependency in the cycle
2. Extract shared functionality into a separate layer
3. Use Layer.passthrough for optional dependencies`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT020",
};

/**
 * EFFECT021: Unused layer in composition
 *
 * Emitted when a layer is provided but not required by any Effect.
 */
export const EFFECT021: EffectDiagnosticDescriptor = {
  code: "EFFECT021",
  numericCode: 9921,
  severity: "info",
  category: EffectDiagnosticCategory.LayerDependency,
  messageTemplate: "Layer `{layer}` is provided but not required",
  explanation: `The layer {layer} (providing {service}) is included in the composition
but no Effect in this scope requires {service}.

This could indicate:
1. Dead code — the layer can be removed
2. Missing usage — an Effect should use {service}
3. Future-proofing — intentionally included for later use

If intentional, add a comment explaining why.`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT021",
};

// ============================================================================
// Schema Drift (EFFECT030)
// ============================================================================

/**
 * EFFECT030: Schema drift detected
 *
 * Emitted when a type and its Schema definition don't match.
 */
export const EFFECT030: EffectDiagnosticDescriptor = {
  code: "EFFECT030",
  numericCode: 9930,
  severity: "error",
  category: EffectDiagnosticCategory.SchemaDrift,
  messageTemplate: "Schema `{schemaName}` is out of sync with type `{typeName}`",
  explanation: `The Schema definition doesn't match the TypeScript type.

Type fields:
{typeFields}

Schema fields:
{schemaFields}

Differences:
{differences}

To fix:
1. Update the Schema to match the type
2. Or use @derive(EffectSchema) to auto-generate
3. Or use Schema.from(existingSchema).pipe(...) for migrations`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT030",
};

// ============================================================================
// Type Simplification (EFFECT040)
// ============================================================================

/**
 * EFFECT040: Type could be simplified
 *
 * Suggests simpler Effect type representations.
 */
export const EFFECT040: EffectDiagnosticDescriptor = {
  code: "EFFECT040",
  numericCode: 9940,
  severity: "info",
  category: EffectDiagnosticCategory.TypeSimplification,
  messageTemplate: "Effect type could be simplified",
  explanation: `The Effect type {current} can be expressed more simply as {suggested}.

Common simplifications:
- Effect<A, never, never> → Effect.Effect<A>
- Effect<A, E, never> → Effect.Effect<A, E>
- Effect<void, never, R> → Effect.Effect<void, never, R>

Simpler types improve readability and IDE performance.`,
  seeAlso: "https://typesugar.dev/effect/errors/EFFECT040",
};

// ============================================================================
// Diagnostic Catalog
// ============================================================================

/**
 * All Effect diagnostic descriptors for lookup.
 */
export const effectDiagnostics = {
  EFFECT001,
  EFFECT002,
  EFFECT003,
  EFFECT010,
  EFFECT011,
  EFFECT020,
  EFFECT021,
  EFFECT030,
  EFFECT040,
} as const;

/**
 * Get an Effect diagnostic by code.
 */
export function getEffectDiagnostic(code: string): EffectDiagnosticDescriptor | undefined {
  return (effectDiagnostics as Record<string, EffectDiagnosticDescriptor>)[code];
}

// ============================================================================
// Rich Diagnostic Types (Effect-specific)
// ============================================================================

/**
 * A labeled span pointing at specific code with a message.
 */
export interface EffectLabeledSpan {
  node: ts.Node;
  message: string;
  primary?: boolean;
}

/**
 * A code suggestion for fixing an Effect error.
 */
export interface EffectCodeSuggestion {
  id: string;
  description: string;
  node: ts.Node;
  replacement: string;
  isPreferred?: boolean;
}

/**
 * Rich Effect diagnostic with all context.
 */
export interface EffectRichDiagnostic {
  code: string;
  numericCode: number;
  severity: "error" | "warning" | "info";
  category: EffectDiagnosticCategory;
  message: string;
  primarySpan?: { node: ts.Node; sourceFile: ts.SourceFile };
  labels: EffectLabeledSpan[];
  notes: string[];
  help?: string;
  suggestions: EffectCodeSuggestion[];
  explanation?: string;
  seeAlso?: string;
}

// ============================================================================
// Diagnostic Builder
// ============================================================================

type DiagnosticEmitter = (diagnostic: EffectRichDiagnostic) => void;

/**
 * Fluent builder for constructing Effect diagnostics.
 *
 * @example
 * ```typescript
 * EffectDiagnosticBuilder(EFFECT001, sourceFile, emitter)
 *   .at(callExpr)
 *   .withArgs({ service: "UserRepo" })
 *   .note("Required by Accounts, which is required by Http")
 *   .help("Add @layer(UserRepo) const userRepoLive = { ... }")
 *   .emit();
 * ```
 */
export class EffectDiagnosticBuilder {
  private descriptor: EffectDiagnosticDescriptor;
  private sourceFile: ts.SourceFile;
  private emitter: DiagnosticEmitter;

  private primaryNode?: ts.Node;
  private args: Record<string, string> = {};
  private labels: EffectLabeledSpan[] = [];
  private notes: string[] = [];
  private helpText?: string;
  private suggestions: EffectCodeSuggestion[] = [];
  private overrideSeverity?: "error" | "warning" | "info";

  constructor(
    descriptor: EffectDiagnosticDescriptor,
    sourceFile: ts.SourceFile,
    emitter: DiagnosticEmitter
  ) {
    this.descriptor = descriptor;
    this.sourceFile = sourceFile;
    this.emitter = emitter;
  }

  /**
   * Set the primary span (main error location).
   */
  at(node: ts.Node): this {
    this.primaryNode = node;
    return this;
  }

  /**
   * Provide template arguments for message interpolation.
   */
  withArgs(args: Record<string, string>): this {
    this.args = { ...this.args, ...args };
    return this;
  }

  /**
   * Add a labeled secondary span.
   */
  label(node: ts.Node, message: string): this {
    this.labels.push({ node, message, primary: false });
    return this;
  }

  /**
   * Add a note (not attached to a span).
   */
  note(message: string): this {
    this.notes.push(message);
    return this;
  }

  /**
   * Add help text (actionable suggestion).
   */
  help(text: string): this {
    this.helpText = text;
    return this;
  }

  /**
   * Add a machine-applicable code suggestion.
   */
  suggestion(node: ts.Node, id: string, replacement: string, isPreferred = false): this {
    this.suggestions.push({
      id,
      description: `Apply suggested fix: ${id}`,
      node,
      replacement,
      isPreferred,
    });
    return this;
  }

  /**
   * Override the default severity.
   */
  severity(level: "error" | "warning" | "info"): this {
    this.overrideSeverity = level;
    return this;
  }

  /**
   * Build and emit the diagnostic.
   */
  emit(): void {
    const message = this.interpolateMessage();

    const diagnostic: EffectRichDiagnostic = {
      code: this.descriptor.code,
      numericCode: this.descriptor.numericCode,
      severity: this.overrideSeverity ?? this.descriptor.severity,
      category: this.descriptor.category,
      message,
      primarySpan: this.primaryNode
        ? { node: this.primaryNode, sourceFile: this.sourceFile }
        : undefined,
      labels: this.labels,
      notes: this.notes,
      help: this.helpText,
      suggestions: this.suggestions,
      explanation: this.descriptor.explanation,
      seeAlso: this.descriptor.seeAlso,
    };

    this.emitter(diagnostic);
  }

  private interpolateMessage(): string {
    let message = this.descriptor.messageTemplate;
    for (const [key, value] of Object.entries(this.args)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }
    return message;
  }
}

// ============================================================================
// Diagnostic Formatters
// ============================================================================

/**
 * Format an Effect diagnostic for CLI output (Rust-style).
 */
export function formatEffectDiagnosticCLI(diag: EffectRichDiagnostic): string {
  const lines: string[] = [];

  // Header: error[EFFECT001]: message
  lines.push(`${diag.severity}[${diag.code}]: ${diag.message}`);

  // Primary span location
  if (diag.primarySpan) {
    const { node, sourceFile } = diag.primarySpan;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const fileName = sourceFile.fileName;
    lines.push(` --> ${fileName}:${line + 1}:${character + 1}`);
    lines.push("  |");

    // Show the source line with annotation
    const lineStart = sourceFile.getLineStarts()[line];
    const lineEnd =
      line + 1 < sourceFile.getLineStarts().length
        ? sourceFile.getLineStarts()[line + 1]
        : sourceFile.text.length;
    const lineText = sourceFile.text.slice(lineStart, lineEnd).trimEnd();

    const lineNum = String(line + 1).padStart(4, " ");
    lines.push(`${lineNum}| ${lineText}`);

    // Underline annotation
    const nodeStart = node.getStart() - lineStart;
    const nodeLength = node.getWidth();
    const underline = " ".repeat(nodeStart) + "^".repeat(Math.max(1, nodeLength));
    lines.push(`    | ${underline}`);
    lines.push("  |");
  }

  // Notes
  for (const note of diag.notes) {
    lines.push(`  = note: ${note}`);
  }

  // Help
  if (diag.help) {
    lines.push(`  = help: ${diag.help}`);
  }

  return lines.join("\n");
}

/**
 * Convert an Effect diagnostic to a TypeScript diagnostic.
 */
export function toTsDiagnostic(diag: EffectRichDiagnostic): ts.Diagnostic {
  const category =
    diag.severity === "error"
      ? 1 // ts.DiagnosticCategory.Error
      : diag.severity === "warning"
        ? 0 // ts.DiagnosticCategory.Warning
        : 2; // ts.DiagnosticCategory.Message

  const start = diag.primarySpan?.node.getStart() ?? 0;
  const length = diag.primarySpan?.node.getWidth() ?? 0;

  let messageText = diag.message;
  if (diag.notes.length > 0) {
    messageText += "\n\nNotes:\n" + diag.notes.map((n) => `- ${n}`).join("\n");
  }
  if (diag.help) {
    messageText += "\n\nHelp: " + diag.help;
  }

  return {
    file: diag.primarySpan?.sourceFile,
    start,
    length,
    messageText,
    category,
    code: diag.numericCode,
    source: "typesugar-effect",
  };
}
