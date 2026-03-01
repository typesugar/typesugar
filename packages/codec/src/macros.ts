import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

/**
 * Phase 1: Macros registered with the transformer.
 * @codec extracts type structure and generates defineSchema() call.
 * @since, @removed, @renamed, @defaultValue are metadata stubs (Phase 2 will read them).
 */

function simplifyTypeForSchema(typeStr: string): string {
  if (typeStr.includes("|") || typeStr.includes("&")) return "unknown";
  const lower = typeStr.toLowerCase();
  if (lower === "string") return "string";
  if (lower === "number") return "number";
  if (lower === "boolean") return "boolean";
  if (lower === "bigint") return "bigint";
  if (lower === "null" || lower === "undefined") return "string";
  if (typeStr.includes("[]") || typeStr.startsWith("Array")) return "array";
  if (typeStr.startsWith("Record") || typeStr === "object") return "object";
  return "unknown";
}

export const codecMacro = defineAttributeMacro({
  name: "codec",
  module: "@typesugar/codec",
  description: "Generate versioned codec for a type with schema evolution",
  validTargets: ["interface", "class"],
  expand(ctx: MacroContext, _decorator, target, _args) {
    if (!ts.isClassDeclaration(target) && !ts.isInterfaceDeclaration(target)) {
      return target;
    }
    const name = ts.isClassDeclaration(target)
      ? target.name?.text
      : target.name?.text;
    if (!name) {
      ctx.reportError(target, "@codec requires a named class or interface");
      return target;
    }

    let type: ts.Type;
    let properties: ts.Symbol[];
    try {
      type = ctx.typeChecker.getTypeAtLocation(target);
      properties = ctx.typeChecker.getPropertiesOfType(type);
    } catch {
      ctx.reportWarning(target, `@codec: Could not extract type for ${name}`);
      return target;
    }

    const fields: Array<{ name: string; type: string }> = [];
    for (const prop of properties) {
      const propName = prop.getName();
      if (propName.startsWith("__") || propName === "constructor") continue;
      const decls = prop.getDeclarations();
      const decl = decls?.[0];
      if (decl && ts.isMethodDeclaration(decl)) continue;

      let typeStr = "unknown";
      try {
        const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl || target);
        typeStr = ctx.typeChecker.typeToString(propType);
      } catch {
        // keep "unknown"
      }
      fields.push({ name: propName, type: simplifyTypeForSchema(typeStr) });
    }

    const schemaName = `${name}Schema`;
    const fieldProps = fields.map(
      (f) =>
        `{ name: ${JSON.stringify(f.name)}, type: ${JSON.stringify(f.type)} }`
    );
    const defineSchemaCall = `defineSchema(${JSON.stringify(name)}, { version: 1, fields: [${fieldProps.join(", ")}] })`;
    const stmt = ctx.factory.createVariableStatement(
      undefined,
      ctx.factory.createVariableDeclarationList(
        [
          ctx.factory.createVariableDeclaration(
            schemaName,
            undefined,
            undefined,
            ctx.parseExpression(defineSchemaCall)
          ),
        ],
        ts.NodeFlags.Const
      )
    );

    return [target, stmt];
  },
});

export const sinceMacro = defineAttributeMacro({
  name: "since",
  module: "@typesugar/codec",
  description: "Mark the version in which a field was introduced",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const removedMacro = defineAttributeMacro({
  name: "removed",
  module: "@typesugar/codec",
  description: "Mark the version in which a field was removed",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const renamedMacro = defineAttributeMacro({
  name: "renamed",
  module: "@typesugar/codec",
  description: "Mark that a field was renamed from an older name at a given version",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const defaultValueMacro = defineAttributeMacro({
  name: "defaultValue",
  module: "@typesugar/codec",
  description: "Provide a default value for decoding older versions",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

/** Register all codec macros with the global registry. Called on package import. */
export function register(): void {
  globalRegistry.register(codecMacro);
  globalRegistry.register(sinceMacro);
  globalRegistry.register(removedMacro);
  globalRegistry.register(renamedMacro);
  globalRegistry.register(defaultValueMacro);
}
