/**
 * Derive Macros - Auto-generate common implementations
 *
 * Inspired by Rust's derive macros, these automatically generate
 * implementations for common traits/interfaces.
 *
 * Usage:
 *   @derive(Eq, Ord, Clone, Debug)
 *   interface Point {
 *     x: number;
 *     y: number;
 *   }
 */

import * as ts from "typescript";
import {
  defineDeriveMacro,
  globalRegistry,
  MacroContext,
  DeriveTypeInfo,
  DeriveFieldInfo,
} from "@typesugar/core";

// ============================================================================
// Eq - Generate equality comparison function
// ============================================================================

export const EqDerive = defineDeriveMacro({
  name: "Eq",
  description: "Generate an equality comparison function",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `${uncapitalize(name)}Eq`;

    // Generate: (a: Type, b: Type) => boolean
    // Use type-aware comparison: === for primitives, deep comparison for objects/arrays
    const comparisons = fields.map((field) => {
      const baseType = getBaseType(field);
      if (baseType === "object") {
        // For objects/arrays, use JSON.stringify comparison (simple deep equality)
        // NOTE: This has limitations (doesn't handle undefined, functions, circular refs)
        return `JSON.stringify(a.${field.name}) === JSON.stringify(b.${field.name})`;
      }
      // Primitives use ===
      return `a.${field.name} === b.${field.name}`;
    });

    const body = comparisons.length > 0 ? comparisons.join(" && ") : "true";

    const code = `
export function ${fnName}(a: ${name}, b: ${name}): boolean {
  return ${body};
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// Ord - Generate comparison/ordering function
// ============================================================================

export const OrdDerive = defineDeriveMacro({
  name: "Ord",
  description: "Generate a comparison function for ordering",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `${uncapitalize(name)}Compare`;

    // Generate field comparisons
    const comparisons = fields
      .map((field) => {
        return `
  if (a.${field.name} < b.${field.name}) return -1;
  if (a.${field.name} > b.${field.name}) return 1;`;
      })
      .join("\n");

    const code = `
export function ${fnName}(a: ${name}, b: ${name}): -1 | 0 | 1 {
${comparisons}
  return 0;
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// Clone - Generate a deep clone function
// ============================================================================

export const CloneDerive = defineDeriveMacro({
  name: "Clone",
  description: "Generate a deep clone function",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `clone${name}`;

    // Generate field copying
    const copies = fields.map((field) => {
      // For now, simple copy. Could be enhanced for nested objects
      return `    ${field.name}: value.${field.name}`;
    });

    const code = `
export function ${fnName}(value: ${name}): ${name} {
  return {
${copies.join(",\n")}
  };
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// Debug - Generate a debug string representation
// ============================================================================

export const DebugDerive = defineDeriveMacro({
  name: "Debug",
  description: "Generate a debug string representation function",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `debug${name}`;

    // Generate field string representations
    const fieldStrs = fields.map((field) => `\${JSON.stringify(value.${field.name})}`);

    const fieldNames = fields.map((f) => f.name);
    const pairs = fieldNames.map((n, i) => `${n}: ${fieldStrs[i]}`);

    const code = `
export function ${fnName}(value: ${name}): string {
  return \`${name} { ${pairs.join(", ")} }\`;
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// Hash - Generate a hash function
// ============================================================================

export const HashDerive = defineDeriveMacro({
  name: "Hash",
  description: "Generate a hash function",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `hash${name}`;

    // Simple djb2-style hash
    const hashCode = fields
      .map((field) => {
        const fieldType = getBaseType(field);
        if (fieldType === "number") {
          return `  hash = ((hash << 5) + hash) + (value.${field.name} | 0);`;
        } else if (fieldType === "string") {
          return `  for (let i = 0; i < value.${field.name}.length; i++) {
    hash = ((hash << 5) + hash) + value.${field.name}.charCodeAt(i);
  }`;
        } else if (fieldType === "boolean") {
          return `  hash = ((hash << 5) + hash) + (value.${field.name} ? 1 : 0);`;
        }
        return `  hash = ((hash << 5) + hash) + String(value.${field.name}).length;`;
      })
      .join("\n");

    const code = `
export function ${fnName}(value: ${name}): number {
  let hash = 5381;
${hashCode}
  return hash >>> 0;
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// Default - Generate a default value factory
// ============================================================================

export const DefaultDerive = defineDeriveMacro({
  name: "Default",
  description: "Generate a default value factory function",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `default${name}`;

    // Generate default values based on type
    const defaults = fields.map((field) => {
      const defaultValue = getDefaultForType(field);
      return `    ${field.name}: ${defaultValue}`;
    });

    const code = `
export function ${fnName}(): ${name} {
  return {
${defaults.join(",\n")}
  };
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// JSON - Generate JSON serialization/deserialization
// ============================================================================

export const JsonDerive = defineDeriveMacro({
  name: "Json",
  description: "Generate JSON serialization and deserialization functions",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;

    // Serialize function
    const serializeCode = `
export function ${uncapitalize(name)}ToJson(value: ${name}): string {
  return JSON.stringify(value);
}
`;

    // Deserialize with validation
    const validations = fields
      .map((field) => {
        const baseType = getBaseType(field);
        const optionalCheck = field.optional
          ? ""
          : `
    if (obj.${field.name} === undefined) {
      throw new Error("Missing required field: ${field.name}");
    }`;
        const typeCheck = `
    if (obj.${field.name} !== undefined && typeof obj.${field.name} !== "${baseType}") {
      throw new Error("Field ${field.name} must be ${baseType}");
    }`;
        return optionalCheck + typeCheck;
      })
      .join("\n");

    const deserializeCode = `
export function ${uncapitalize(name)}FromJson(json: string): ${name} {
  const obj = JSON.parse(json);
${validations}
  return obj as ${name};
}
`;

    return [...ctx.parseStatements(serializeCode), ...ctx.parseStatements(deserializeCode)];
  },
});

// ============================================================================
// Builder - Generate a builder pattern
// ============================================================================

export const BuilderDerive = defineDeriveMacro({
  name: "Builder",
  description: "Generate a builder pattern class",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const builderName = `${name}Builder`;

    // Generate setter methods
    const setters = fields
      .map((field) => {
        const methodName = `with${capitalize(field.name)}`;
        return `
  ${methodName}(${field.name}: ${field.typeString}): ${builderName} {
    this._${field.name} = ${field.name};
    return this;
  }`;
      })
      .join("\n");

    // Generate private fields
    const privateFields = fields
      .map((field) => {
        const defaultValue = getDefaultForType(field);
        return `  private _${field.name}: ${field.typeString} = ${defaultValue};`;
      })
      .join("\n");

    // Generate build method
    const buildProps = fields
      .map((field) => `      ${field.name}: this._${field.name}`)
      .join(",\n");

    const code = `
export class ${builderName} {
${privateFields}

${setters}

  build(): ${name} {
    return {
${buildProps}
    };
  }
}
`;

    return ctx.parseStatements(code);
  },
});

// ============================================================================
// TypeGuard - Generate a type guard (is) function
// ============================================================================

export const TypeGuardDerive = defineDeriveMacro({
  name: "TypeGuard",
  description: "Generate a type guard function (value is T)",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `is${name}`;

    if (fields.length === 0) {
      const code = `
export function ${fnName}(value: unknown): value is ${name} {
  return typeof value === "object" && value !== null;
}
`;
      return ctx.parseStatements(code);
    }

    const checks = fields.map((field) => {
      const check = generateTypeCheck(field);
      if (field.optional) {
        return `(!("${field.name}" in obj) || ${check})`;
      }
      return check;
    });

    const code = `
export function ${fnName}(value: unknown): value is ${name} {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return ${checks.join("\n    && ")};
}
`;

    return ctx.parseStatements(code);
  },
});

function generateTypeCheck(field: DeriveFieldInfo): string {
  const typeStr = field.typeString.trim();
  const accessor = `obj["${field.name}"]`;

  if (typeStr.includes("|")) {
    const members = typeStr.split("|").map((t) => t.trim());
    const memberChecks = members.map((m) => typeCheckForPrimitive(accessor, m));
    return `(${memberChecks.join(" || ")})`;
  }

  return typeCheckForPrimitive(accessor, typeStr);
}

function typeCheckForPrimitive(accessor: string, typeStr: string): string {
  switch (typeStr) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "function":
      return `typeof ${accessor} === "${typeStr}"`;
    case "null":
      return `${accessor} === null`;
    case "undefined":
      return `${accessor} === undefined`;
    case "object":
      return `(typeof ${accessor} === "object" && ${accessor} !== null)`;
    case "any":
    case "unknown":
      return "true";
    case "never":
      return "false";
    default:
      if (typeStr.endsWith("[]") || typeStr.startsWith("Array<")) {
        return `Array.isArray(${accessor})`;
      }
      if (["Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet"].includes(typeStr)) {
        return `${accessor} instanceof ${typeStr}`;
      }
      return `(typeof ${accessor} === "object" && ${accessor} !== null)`;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function uncapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getBaseType(field: DeriveFieldInfo): string {
  const typeStr = field.typeString.trim();

  // Exact primitive matches
  if (typeStr === "number") return "number";
  if (typeStr === "string") return "string";
  if (typeStr === "boolean") return "boolean";

  // Check for union types containing primitives (e.g., "number | null")
  // Use word boundary matching to avoid false positives like "WeirdnumberType"
  const primitivePattern = /\b(number|string|boolean)\b/;
  const match = typeStr.match(primitivePattern);
  if (match) {
    return match[1];
  }

  // Arrays are objects at runtime
  if (typeStr.endsWith("[]") || typeStr.startsWith("Array<")) {
    return "object";
  }

  return "object";
}

function getDefaultForType(field: DeriveFieldInfo): string {
  if (field.optional) {
    return "undefined";
  }

  const baseType = getBaseType(field);
  switch (baseType) {
    case "number":
      return "0";
    case "string":
      return '""';
    case "boolean":
      return "false";
    default:
      return "{}";
  }
}

// ============================================================================
// Export all derive macros as a collection
// ============================================================================

export const deriveMacros = {
  Eq: EqDerive,
  Ord: OrdDerive,
  Clone: CloneDerive,
  Debug: DebugDerive,
  Hash: HashDerive,
  Default: DefaultDerive,
  Json: JsonDerive,
  Builder: BuilderDerive,
  TypeGuard: TypeGuardDerive,
};

/**
 * Create a derived function name based on convention
 */
export function createDerivedFunctionName(operation: string, typeName: string): string {
  switch (operation) {
    case "eq":
      return `${uncapitalize(typeName)}Eq`;
    case "ord":
      return `${uncapitalize(typeName)}Ord`;
    case "compare":
      return `${uncapitalize(typeName)}Compare`;
    case "clone":
      return `clone${typeName}`;
    case "debug":
      return `debug${typeName}`;
    case "hash":
      return `hash${typeName}`;
    case "default":
      return `default${typeName}`;
    case "toJson":
      return `${uncapitalize(typeName)}ToJson`;
    case "fromJson":
      return `${uncapitalize(typeName)}FromJson`;
    case "typeGuard":
    case "is":
      return `is${typeName}`;
    default:
      return `${uncapitalize(typeName)}${capitalize(operation)}`;
  }
}

/**
 * Register macros with the global registry.
 * Call this function to enable derive macros in your project.
 */
export function register(): void {
  globalRegistry.register(EqDerive);
  globalRegistry.register(OrdDerive);
  globalRegistry.register(CloneDerive);
  globalRegistry.register(DebugDerive);
  globalRegistry.register(HashDerive);
  globalRegistry.register(DefaultDerive);
  globalRegistry.register(JsonDerive);
  globalRegistry.register(BuilderDerive);
  globalRegistry.register(TypeGuardDerive);
}

// Auto-register when this module is imported
register();
