/**
 * Module-Graph Reflection Macros
 *
 * Provides compile-time introspection of the project's module structure:
 * - `collectTypes(pattern)` — collect all types matching a pattern across the project
 * - `moduleIndex()` — get a map of all modules and their exports
 *
 * Inspired by: Scala 3 `Mirror`, Rust inventory crate, Java classpath scanning
 *
 * @example
 * ```typescript
 * import { collectTypes, moduleIndex } from "typesugar";
 *
 * // Collect all types decorated with @entity across the project
 * const entities = collectTypes("@entity");
 *
 * // Get all exported types from a module pattern
 * const handlers = collectTypes("src/handlers/*.ts");
 *
 * // Get the full module index
 * const index = moduleIndex();
 * ```
 */

import * as ts from "typescript";
import * as path from "path";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext } from "@typesugar/core";

// =============================================================================
// Type Collection Result
// =============================================================================

interface CollectedType {
  name: string;
  module: string;
  kind: "interface" | "class" | "type" | "enum";
  exported: boolean;
}

// =============================================================================
// collectTypes — Gather types matching a pattern
// =============================================================================

export const collectTypesMacro = defineExpressionMacro({
  name: "collectTypes",
  module: "typesugar",
  description:
    "Collect all exported types matching a glob pattern across the project at compile time.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "collectTypes expects exactly one argument: collectTypes(pattern)");
      return callExpr;
    }

    // Extract the pattern
    let pattern: string;
    if (ts.isStringLiteral(args[0])) {
      pattern = args[0].text;
    } else if (ts.isNoSubstitutionTemplateLiteral(args[0])) {
      pattern = args[0].text;
    } else {
      ctx.reportError(callExpr, "collectTypes: pattern must be a string literal");
      return callExpr;
    }

    // Collect types from the program
    const collected = collectTypesFromProgram(ctx, pattern);

    // Generate an array literal of type info objects
    const elements = collected.map((t) =>
      ctx.factory.createObjectLiteralExpression(
        [
          ctx.factory.createPropertyAssignment("name", ctx.factory.createStringLiteral(t.name)),
          ctx.factory.createPropertyAssignment("module", ctx.factory.createStringLiteral(t.module)),
          ctx.factory.createPropertyAssignment("kind", ctx.factory.createStringLiteral(t.kind)),
          ctx.factory.createPropertyAssignment(
            "exported",
            t.exported ? ctx.factory.createTrue() : ctx.factory.createFalse()
          ),
        ],
        true
      )
    );

    return ctx.factory.createArrayLiteralExpression(elements, true);
  },
});

/**
 * Collect types from the program matching a glob-like pattern.
 *
 * Pattern formats:
 * - "src/models/*.ts" — glob match on file paths
 * - "@entity" — types with a specific decorator
 * - "interface" — all interfaces
 * - "class" — all classes
 * - "*" — all exported types
 */
function collectTypesFromProgram(ctx: MacroContext, pattern: string): CollectedType[] {
  const results: CollectedType[] = [];
  const program = ctx.program;
  const sourceDir = path.dirname(ctx.sourceFile.fileName);

  for (const sourceFile of program.getSourceFiles()) {
    // Skip declaration files and node_modules
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;

    // Check if the file matches the pattern
    if (!matchesPattern(sourceFile.fileName, pattern, sourceDir)) continue;

    // Scan the file for type declarations
    ts.forEachChild(sourceFile, (node) => {
      const collected = extractTypeDeclaration(node, sourceFile, pattern);
      if (collected) {
        results.push(collected);
      }
    });
  }

  return results;
}

/**
 * Check if a file path matches the collection pattern.
 */
function matchesPattern(fileName: string, pattern: string, sourceDir: string): boolean {
  // Decorator patterns: @name
  if (pattern.startsWith("@")) return true; // Check decorators per-node

  // Kind patterns
  if (["interface", "class", "type", "enum", "*"].includes(pattern)) {
    return true; // Check kind per-node
  }

  // Glob-like file path matching
  const relativePath = path.relative(sourceDir, fileName);
  return simpleGlobMatch(relativePath, pattern);
}

/**
 * Simple glob matching (supports * and **).
 */
function simpleGlobMatch(filepath: string, pattern: string): boolean {
  // Normalize separators
  const normalized = filepath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob to regex
  const regexStr = normalizedPattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "§§") // Placeholder for **
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalized);
}

/**
 * Extract a type declaration from a node if it matches the pattern.
 */
function extractTypeDeclaration(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  pattern: string
): CollectedType | null {
  const isExported = hasExportModifier(node);

  if (ts.isInterfaceDeclaration(node)) {
    if (matchesKindPattern(pattern, "interface") && node.name) {
      if (matchesDecoratorPattern(node, pattern)) {
        return {
          name: node.name.text,
          module: sourceFile.fileName,
          kind: "interface",
          exported: isExported,
        };
      }
    }
  }

  if (ts.isClassDeclaration(node)) {
    if (matchesKindPattern(pattern, "class") && node.name) {
      if (matchesDecoratorPattern(node, pattern)) {
        return {
          name: node.name.text,
          module: sourceFile.fileName,
          kind: "class",
          exported: isExported,
        };
      }
    }
  }

  if (ts.isTypeAliasDeclaration(node)) {
    if (matchesKindPattern(pattern, "type")) {
      if (matchesDecoratorPattern(node, pattern)) {
        return {
          name: node.name.text,
          module: sourceFile.fileName,
          kind: "type",
          exported: isExported,
        };
      }
    }
  }

  if (ts.isEnumDeclaration(node)) {
    if (matchesKindPattern(pattern, "enum")) {
      if (matchesDecoratorPattern(node, pattern)) {
        return {
          name: node.name.text,
          module: sourceFile.fileName,
          kind: "enum",
          exported: isExported,
        };
      }
    }
  }

  return null;
}

/**
 * Check if a pattern matches a specific kind.
 */
function matchesKindPattern(pattern: string, kind: string): boolean {
  if (pattern === "*") return true;
  if (pattern === kind) return true;
  if (pattern.startsWith("@")) return true; // Decorator patterns match all kinds
  if (pattern.includes("*") || pattern.includes("/")) return true; // Glob patterns match all kinds
  return false;
}

/**
 * Check if a node has a decorator matching the pattern.
 */
function matchesDecoratorPattern(node: ts.Node, pattern: string): boolean {
  if (!pattern.startsWith("@")) return true; // Not a decorator pattern

  const decoratorName = pattern.slice(1);

  if (ts.canHaveDecorators(node)) {
    const decorators = ts.getDecorators(node);
    if (decorators) {
      for (const decorator of decorators) {
        if (ts.isCallExpression(decorator.expression)) {
          if (
            ts.isIdentifier(decorator.expression.expression) &&
            decorator.expression.expression.text === decoratorName
          ) {
            return true;
          }
        } else if (
          ts.isIdentifier(decorator.expression) &&
          decorator.expression.text === decoratorName
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a node has an export modifier.
 */
function hasExportModifier(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    if (modifiers) {
      return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    }
  }
  return false;
}

// =============================================================================
// moduleIndex — Get the full module index
// =============================================================================

export const moduleIndexMacro = defineExpressionMacro({
  name: "moduleIndex",
  module: "typesugar",
  description: "Get a compile-time index of all modules and their exported symbols in the project.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const program = ctx.program;
    const index: Array<{
      module: string;
      exports: Array<{ name: string; kind: string }>;
    }> = [];

    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      if (sourceFile.fileName.includes("node_modules")) continue;

      const exports: Array<{ name: string; kind: string }> = [];

      ts.forEachChild(sourceFile, (node) => {
        if (!hasExportModifier(node)) return;

        if (ts.isInterfaceDeclaration(node) && node.name) {
          exports.push({ name: node.name.text, kind: "interface" });
        } else if (ts.isClassDeclaration(node) && node.name) {
          exports.push({ name: node.name.text, kind: "class" });
        } else if (ts.isTypeAliasDeclaration(node)) {
          exports.push({ name: node.name.text, kind: "type" });
        } else if (ts.isEnumDeclaration(node)) {
          exports.push({ name: node.name.text, kind: "enum" });
        } else if (ts.isFunctionDeclaration(node) && node.name) {
          exports.push({ name: node.name.text, kind: "function" });
        } else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              exports.push({ name: decl.name.text, kind: "variable" });
            }
          }
        }
      });

      if (exports.length > 0) {
        const relativePath = path.relative(
          path.dirname(ctx.sourceFile.fileName),
          sourceFile.fileName
        );
        index.push({ module: relativePath, exports });
      }
    }

    // Generate the AST for the index
    const moduleEntries = index.map((mod) =>
      ctx.factory.createObjectLiteralExpression(
        [
          ctx.factory.createPropertyAssignment(
            "module",
            ctx.factory.createStringLiteral(mod.module)
          ),
          ctx.factory.createPropertyAssignment(
            "exports",
            ctx.factory.createArrayLiteralExpression(
              mod.exports.map((exp) =>
                ctx.factory.createObjectLiteralExpression(
                  [
                    ctx.factory.createPropertyAssignment(
                      "name",
                      ctx.factory.createStringLiteral(exp.name)
                    ),
                    ctx.factory.createPropertyAssignment(
                      "kind",
                      ctx.factory.createStringLiteral(exp.kind)
                    ),
                  ],
                  true
                )
              ),
              true
            )
          ),
        ],
        true
      )
    );

    return ctx.factory.createArrayLiteralExpression(moduleEntries, true);
  },
});

// =============================================================================
// Register macros
// =============================================================================

globalRegistry.register(collectTypesMacro);
globalRegistry.register(moduleIndexMacro);
