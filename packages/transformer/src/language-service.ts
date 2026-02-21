/**
 * typemacro TypeScript Language Service Plugin
 *
 * Provides IDE integration for typemacro:
 * - Suppresses false-positive diagnostics from macro invocations
 * - Adds custom diagnostics for macro errors
 * - Provides completions inside @derive() decorators
 * - Shows macro expansion info on hover
 *
 * Configure in tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "plugins": [{ "name": "@typesugar/transformer/language-service" }]
 *   }
 * }
 */

import type * as ts from "typescript";

/** Known expression macro names from the typemacro core */
const EXPRESSION_MACROS = new Set([
  "comptime",
  "ops",
  "pipe",
  "compose",
  "summon",
  "extend",
  "typeInfo",
  "fieldNames",
  "validator",
]);

/**
 * Known typeclass method names and their providing typeclasses.
 */
const TYPECLASS_EXTENSION_METHODS: Record<
  string,
  { typeclass: string; description: string; returnType: string }
> = {
  show: {
    typeclass: "Show",
    description: "Convert to a human-readable string representation",
    returnType: "string",
  },
  eq: {
    typeclass: "Eq",
    description: "Check equality with another value",
    returnType: "boolean",
  },
  neq: {
    typeclass: "Eq",
    description: "Check inequality with another value",
    returnType: "boolean",
  },
  compare: {
    typeclass: "Ord",
    description: "Compare ordering with another value (-1, 0, or 1)",
    returnType: "-1 | 0 | 1",
  },
  hash: {
    typeclass: "Hash",
    description: "Compute a hash code for this value",
    returnType: "number",
  },
  combine: {
    typeclass: "Semigroup",
    description: "Combine with another value using the Semigroup operation",
    returnType: "self",
  },
  empty: {
    typeclass: "Monoid",
    description: "Get the identity element for this type",
    returnType: "self",
  },
  map: {
    typeclass: "Functor",
    description: "Apply a function to the contained value(s)",
    returnType: "self",
  },
};

const EXTENSION_METHOD_NAMES = new Set(Object.keys(TYPECLASS_EXTENSION_METHODS));

const DECORATOR_MACROS = new Set([
  "derive",
  "operators",
  "reflect",
  "typeclass",
  "instance",
  "deriving",
  "inline",
]);

const DERIVE_MACROS = [
  { name: "Eq", description: "Generate equality comparison function" },
  { name: "Ord", description: "Generate ordering/comparison function" },
  { name: "Clone", description: "Generate deep clone function" },
  { name: "Debug", description: "Generate debug string representation" },
  { name: "Hash", description: "Generate hash function" },
  { name: "Default", description: "Generate default value factory" },
  { name: "Json", description: "Generate JSON serialization/deserialization" },
  { name: "Builder", description: "Generate builder pattern class" },
];

const TAGGED_TEMPLATE_MACROS = new Set(["sql", "regex", "html", "fmt", "json", "raw", "units"]);

/** Semantic diagnostic codes to suppress unconditionally */
const SUPPRESSED_SEMANTIC_CODES = new Set([
  1206, // Decorators are not valid here
  1345, // Expression of type void cannot be tested
  2304, // Cannot find name
  2339, // Property does not exist
]);

/** Code 6133 is handled specially - only suppress for typesugar imports */
const UNUSED_IMPORT_CODE = 6133;

/** typesugar package prefixes for import detection */
const TYPESUGAR_PACKAGE_PREFIXES = [
  "typesugar",
  "@typesugar/",
  "typemacro", // legacy name
  "@typemacro/", // legacy name
  "ttfx", // legacy name
  "@ttfx/", // legacy name
];

/** Syntactic (parse) error codes that may occur from HKT syntax like F<_> */
const HKT_PARSE_ERROR_CODES = new Set([
  1005, // ',' expected (from <_>)
  1003, // Identifier expected (from <_>)
  1109, // Expression expected
  1128, // Declaration or statement expected
  1434, // Unexpected keyword or identifier
]);

function init(modules: { typescript: typeof ts }) {
  const tsModule = modules.typescript;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const log = (msg: string) => {
      info.project.projectService.logger.info(`[typemacro] ${msg}`);
    };

    log("Language service plugin initialized");

    const proxy = Object.create(null) as ts.LanguageService;
    const oldLS = info.languageService;

    for (const k of Object.keys(oldLS)) {
      const prop = (oldLS as unknown as Record<string, unknown>)[k];
      if (typeof prop === "function") {
        (proxy as unknown as Record<string, unknown>)[k] = (...args: unknown[]): unknown => {
          return (prop as Function).apply(oldLS, args);
        };
      }
    }

    // -----------------------------------------------------------------------
    // Override: getSyntacticDiagnostics
    // Suppress parse errors from HKT syntax like F<_>
    // -----------------------------------------------------------------------
    proxy.getSyntacticDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] => {
      const diagnostics = oldLS.getSyntacticDiagnostics(fileName);
      const program = oldLS.getProgram();
      if (!program) return diagnostics;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return diagnostics;

      const sourceText = sourceFile.getFullText();

      return diagnostics.filter((diag) => {
        // Check if this is a potential HKT parse error
        if (!HKT_PARSE_ERROR_CODES.has(diag.code)) return true;
        if (diag.start === undefined) return true;

        // Look for HKT pattern near the error position: Identifier<_>
        // Check a window around the error position for the <_> pattern
        const windowStart = Math.max(0, diag.start - 30);
        const windowEnd = Math.min(sourceText.length, diag.start + diag.length + 30);
        const window = sourceText.slice(windowStart, windowEnd);

        // Pattern: uppercase identifier followed by <_> or <_, _>
        const hktPattern = /[A-Z][a-zA-Z0-9]*\s*<\s*_(\s*,\s*_)*\s*>/;
        if (hktPattern.test(window)) {
          log(
            `Suppressed syntactic diagnostic ${diag.code} (HKT syntax): ${window.trim().slice(0, 40)}...`
          );
          return false;
        }

        return true;
      });
    };

    // -----------------------------------------------------------------------
    // Override: getSemanticDiagnostics
    // Suppress false positives from macro invocations
    // -----------------------------------------------------------------------
    proxy.getSemanticDiagnostics = (fileName: string): ts.Diagnostic[] => {
      const diagnostics = oldLS.getSemanticDiagnostics(fileName);
      const program = oldLS.getProgram();
      if (!program) return diagnostics;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return diagnostics;

      return diagnostics.filter((diag) => {
        // Handle 6133 (unused variable) specially - only suppress for typesugar imports
        if (diag.code === UNUSED_IMPORT_CODE) {
          if (diag.start === undefined) return true;

          const node = findNodeAtPosition(tsModule, sourceFile, diag.start);
          if (!node) return true;

          // Check if this is an import specifier from a typesugar package
          if (isTypesugarImport(tsModule, node, sourceFile)) {
            log(`Suppressed diagnostic ${diag.code} for typesugar import`);
            return false;
          }

          return true;
        }

        if (!SUPPRESSED_SEMANTIC_CODES.has(diag.code)) return true;
        if (diag.start === undefined) return true;

        const node = findNodeAtPosition(tsModule, sourceFile, diag.start);
        if (!node) return true;

        if (diag.code === 1206) {
          const decorator = findAncestor(tsModule, node, tsModule.isDecorator);
          if (decorator && tsModule.isDecorator(decorator)) {
            const name = getDecoratorName(tsModule, decorator as ts.Decorator);
            if (name && DECORATOR_MACROS.has(name)) {
              log(`Suppressed diagnostic ${diag.code} for @${name}`);
              return false;
            }
          }
        }

        if (diag.code === 2304) {
          if (isNearMacroInvocation(tsModule, sourceFile, node)) {
            log(`Suppressed diagnostic ${diag.code} near macro invocation`);
            return false;
          }
        }

        if (diag.code === 2339) {
          if (isExtensionMethodCall(tsModule, sourceFile, node)) {
            log(`Suppressed diagnostic ${diag.code} for extension method call`);
            return false;
          }
        }

        return true;
      });
    };

    proxy.getCompletionsAtPosition = (
      fileName: string,
      position: number,
      options: ts.GetCompletionsAtPositionOptions | undefined
    ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
      const prior = oldLS.getCompletionsAtPosition(fileName, position, options);

      const program = oldLS.getProgram();
      if (!program) return prior;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const node = findNodeAtPosition(tsModule, sourceFile, position);
      if (!node) return prior;

      const deriveContext = findDeriveContext(tsModule, node);
      if (deriveContext) {
        const deriveEntries: ts.CompletionEntry[] = DERIVE_MACROS.map((macro) => ({
          name: macro.name,
          kind: tsModule.ScriptElementKind.constElement,
          kindModifiers: "",
          sortText: `0${macro.name}`,
          labelDetails: {
            description: macro.description,
          },
        }));

        if (prior) {
          return {
            ...prior,
            entries: [...deriveEntries, ...prior.entries],
          };
        }

        return {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: deriveEntries,
        };
      }

      const extensionEntries = getExtensionMethodCompletions(tsModule, sourceFile, node, program);
      if (extensionEntries.length > 0) {
        if (prior) {
          return {
            ...prior,
            entries: [...extensionEntries, ...prior.entries],
          };
        }

        return {
          isGlobalCompletion: false,
          isMemberCompletion: true,
          isNewIdentifierLocation: false,
          entries: extensionEntries,
        };
      }

      return prior;
    };

    proxy.getQuickInfoAtPosition = (
      fileName: string,
      position: number
    ): ts.QuickInfo | undefined => {
      const prior = oldLS.getQuickInfoAtPosition(fileName, position);

      const program = oldLS.getProgram();
      if (!program) return prior;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const node = findNodeAtPosition(tsModule, sourceFile, position);
      if (!node) return prior;

      if (tsModule.isIdentifier(node)) {
        const name = node.text;

        if (EXPRESSION_MACROS.has(name)) {
          return {
            kind: tsModule.ScriptElementKind.functionElement,
            kindModifiers: "typemacro",
            textSpan: {
              start: node.getStart(sourceFile),
              length: node.getWidth(sourceFile),
            },
            displayParts: [
              {
                text: `(typemacro expression macro) ${name}`,
                kind: "text",
              },
            ],
            documentation: [
              {
                text: "This call is expanded at compile time by the typemacro transformer.",
                kind: "text",
              },
            ],
          };
        }

        if (DECORATOR_MACROS.has(name)) {
          return {
            kind: tsModule.ScriptElementKind.functionElement,
            kindModifiers: "typemacro",
            textSpan: {
              start: node.getStart(sourceFile),
              length: node.getWidth(sourceFile),
            },
            displayParts: [
              {
                text: `(typemacro decorator macro) @${name}`,
                kind: "text",
              },
            ],
            documentation: [
              {
                text: "This decorator is processed at compile time by the typemacro transformer.",
                kind: "text",
              },
            ],
          };
        }

        if (TAGGED_TEMPLATE_MACROS.has(name)) {
          return {
            kind: tsModule.ScriptElementKind.functionElement,
            kindModifiers: "typemacro",
            textSpan: {
              start: node.getStart(sourceFile),
              length: node.getWidth(sourceFile),
            },
            displayParts: [
              {
                text: `(typemacro tagged template macro) ${name}\`...\``,
                kind: "text",
              },
            ],
            documentation: [
              {
                text: "This tagged template is processed at compile time by the typemacro transformer.",
                kind: "text",
              },
            ],
          };
        }

        const extInfo = getExtensionMethodHoverInfo(tsModule, sourceFile, node, program);
        if (extInfo) {
          return {
            kind: tsModule.ScriptElementKind.memberFunctionElement,
            kindModifiers: "typemacro extension",
            textSpan: {
              start: node.getStart(sourceFile),
              length: node.getWidth(sourceFile),
            },
            displayParts: [
              {
                text: extInfo.displayText,
                kind: "text",
              },
            ],
            documentation: [
              {
                text: extInfo.documentation,
                kind: "text",
              },
            ],
          };
        }
      }

      return prior;
    };

    return proxy;
  }

  return { create };
}

/**
 * Check if a node is an import (or part of an import) from a typesugar package.
 * Used to selectively suppress 6133 "unused variable" only for typesugar imports.
 */
function isTypesugarImport(
  ts: typeof import("typescript"),
  node: ts.Node,
  sourceFile: ts.SourceFile
): boolean {
  // Walk up to find the import declaration
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isImportDeclaration(current)) {
      const moduleSpecifier = current.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const modulePath = moduleSpecifier.text;
        return TYPESUGAR_PACKAGE_PREFIXES.some(
          (prefix) => modulePath === prefix.replace(/\/$/, "") || modulePath.startsWith(prefix)
        );
      }
      return false;
    }
    current = current.parent;
  }
  return false;
}

function findNodeAtPosition(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  position: number
): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      return ts.forEachChild(node, find) ?? node;
    }
    return undefined;
  }
  return find(sourceFile);
}

function findAncestor(
  ts: typeof import("typescript"),
  node: ts.Node,
  predicate: (node: ts.Node) => boolean
): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function getDecoratorName(
  ts: typeof import("typescript"),
  decorator: ts.Decorator
): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}

function findDeriveContext(ts: typeof import("typescript"), node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current)) {
      if (ts.isIdentifier(current.expression) && current.expression.text === "derive") {
        return true;
      }
    }
    if (ts.isDecorator(current)) {
      const name = getDecoratorName(ts, current);
      if (name === "derive") return true;
    }
    current = current.parent;
  }
  return false;
}

function isNearMacroInvocation(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  node: ts.Node
): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current)) {
      if (ts.isIdentifier(current.expression)) {
        if (EXPRESSION_MACROS.has(current.expression.text)) return true;
      }
    }
    if (ts.isTaggedTemplateExpression(current)) {
      if (ts.isIdentifier(current.tag)) {
        if (TAGGED_TEMPLATE_MACROS.has(current.tag.text)) return true;
      }
    }
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      for (const stmt of current.statements ?? []) {
        if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
          if (ts.isIdentifier(stmt.expression.expression)) {
            if (EXPRESSION_MACROS.has(stmt.expression.expression.text)) return true;
          }
        }
      }
    }
    current = current.parent;
  }
  return false;
}

function isExtensionMethodCall(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  node: ts.Node
): boolean {
  if (ts.isIdentifier(node) && EXTENSION_METHOD_NAMES.has(node.text)) {
    const parent = node.parent;
    if (parent && ts.isPropertyAccessExpression(parent)) {
      const grandParent = parent.parent;
      if (grandParent && ts.isCallExpression(grandParent)) {
        return true;
      }
      return true;
    }
  }

  if (ts.isPropertyAccessExpression(node)) {
    if (EXTENSION_METHOD_NAMES.has(node.name.text)) {
      return true;
    }
  }

  return false;
}

function getExtensionMethodCompletions(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  node: ts.Node,
  program: ts.Program | undefined
): ts.CompletionEntry[] {
  if (!program) return [];

  let propAccess: ts.PropertyAccessExpression | undefined;

  if (ts.isPropertyAccessExpression(node)) {
    propAccess = node;
  } else if (node.parent && ts.isPropertyAccessExpression(node.parent)) {
    propAccess = node.parent;
  }

  if (!propAccess) return [];

  const checker = program.getTypeChecker();
  const receiverType = checker.getTypeAtLocation(propAccess.expression);

  const entries: ts.CompletionEntry[] = [];

  for (const [methodName, info] of Object.entries(TYPECLASS_EXTENSION_METHODS)) {
    const existingProp = receiverType.getProperty(methodName);
    if (existingProp) continue;

    const returnType =
      info.returnType === "self" ? checker.typeToString(receiverType) : info.returnType;

    entries.push({
      name: methodName,
      kind: ts.ScriptElementKind.memberFunctionElement,
      kindModifiers: "typemacro",
      sortText: `1_ext_${methodName}`,
      labelDetails: {
        description: `(extension via ${info.typeclass}) → ${returnType}`,
      },
    });
  }

  return entries;
}

function getExtensionMethodHoverInfo(
  ts: typeof import("typescript"),
  sourceFile: ts.SourceFile,
  node: ts.Identifier,
  program: ts.Program | undefined
): { displayText: string; documentation: string } | undefined {
  if (!program) return undefined;

  const methodName = node.text;
  const info = TYPECLASS_EXTENSION_METHODS[methodName];
  if (!info) return undefined;

  const parent = node.parent;
  if (!parent || !ts.isPropertyAccessExpression(parent)) return undefined;

  const checker = program.getTypeChecker();
  const receiverType = checker.getTypeAtLocation(parent.expression);
  const existingProp = receiverType.getProperty(methodName);
  if (existingProp) return undefined;

  const typeName = checker.typeToString(receiverType);
  const returnType = info.returnType === "self" ? typeName : info.returnType;

  return {
    displayText: `(extension method via ${info.typeclass}) ${typeName}.${methodName}(): ${returnType}`,
    documentation:
      `${info.description}\n\n` +
      `Provided by the ${info.typeclass} typeclass. ` +
      `At compile time, this is rewritten to:\n` +
      `  ${info.typeclass}.summon<${typeName}>("${typeName}").${methodName}(...)`,
  };
}

export default init;
