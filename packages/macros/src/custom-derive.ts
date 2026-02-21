/**
 * Simplified Custom Derive Macro API
 *
 * Provides an easy-to-use API for defining custom derive macros without
 * needing to understand the internal DeriveTypeInfo structures or AST
 * construction directly.
 *
 * Inspired by: Rust's `#[derive(...)]` with custom derive procedural macros
 *
 * @example
 * ```typescript
 * import { defineCustomDerive } from "typesugar";
 *
 * // Simple derive that generates a toString function
 * defineCustomDerive("ToString", (info) => {
 *   const fieldStrs = info.fields.map(f =>
 *     `\`${f.name}: \${value.${f.name}}\``
 *   );
 *   return `
 *     function ${info.name.toLowerCase()}ToString(value: ${info.name}): string {
 *       return ${fieldStrs.join(" + ', ' + ")};
 *     }
 *   `;
 * });
 *
 * // Usage:
 * @derive(ToString)
 * interface Point { x: number; y: number; }
 * // Generates: function pointToString(value: Point): string { ... }
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
 * A custom derive callback that returns source code as a string.
 * The string is parsed into statements by the framework.
 */
export type StringDeriveCallback = (info: SimpleTypeInfo) => string;

/**
 * A custom derive callback that returns AST statements directly.
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
 * Define a custom derive macro using a simple string-returning callback.
 *
 * The callback receives simplified type information and returns TypeScript
 * source code as a string. The framework handles parsing it into AST nodes.
 *
 * @param name - The derive name (used in `@derive(Name)`)
 * @param callback - Function that generates source code from type info
 * @param options - Optional configuration
 * @returns The registered DeriveMacro
 *
 * @example
 * ```typescript
 * defineCustomDerive("Printable", (info) => {
 *   const fields = info.fields.map(f => `"${f.name}: " + String(value.${f.name})`);
 *   return `
 *     function print${info.name}(value: ${info.name}): string {
 *       return ${fields.join(' + ", " + ')};
 *     }
 *   `;
 * });
 * ```
 */
export function defineCustomDerive(
  name: string,
  callback: StringDeriveCallback,
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
        const code = callback(simpleInfo);

        if (!code || code.trim() === "") {
          return [];
        }

        return ctx.parseStatements(code);
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
 * Define a derive that generates a function for each field.
 *
 * @example
 * ```typescript
 * defineFieldDerive("Getter", (typeName, field) =>
 *   `function get${capitalize(field.name)}(obj: ${typeName}): ${field.type} { return obj.${field.name}; }`
 * );
 * ```
 */
export function defineFieldDerive(
  name: string,
  fieldCallback: (typeName: string, field: SimpleFieldInfo) => string,
  options?: {
    module?: string;
    description?: string;
    /** Optional preamble code generated once before field functions */
    preamble?: (info: SimpleTypeInfo) => string;
    /** Optional postamble code generated once after field functions */
    postamble?: (info: SimpleTypeInfo) => string;
  }
): DeriveMacro {
  return defineCustomDerive(
    name,
    (info) => {
      const parts: string[] = [];

      if (options?.preamble) {
        parts.push(options.preamble(info));
      }

      for (const field of info.fields) {
        parts.push(fieldCallback(info.name, field));
      }

      if (options?.postamble) {
        parts.push(options.postamble(info));
      }

      return parts.join("\n");
    },
    options
  );
}

/**
 * Define a derive that generates a single function operating on all fields.
 *
 * @example
 * ```typescript
 * defineTypeFunctionDerive("Validate", (info) => ({
 *   functionName: `validate${info.name}`,
 *   params: [{ name: "value", type: `unknown` }],
 *   returnType: `value is ${info.name}`,
 *   body: info.fields.map(f =>
 *     `if (typeof (value as any).${f.name} !== "${f.type}") return false;`
 *   ).join("\n") + "\nreturn true;",
 * }));
 * ```
 */
export function defineTypeFunctionDerive(
  name: string,
  callback: (info: SimpleTypeInfo) => {
    functionName: string;
    params: Array<{ name: string; type: string }>;
    returnType: string;
    body: string;
    exported?: boolean;
  },
  options?: {
    module?: string;
    description?: string;
  }
): DeriveMacro {
  return defineCustomDerive(
    name,
    (info) => {
      const fn = callback(info);
      const exportKw = fn.exported ? "export " : "";
      const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
      return `${exportKw}function ${fn.functionName}(${params}): ${fn.returnType} {\n${fn.body}\n}`;
    },
    options
  );
}
