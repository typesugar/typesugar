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
import { defineDeriveMacro, globalRegistry } from "../core/registry.js";
import {
  MacroContext,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
} from "../core/types.js";

// ============================================================================
// Eq - Generate equality comparison function
// ============================================================================

export const EqDerive = defineDeriveMacro({
  name: "Eq",
  description: "Generate an equality comparison function",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `${uncapitalize(name)}Eq`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandEqForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandEqForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandEqForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  const comparisons = fields.map(
    (field) => `a.${field.name} === b.${field.name}`,
  );

  const body = comparisons.length > 0 ? comparisons.join(" && ") : "true";

  const code = `
export function ${fnName}(a: ${typeName}, b: ${typeName}): boolean {
  return ${body};
}
`;

  return ctx.parseStatements(code);
}

function expandEqForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  const cases = variants
    .map((variant) => {
      const fieldComparisons = variant.fields.map(
        (field) => `(a as any).${field.name} === (b as any).${field.name}`,
      );
      const body =
        fieldComparisons.length > 0 ? fieldComparisons.join(" && ") : "true";
      return `    case "${variant.tag}": return ${body};`;
    })
    .join("\n");

  const code = `
export function ${fnName}(a: ${typeName}, b: ${typeName}): boolean {
  if (a.${discriminant} !== b.${discriminant}) return false;
  switch (a.${discriminant}) {
${cases}
    default: return false;
  }
}
`;

  return ctx.parseStatements(code);
}

// ============================================================================
// Ord - Generate comparison/ordering function
// ============================================================================

export const OrdDerive = defineDeriveMacro({
  name: "Ord",
  description: "Generate a comparison function for ordering",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `${uncapitalize(name)}Compare`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandOrdForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandOrdForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandOrdForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  const comparisons = fields
    .map((field) => {
      return `
  if (a.${field.name} < b.${field.name}) return -1;
  if (a.${field.name} > b.${field.name}) return 1;`;
    })
    .join("\n");

  const code = `
export function ${fnName}(a: ${typeName}, b: ${typeName}): -1 | 0 | 1 {
${comparisons}
  return 0;
}
`;

  return ctx.parseStatements(code);
}

function expandOrdForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  // First compare by variant order, then by fields within each variant
  const variantOrder = variants.map((v, i) => `"${v.tag}": ${i}`).join(", ");

  const cases = variants
    .map((variant) => {
      const fieldComparisons = variant.fields
        .map(
          (field) => `
      if ((a as any).${field.name} < (b as any).${field.name}) return -1;
      if ((a as any).${field.name} > (b as any).${field.name}) return 1;`,
        )
        .join("");
      return `    case "${variant.tag}":${fieldComparisons}
      return 0;`;
    })
    .join("\n");

  const code = `
export function ${fnName}(a: ${typeName}, b: ${typeName}): -1 | 0 | 1 {
  const variantOrder: Record<string, number> = { ${variantOrder} };
  const orderA = variantOrder[a.${discriminant}] ?? 999;
  const orderB = variantOrder[b.${discriminant}] ?? 999;
  if (orderA < orderB) return -1;
  if (orderA > orderB) return 1;

  switch (a.${discriminant}) {
${cases}
    default: return 0;
  }
}
`;

  return ctx.parseStatements(code);
}

// ============================================================================
// Clone - Generate a deep clone function
// ============================================================================

export const CloneDerive = defineDeriveMacro({
  name: "Clone",
  description: "Generate a deep clone function",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `clone${name}`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandCloneForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandCloneForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandCloneForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  const copies = fields.map((field) => {
    return `    ${field.name}: value.${field.name}`;
  });

  const code = `
export function ${fnName}(value: ${typeName}): ${typeName} {
  return {
${copies.join(",\n")}
  };
}
`;

  return ctx.parseStatements(code);
}

function expandCloneForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  const cases = variants
    .map((variant) => {
      const copies = [
        `${discriminant}: value.${discriminant}`,
        ...variant.fields.map(
          (field) => `${field.name}: (value as any).${field.name}`,
        ),
      ];
      return `    case "${variant.tag}": return { ${copies.join(", ")} } as ${typeName};`;
    })
    .join("\n");

  const code = `
export function ${fnName}(value: ${typeName}): ${typeName} {
  switch (value.${discriminant}) {
${cases}
    default: return { ...value } as ${typeName};
  }
}
`;

  return ctx.parseStatements(code);
}

// ============================================================================
// Debug - Generate a debug string representation
// ============================================================================

export const DebugDerive = defineDeriveMacro({
  name: "Debug",
  description: "Generate a debug string representation function",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `debug${name}`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandDebugForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandDebugForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandDebugForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  const fieldStrs = fields.map(
    (field) => `\${JSON.stringify(value.${field.name})}`,
  );

  const fieldNames = fields.map((f) => f.name);
  const pairs = fieldNames.map((n, i) => `${n}: ${fieldStrs[i]}`);

  const code = `
export function ${fnName}(value: ${typeName}): string {
  return \`${typeName} { ${pairs.join(", ")} }\`;
}
`;

  return ctx.parseStatements(code);
}

function expandDebugForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  const cases = variants
    .map((variant) => {
      const fieldStrs = variant.fields.map(
        (field) => `\${JSON.stringify((value as any).${field.name})}`,
      );
      const pairs = variant.fields.map((f, i) => `${f.name}: ${fieldStrs[i]}`);
      const body = pairs.length > 0 ? ` { ${pairs.join(", ")} }` : "";
      return `    case "${variant.tag}": return \`${variant.typeName}${body}\`;`;
    })
    .join("\n");

  const code = `
export function ${fnName}(value: ${typeName}): string {
  switch (value.${discriminant}) {
${cases}
    default: return \`${typeName}(\${value.${discriminant}})\`;
  }
}
`;

  return ctx.parseStatements(code);
}

// ============================================================================
// Hash - Generate a hash function
// ============================================================================

export const HashDerive = defineDeriveMacro({
  name: "Hash",
  description: "Generate a hash function",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `hash${name}`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandHashForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandHashForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandHashForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
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
export function ${fnName}(value: ${typeName}): number {
  let hash = 5381;
${hashCode}
  return hash >>> 0;
}
`;

  return ctx.parseStatements(code);
}

function expandHashForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  const cases = variants
    .map((variant, variantIdx) => {
      const hashCode = variant.fields
        .map((field) => {
          const fieldType = getBaseType(field);
          if (fieldType === "number") {
            return `      hash = ((hash << 5) + hash) + ((value as any).${field.name} | 0);`;
          } else if (fieldType === "string") {
            return `      for (let i = 0; i < (value as any).${field.name}.length; i++) {
        hash = ((hash << 5) + hash) + (value as any).${field.name}.charCodeAt(i);
      }`;
          } else if (fieldType === "boolean") {
            return `      hash = ((hash << 5) + hash) + ((value as any).${field.name} ? 1 : 0);`;
          }
          return `      hash = ((hash << 5) + hash) + String((value as any).${field.name}).length;`;
        })
        .join("\n");
      return `    case "${variant.tag}":
      hash = ((hash << 5) + hash) + ${variantIdx};
${hashCode}
      return hash >>> 0;`;
    })
    .join("\n");

  const code = `
export function ${fnName}(value: ${typeName}): number {
  let hash = 5381;
  switch (value.${discriminant}) {
${cases}
    default: return hash >>> 0;
  }
}
`;

  return ctx.parseStatements(code);
}

// ============================================================================
// Default - Generate a default value factory
// ============================================================================

export const DefaultDerive = defineDeriveMacro({
  name: "Default",
  description: "Generate a default value factory function",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `default${name}`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandDefaultForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandDefaultForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandDefaultForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  const defaults = fields.map((field) => {
    const defaultValue = getDefaultForType(field);
    return `    ${field.name}: ${defaultValue}`;
  });

  const code = `
export function ${fnName}(): ${typeName} {
  return {
${defaults.join(",\n")}
  };
}
`;

  return ctx.parseStatements(code);
}

function expandDefaultForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  // For sum types, default to the first variant
  if (variants.length === 0) {
    const code = `
export function ${fnName}(): ${typeName} {
  throw new Error("No variants defined for ${typeName}");
}
`;
    return ctx.parseStatements(code);
  }

  const firstVariant = variants[0];
  const defaults = [
    `${discriminant}: "${firstVariant.tag}" as const`,
    ...firstVariant.fields.map((field) => {
      const defaultValue = getDefaultForType(field);
      return `${field.name}: ${defaultValue}`;
    }),
  ];

  const code = `
export function ${fnName}(): ${typeName} {
  return { ${defaults.join(", ")} } as ${typeName};
}
`;

  return ctx.parseStatements(code);
}

// ============================================================================
// JSON - Generate JSON serialization/deserialization
// ============================================================================

export const JsonDerive = defineDeriveMacro({
  name: "Json",
  description: "Generate JSON serialization and deserialization functions",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandJsonForSumType(
        ctx,
        name,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandJsonForProductType(ctx, name, typeInfo.fields);
  },
});

function expandJsonForProductType(
  ctx: MacroContext,
  typeName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  const serializeCode = `
export function ${uncapitalize(typeName)}ToJson(value: ${typeName}): string {
  return JSON.stringify(value);
}
`;

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
export function ${uncapitalize(typeName)}FromJson(json: string): ${typeName} {
  const obj = JSON.parse(json);
${validations}
  return obj as ${typeName};
}
`;

  return [
    ...ctx.parseStatements(serializeCode),
    ...ctx.parseStatements(deserializeCode),
  ];
}

function expandJsonForSumType(
  ctx: MacroContext,
  typeName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  const serializeCode = `
export function ${uncapitalize(typeName)}ToJson(value: ${typeName}): string {
  return JSON.stringify(value);
}
`;

  const variantValidations = variants
    .map((variant) => {
      const fieldValidations = variant.fields
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
        .join("");
      return `    case "${variant.tag}":${fieldValidations}
      break;`;
    })
    .join("\n");

  const validTags = variants.map((v) => `"${v.tag}"`).join(", ");

  const deserializeCode = `
export function ${uncapitalize(typeName)}FromJson(json: string): ${typeName} {
  const obj = JSON.parse(json);
  if (obj.${discriminant} === undefined) {
    throw new Error("Missing discriminant field: ${discriminant}");
  }
  const validTags = [${validTags}];
  if (!validTags.includes(obj.${discriminant})) {
    throw new Error(\`Invalid ${discriminant} value: \${obj.${discriminant}}\`);
  }
  switch (obj.${discriminant}) {
${variantValidations}
  }
  return obj as ${typeName};
}
`;

  return [
    ...ctx.parseStatements(serializeCode),
    ...ctx.parseStatements(deserializeCode),
  ];
}

// ============================================================================
// Builder - Generate a builder pattern
// ============================================================================

export const BuilderDerive = defineDeriveMacro({
  name: "Builder",
  description: "Generate a builder pattern class",

  expand(
    ctx: MacroContext,
    target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const builderName = `${name}Builder`;

    // Builder doesn't make sense for sum types - generate a warning
    if (kind === "sum") {
      ctx.reportWarning(
        target,
        `@derive(Builder) is not applicable to sum types. Skipping Builder for ${name}.`,
      );
      return [];
    }

    // Product type - standard builder pattern
    const { fields } = typeInfo;

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

    const privateFields = fields
      .map((field) => {
        const defaultValue = getDefaultForType(field);
        return `  private _${field.name}: ${field.typeString} = ${defaultValue};`;
      })
      .join("\n");

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
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, kind } = typeInfo;
    const fnName = `is${name}`;

    if (kind === "sum" && typeInfo.variants && typeInfo.discriminant) {
      return expandTypeGuardForSumType(
        ctx,
        name,
        fnName,
        typeInfo.discriminant,
        typeInfo.variants,
      );
    }

    // Product type (default)
    return expandTypeGuardForProductType(ctx, name, fnName, typeInfo.fields);
  },
});

function expandTypeGuardForProductType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  fields: DeriveFieldInfo[],
): ts.Statement[] {
  if (fields.length === 0) {
    const code = `
export function ${fnName}(value: unknown): value is ${typeName} {
  return typeof value === "object" && value !== null;
}
`;
    return ctx.parseStatements(code);
  }

  const checks = fields.map((field) => {
    const check = generateTypeCheck(field, "value");
    if (field.optional) {
      return `(!("${field.name}" in obj) || ${check})`;
    }
    return check;
  });

  const code = `
export function ${fnName}(value: unknown): value is ${typeName} {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return ${checks.join("\n    && ")};
}
`;

  return ctx.parseStatements(code);
}

function expandTypeGuardForSumType(
  ctx: MacroContext,
  typeName: string,
  fnName: string,
  discriminant: string,
  variants: DeriveVariantInfo[],
): ts.Statement[] {
  const validTags = variants.map((v) => `"${v.tag}"`).join(", ");

  const variantChecks = variants
    .map((variant) => {
      if (variant.fields.length === 0) {
        return `    case "${variant.tag}": return true;`;
      }

      const fieldChecks = variant.fields.map((field) => {
        const check = generateTypeCheck(field, "value");
        if (field.optional) {
          return `(!("${field.name}" in obj) || ${check})`;
        }
        return check;
      });

      return `    case "${variant.tag}": return ${fieldChecks.join(" && ")};`;
    })
    .join("\n");

  const code = `
export function ${fnName}(value: unknown): value is ${typeName} {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.${discriminant} !== "string") return false;
  const validTags = [${validTags}];
  if (!validTags.includes(obj.${discriminant} as string)) return false;
  switch (obj.${discriminant}) {
${variantChecks}
    default: return false;
  }
}
`;

  return ctx.parseStatements(code);
}

/**
 * Generate a runtime type check expression for a single field.
 * Uses "obj" as the variable name for the record being checked.
 *
 * Uses semantic type information from field.type when available,
 * falling back to string parsing for edge cases.
 */
function generateTypeCheck(field: DeriveFieldInfo, _rootVar: string): string {
  const accessor = `obj["${field.name}"]`;
  const fieldType = field.type;

  // Use semantic type checking for unions
  if (fieldType.isUnion()) {
    const memberChecks = fieldType.types.map((memberType) =>
      typeCheckForSemanticType(accessor, memberType, field.typeString),
    );
    return `(${memberChecks.join(" || ")})`;
  }

  return typeCheckForSemanticType(accessor, fieldType, field.typeString);
}

/**
 * Generate a typeof / instanceof check using semantic type information.
 * Falls back to string representation for complex types.
 */
function typeCheckForSemanticType(
  accessor: string,
  type: ts.Type,
  fallbackTypeStr: string,
): string {
  const flags = type.getFlags();

  // Primitive types via TypeFlags
  if (flags & ts.TypeFlags.String) return `typeof ${accessor} === "string"`;
  if (flags & ts.TypeFlags.Number) return `typeof ${accessor} === "number"`;
  if (flags & ts.TypeFlags.Boolean || flags & ts.TypeFlags.BooleanLiteral)
    return `typeof ${accessor} === "boolean"`;
  if (flags & ts.TypeFlags.BigInt) return `typeof ${accessor} === "bigint"`;
  if (flags & ts.TypeFlags.ESSymbol) return `typeof ${accessor} === "symbol"`;
  if (flags & ts.TypeFlags.Null) return `${accessor} === null`;
  if (flags & ts.TypeFlags.Undefined) return `${accessor} === undefined`;
  if (flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown) return "true";
  if (flags & ts.TypeFlags.Never) return "false";
  if (flags & ts.TypeFlags.Void)
    return `${accessor} === undefined || ${accessor} === null`;

  // Check for array types via symbol
  const symbol = type.getSymbol();
  if (symbol?.getName() === "Array") return `Array.isArray(${accessor})`;

  // Check for known built-in types
  const symbolName = symbol?.getName();
  if (
    symbolName &&
    ["Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet"].includes(symbolName)
  ) {
    return `${accessor} instanceof ${symbolName}`;
  }

  // Fallback to string-based check for complex types
  return typeCheckForPrimitive(accessor, fallbackTypeStr.trim());
}

/**
 * Generate a typeof / instanceof / structural check for a single type string.
 */
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
      // Array types
      if (typeStr.endsWith("[]") || typeStr.startsWith("Array<")) {
        return `Array.isArray(${accessor})`;
      }
      // Date, RegExp, Map, Set, etc.
      if (
        ["Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet"].includes(typeStr)
      ) {
        return `${accessor} instanceof ${typeStr}`;
      }
      // Fallback: check it's a non-null object (structural types, interfaces, etc.)
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

/**
 * Get the base type category for a field using semantic type information.
 * Falls back to string parsing for edge cases.
 */
function getBaseType(field: DeriveFieldInfo): string {
  const type = field.type;
  const flags = type.getFlags();

  // Check for primitive types via TypeFlags
  if (flags & ts.TypeFlags.Number || flags & ts.TypeFlags.NumberLiteral)
    return "number";
  if (flags & ts.TypeFlags.String || flags & ts.TypeFlags.StringLiteral)
    return "string";
  if (flags & ts.TypeFlags.Boolean || flags & ts.TypeFlags.BooleanLiteral)
    return "boolean";
  if (flags & ts.TypeFlags.BigInt || flags & ts.TypeFlags.BigIntLiteral)
    return "bigint";

  // Handle union types - check if any constituent is a primitive
  if (type.isUnion()) {
    for (const memberType of type.types) {
      const memberFlags = memberType.getFlags();
      if (memberFlags & ts.TypeFlags.Number) return "number";
      if (memberFlags & ts.TypeFlags.String) return "string";
      if (memberFlags & ts.TypeFlags.Boolean) return "boolean";
    }
  }

  // Array types
  const symbol = type.getSymbol();
  if (symbol?.getName() === "Array") return "object";

  // Default fallback
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
export function createDerivedFunctionName(
  operation: string,
  typeName: string,
): string {
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

// Register all derive macros
globalRegistry.register(EqDerive);
globalRegistry.register(OrdDerive);
globalRegistry.register(CloneDerive);
globalRegistry.register(DebugDerive);
globalRegistry.register(HashDerive);
globalRegistry.register(DefaultDerive);
globalRegistry.register(JsonDerive);
globalRegistry.register(BuilderDerive);
globalRegistry.register(TypeGuardDerive);
