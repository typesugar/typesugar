/**
 * Custom Derive Macro API
 *
 * Provides an API for defining custom derive macros that generate AST
 * statements via `ts.factory.create*`. For advanced use cases, the raw
 * DeriveTypeInfo is available via `defineCustomDeriveAst`.
 *
 * Inspired by: Rust's `#[derive(...)]` with custom derive procedural macros
 *
 * @example
 * ```typescript
 * import { defineCustomDerive } from "typesugar";
 *
 * defineCustomDerive("ToString", (ctx, info) => {
 *   const factory = ctx.factory;
 *   // Build a toString function via AST factory
 *   return [factory.createFunctionDeclaration(...)];
 * });
 *
 * // Usage:
 * @derive(ToString)
 * interface Point { x: number; y: number; }
 * ```
 */

import * as ts from "typescript";
import { globalRegistry, defineDeriveMacro } from "@typesugar/core";
import { MacroContext, DeriveTypeInfo, DeriveFieldInfo, DeriveMacro } from "@typesugar/core";

// =============================================================================
// Simplified Type Info
// =============================================================================

/**
 * Simplified field information for custom derive macros.
 * Provides convenient accessors without exposing ts.Type internals.
 */
export interface SimpleFieldInfo {
  /** Field name */
  name: string;

  /** Field type as a string (e.g., "number", "string[]", "Map<string, number>") */
  type: string;

  /** Is the field optional? */
  optional: boolean;

  /** Is the field readonly? */
  readonly: boolean;
}

/**
 * Simplified type information for custom derive macros.
 */
export interface SimpleTypeInfo {
  /** Type name (e.g., "Point", "User") */
  name: string;

  /** All fields of the type */
  fields: SimpleFieldInfo[];

  /** Type parameter names (e.g., ["T", "U"] for `interface Foo<T, U>`) */
  typeParams: string[];

  /** Number of fields */
  fieldCount: number;

  /** Get field names as an array */
  fieldNames: string[];

  /** Check if a field exists */
  hasField(name: string): boolean;

  /** Get a specific field by name */
  getField(name: string): SimpleFieldInfo | undefined;
}

/**
 * Convert internal DeriveTypeInfo to the simplified format.
 */
function toSimpleTypeInfo(typeInfo: DeriveTypeInfo): SimpleTypeInfo {
  const fields: SimpleFieldInfo[] = typeInfo.fields.map((f) => ({
    name: f.name,
    type: f.typeString,
    optional: f.optional,
    readonly: f.readonly,
  }));

  const typeParams = typeInfo.typeParameters.map((tp) => tp.name.text);

  return {
    name: typeInfo.name,
    fields,
    typeParams,
    fieldCount: fields.length,
    fieldNames: fields.map((f) => f.name),
    hasField: (name: string) => fields.some((f) => f.name === name),
    getField: (name: string) => fields.find((f) => f.name === name),
  };
}

// =============================================================================
// Custom Derive Callback Types
// =============================================================================

/**
 * A custom derive callback that returns AST statements directly.
 */
export type CustomDeriveCallback = (ctx: MacroContext, info: SimpleTypeInfo) => ts.Statement[];

/**
 * A custom derive callback with access to raw DeriveTypeInfo.
 * For advanced use cases that need full AST control.
 */
export type AstDeriveCallback = (
  ctx: MacroContext,
  info: SimpleTypeInfo,
  rawInfo: DeriveTypeInfo
) => ts.Statement[];

// =============================================================================
// defineCustomDerive — String-based API
// =============================================================================

/**
 * Define a custom derive macro using an AST-returning callback.
 *
 * The callback receives the macro context and simplified type information,
 * and returns AST statements built via `ts.factory.create*`.
 *
 * @param name - The derive name (used in `@derive(Name)`)
 * @param callback - Function that generates AST statements from type info
 * @param options - Optional configuration
 * @returns The registered DeriveMacro
 *
 * @example
 * ```typescript
 * defineCustomDerive("Printable", (ctx, info) => {
 *   const factory = ctx.factory;
 *   // Build AST statements using factory.create*
 *   return [factory.createExpressionStatement(...)];
 * });
 * ```
 */
export function defineCustomDerive(
  name: string,
  callback: CustomDeriveCallback,
  options?: {
    module?: string;
    description?: string;
  }
): DeriveMacro {
  const macro = defineDeriveMacro({
    name,
    module: options?.module,
    description: options?.description ?? `Custom derive macro: ${name}`,

    expand(
      ctx: MacroContext,
      target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
      typeInfo: DeriveTypeInfo
    ): ts.Statement[] {
      const simpleInfo = toSimpleTypeInfo(typeInfo);

      try {
        return callback(ctx, simpleInfo);
      } catch (error) {
        ctx.reportError(
          target,
          `Custom derive '${name}' failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return [];
      }
    },
  });

  globalRegistry.register(macro);
  return macro;
}

// =============================================================================
// defineCustomDeriveAst — AST-based API
// =============================================================================

/**
 * Define a custom derive macro using an AST-returning callback.
 *
 * For advanced use cases where you need full control over the generated AST.
 * The callback receives both the simplified info and the raw DeriveTypeInfo.
 *
 * @param name - The derive name
 * @param callback - Function that generates AST statements
 * @param options - Optional configuration
 * @returns The registered DeriveMacro
 */
export function defineCustomDeriveAst(
  name: string,
  callback: AstDeriveCallback,
  options?: {
    module?: string;
    description?: string;
  }
): DeriveMacro {
  const macro = defineDeriveMacro({
    name,
    module: options?.module,
    description: options?.description ?? `Custom derive macro (AST): ${name}`,

    expand(
      ctx: MacroContext,
      target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
      typeInfo: DeriveTypeInfo
    ): ts.Statement[] {
      const simpleInfo = toSimpleTypeInfo(typeInfo);

      try {
        return callback(ctx, simpleInfo, typeInfo);
      } catch (error) {
        ctx.reportError(
          target,
          `Custom derive '${name}' (AST) failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return [];
      }
    },
  });

  globalRegistry.register(macro);
  return macro;
}

// =============================================================================
// Convenience: Common Derive Patterns
// =============================================================================

/**
 * Define a derive that generates statements for each field.
 *
 * @example
 * ```typescript
 * defineFieldDerive("Getter", (ctx, typeName, field) => {
 *   const factory = ctx.factory;
 *   // Build getter function via AST
 *   return [factory.createFunctionDeclaration(...)];
 * });
 * ```
 */
export function defineFieldDerive(
  name: string,
  fieldCallback: (ctx: MacroContext, typeName: string, field: SimpleFieldInfo) => ts.Statement[],
  options?: {
    module?: string;
    description?: string;
    /** Optional preamble statements generated once before field statements */
    preamble?: (ctx: MacroContext, info: SimpleTypeInfo) => ts.Statement[];
    /** Optional postamble statements generated once after field statements */
    postamble?: (ctx: MacroContext, info: SimpleTypeInfo) => ts.Statement[];
  }
): DeriveMacro {
  return defineCustomDerive(
    name,
    (ctx, info) => {
      const stmts: ts.Statement[] = [];

      if (options?.preamble) {
        stmts.push(...options.preamble(ctx, info));
      }

      for (const field of info.fields) {
        stmts.push(...fieldCallback(ctx, info.name, field));
      }

      if (options?.postamble) {
        stmts.push(...options.postamble(ctx, info));
      }

      return stmts;
    },
    options
  );
}

/**
 * Define a derive that generates a single function operating on all fields.
 *
 * The callback returns the function structure; the framework builds the
 * function declaration via AST.
 *
 * @example
 * ```typescript
 * defineTypeFunctionDerive("Validate", (ctx, info) => ({
 *   functionName: `validate${info.name}`,
 *   params: [{ name: "value", type: "unknown" }],
 *   returnType: `value is ${info.name}`,
 *   body: [/* AST statements for the function body *\/],
 * }));
 * ```
 */
export function defineTypeFunctionDerive(
  name: string,
  callback: (
    ctx: MacroContext,
    info: SimpleTypeInfo
  ) => {
    functionName: string;
    params: Array<{ name: string; type: ts.TypeNode }>;
    returnType: ts.TypeNode;
    body: ts.Statement[];
    exported?: boolean;
  },
  options?: {
    module?: string;
    description?: string;
  }
): DeriveMacro {
  return defineCustomDerive(
    name,
    (ctx, info) => {
      const fn = callback(ctx, info);
      const factory = ctx.factory;

      const funcDecl = factory.createFunctionDeclaration(
        fn.exported ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
        undefined,
        fn.functionName,
        undefined,
        fn.params.map((p) =>
          factory.createParameterDeclaration(undefined, undefined, p.name, undefined, p.type)
        ),
        fn.returnType,
        factory.createBlock(fn.body, true)
      );

      return [funcDecl];
    },
    options
  );
}
