import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

/**
 * Macros registered with the transformer.
 * @codec extracts type structure and generates defineSchema() call,
 * reading @since, @removed, @renamed, @defaultValue annotations from members.
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

// -------------------------------------------------------------------------
// Decorator argument extraction helpers
// -------------------------------------------------------------------------

/** Known field-level decorator names. */
const FIELD_DECORATOR_NAMES = new Set(["since", "removed", "renamed", "defaultValue"]);

/**
 * Extract the name from a decorator expression.
 * Handles both `@foo` and `@foo(args)` forms.
 */
function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}

/**
 * Extract the arguments from a decorator call expression.
 * Returns an empty array for bare `@foo` decorators.
 */
function getDecoratorArgs(decorator: ts.Decorator): readonly ts.Expression[] {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) return expr.arguments;
  return [];
}

/**
 * Evaluate a simple literal expression to a JS value.
 * Supports numbers, strings, booleans, null, arrays, and object literals.
 */
function evalLiteral(node: ts.Expression): unknown {
  if (ts.isNumericLiteral(node)) return parseFloat(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = evalLiteral(node.operand as ts.Expression);
    return typeof operand === "number" ? -operand : undefined;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => evalLiteral(e));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name)) {
        obj[prop.name.text] = evalLiteral(prop.initializer);
      }
    }
    return obj;
  }
  return undefined;
}

/** Field metadata collected from decorators on a single property. */
interface FieldDecoratorMeta {
  since?: number;
  removed?: number;
  renamed?: { version: number; oldName: string };
  defaultValue?: unknown;
  hasDefaultValue?: boolean;
}

/**
 * Scan decorators on a class/interface member and extract field-level metadata.
 */
function extractFieldDecoratorMeta(member: ts.ClassElement | ts.TypeElement): FieldDecoratorMeta {
  const meta: FieldDecoratorMeta = {};

  // ts.getDecorators only works on nodes that can have decorators (class elements).
  // For interface property signatures we check the `modifiers` array directly since
  // typesugar's attribute macros on interface members are stored as synthetic modifiers.
  const decorators: readonly ts.Decorator[] =
    (ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined) ?? [];

  for (const dec of decorators) {
    const name = getDecoratorName(dec);
    if (!name || !FIELD_DECORATOR_NAMES.has(name)) continue;
    const args = getDecoratorArgs(dec);

    switch (name) {
      case "since": {
        const v = args[0] ? evalLiteral(args[0]) : undefined;
        if (typeof v === "number") meta.since = v;
        break;
      }
      case "removed": {
        const v = args[0] ? evalLiteral(args[0]) : undefined;
        if (typeof v === "number") meta.removed = v;
        break;
      }
      case "renamed": {
        const ver = args[0] ? evalLiteral(args[0]) : undefined;
        const oldName = args[1] ? evalLiteral(args[1]) : undefined;
        if (typeof ver === "number" && typeof oldName === "string") {
          meta.renamed = { version: ver, oldName };
        }
        break;
      }
      case "defaultValue": {
        if (args[0]) {
          meta.defaultValue = evalLiteral(args[0]);
          meta.hasDefaultValue = true;
        }
        break;
      }
    }
  }

  return meta;
}

/**
 * Build a mapping from property name to decorator metadata for all members
 * of a class or interface declaration.
 */
export function collectFieldMeta(
  target: ts.ClassDeclaration | ts.InterfaceDeclaration
): Map<string, FieldDecoratorMeta> {
  const map = new Map<string, FieldDecoratorMeta>();

  for (const member of target.members) {
    let propName: string | undefined;
    if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
      if (member.name && ts.isIdentifier(member.name)) {
        propName = member.name.text;
      }
    }
    if (!propName) continue;
    const meta = extractFieldDecoratorMeta(member);
    if (
      meta.since !== undefined ||
      meta.removed !== undefined ||
      meta.renamed !== undefined ||
      meta.hasDefaultValue
    ) {
      map.set(propName, meta);
    }
  }

  return map;
}

// -------------------------------------------------------------------------
// Serialisation helper — turn a FieldDecoratorMeta into a JS source fragment
// -------------------------------------------------------------------------

interface FieldDescriptor {
  name: string;
  type: string;
  since?: number;
  removed?: number;
  renamed?: { version: number; oldName: string };
  defaultValue?: unknown;
  hasDefaultValue?: boolean;
}

function fieldToSource(f: FieldDescriptor): string {
  const parts: string[] = [`name: ${JSON.stringify(f.name)}`, `type: ${JSON.stringify(f.type)}`];
  if (f.since !== undefined) parts.push(`since: ${f.since}`);
  if (f.removed !== undefined) parts.push(`removed: ${f.removed}`);
  if (f.renamed) {
    parts.push(
      `renamed: { version: ${f.renamed.version}, oldName: ${JSON.stringify(f.renamed.oldName)} }`
    );
  }
  if (f.hasDefaultValue) {
    parts.push(`defaultValue: ${JSON.stringify(f.defaultValue)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

// -------------------------------------------------------------------------
// @codec macro
// -------------------------------------------------------------------------

export const codecMacro = defineAttributeMacro({
  name: "codec",
  module: "@typesugar/codec",
  description: "Generate versioned codec for a type with schema evolution",
  validTargets: ["interface", "class"],
  expand(ctx: MacroContext, _decorator, target, _args) {
    if (!ts.isClassDeclaration(target) && !ts.isInterfaceDeclaration(target)) {
      return target;
    }
    const name = ts.isClassDeclaration(target) ? target.name?.text : target.name?.text;
    if (!name) {
      ctx.reportError(target, "@codec requires a named class or interface");
      return target;
    }

    // Determine the schema version from @codec(version) or default to 1.
    let schemaVersion = 1;
    if (_args.length > 0) {
      const v = evalLiteral(_args[0] as ts.Expression);
      if (typeof v === "number" && v >= 1) schemaVersion = v;
    }

    // Collect decorator metadata from members.
    const fieldMeta = collectFieldMeta(target as ts.ClassDeclaration | ts.InterfaceDeclaration);

    let type: ts.Type;
    let properties: ts.Symbol[];
    try {
      type = ctx.typeChecker.getTypeAtLocation(target);
      properties = ctx.typeChecker.getPropertiesOfType(type);
    } catch {
      ctx.reportWarning(target, `@codec: Could not extract type for ${name}`);
      return target;
    }

    const fields: FieldDescriptor[] = [];
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

      const meta = fieldMeta.get(propName);
      fields.push({
        name: propName,
        type: simplifyTypeForSchema(typeStr),
        ...meta,
      });
    }

    const schemaName = `${name}Schema`;
    const fieldProps = fields.map(fieldToSource);
    const defineSchemaCall = `defineSchema(${JSON.stringify(name)}, { version: ${schemaVersion}, fields: [${fieldProps.join(", ")}] })`;
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
