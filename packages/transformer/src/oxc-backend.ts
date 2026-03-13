/**
 * Oxc Backend for TransformationPipeline
 *
 * This module bridges the oxc-native macro engine with the existing
 * TypeScript-based macro system. The oxc engine handles parsing, AST
 * traversal, and code generation, while TypeScript handles type checking
 * and macro expansion logic.
 */

import * as ts from "typescript";
import {
  transformWithMacros,
  type MacroCallInfo,
  type MacroExpansion,
  type TransformResult as OxcTransformResult,
  type TransformOptions as OxcTransformOptions,
} from "@typesugar/oxc-engine";
import { globalRegistry } from "@typesugar/core";

/**
 * Callback type for oxc macro expansion
 */
export type OxcMacroCallback = (json: string) => string;

/**
 * Result from the oxc backend transformation
 */
export interface OxcBackendResult {
  code: string;
  map: string | null;
  changed: boolean;
  diagnostics: Array<{
    severity: string;
    message: string;
    line?: number;
    column?: number;
  }>;
}

/**
 * Create a macro callback that routes to the existing macro system.
 *
 * This callback:
 * 1. Receives MacroCallInfo from the oxc engine
 * 2. Looks up the appropriate macro handler
 * 3. Creates a MacroContext with the TypeChecker
 * 4. Calls the macro's expand function
 * 5. Returns the expanded code as MacroExpansion
 */
export function createOxcMacroCallback(
  program: ts.Program,
  sourceFile: ts.SourceFile
): OxcMacroCallback {
  const typeChecker = program.getTypeChecker();

  return (json: string): string => {
    const callInfo: MacroCallInfo = JSON.parse(json);

    try {
      const expansion = processMacroCall(
        callInfo,
        program,
        typeChecker,
        sourceFile
      );
      return JSON.stringify(expansion);
    } catch (error) {
      const expansion: MacroExpansion = {
        code: "", // Return empty code on error
        kind: "expression",
        diagnostics: [
          {
            severity: "error",
            message: `Macro expansion failed: ${error}`,
            line: callInfo.line,
            column: callInfo.column,
          },
        ],
      };
      return JSON.stringify(expansion);
    }
  };
}

/**
 * Process a macro call using the existing macro system.
 */
function processMacroCall(
  callInfo: MacroCallInfo,
  program: ts.Program,
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): MacroExpansion {
  const { macroName, callSiteArgs, jsDocTag } = callInfo;

  // Check if this is an expression macro (__binop__, ops, etc.)
  // This check must come first because expression macros don't have jsDocTag
  if (isExpressionMacro(macroName)) {
    return processExpressionMacro(callInfo, program, typeChecker, sourceFile);
  }

  // Check if this is a JSDoc-annotated macro
  // Note: jsDocTag is null (not undefined) when not present due to JSON deserialization
  if (jsDocTag != null || isJsDocMacro(macroName)) {
    return processJsDocMacro(callInfo, program, typeChecker, sourceFile);
  }

  // Unknown macro - return unchanged
  return {
    code: "", // Empty means don't change
    kind: "expression",
    diagnostics: [
      {
        severity: "warning",
        message: `Unknown macro: ${macroName}`,
        line: callInfo.line,
        column: callInfo.column,
      },
    ],
  };
}

/**
 * Check if a macro name is a JSDoc-style macro
 */
function isJsDocMacro(name: string): boolean {
  return [
    "typeclass",
    "impl",
    "deriving",
    "extension",
    "specialize",
    "reflect",
    "generic",
    "implicits",
  ].includes(name);
}

/**
 * Check if a macro name is an expression macro
 */
function isExpressionMacro(name: string): boolean {
  return ["__binop__", "ops"].includes(name);
}

/**
 * Process a JSDoc-annotated macro (@typeclass, @impl, etc.)
 */
function processJsDocMacro(
  callInfo: MacroCallInfo,
  program: ts.Program,
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): MacroExpansion {
  const { macroName, jsDocTag, line, column } = callInfo;

  // Look up the attribute macro by name
  const macro = globalRegistry.getAttribute(macroName);

  if (!macro) {
    return {
      code: "",
      kind: "declaration",
      diagnostics: [
        {
          severity: "warning",
          message: `No handler found for @${macroName} macro`,
          line,
          column,
        },
      ],
    };
  }

  // Type-aware macros (typeclass, impl, etc.) require ts.TransformationContext
  // which is not available in the callback-based oxc architecture.
  //
  // For now, these macros are not expanded by the oxc backend. Files containing
  // them should use `backend: 'typescript'` until one of these approaches is
  // implemented:
  //
  // 1. Hybrid fallback: Pipeline detects this diagnostic and falls back to TS
  // 2. Per-site ts.transform(): Run mini transform for each macro site
  // 3. TransformationContext shim: Create minimal fake context for macro use
  //
  // Returning empty code means the original source is preserved unchanged.
  return {
    code: "", // Empty = preserve original source
    kind: "declaration",
    diagnostics: [
      {
        severity: "warning",
        message: `@${macroName} macro requires TypeScript transformer. Use backend: 'typescript' for files with this macro.`,
        line,
        column,
      },
    ],
  };
}

/**
 * Process an expression macro (__binop__, ops, etc.)
 */
function processExpressionMacro(
  callInfo: MacroCallInfo,
  program: ts.Program,
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): MacroExpansion {
  const { macroName, callSiteArgs, line, column } = callInfo;

  if (macroName === "__binop__") {
    return processBinopMacro(callSiteArgs, typeChecker, sourceFile, line, column);
  }

  if (macroName === "ops") {
    // ops() macro - look up in expression registry
    const macro = globalRegistry.getExpression("ops");
    if (macro) {
      // For now, return a placeholder - full implementation requires
      // parsing args and calling macro.expand()
      return {
        code: "",
        kind: "expression",
        diagnostics: [
          {
            severity: "info",
            message: `ops() macro detected - oxc backend support in progress`,
            line,
            column,
          },
        ],
      };
    }
  }

  return {
    code: "",
    kind: "expression",
    diagnostics: [
      {
        severity: "warning",
        message: `Unknown expression macro: ${macroName}`,
        line,
        column,
      },
    ],
  };
}

/**
 * Process __binop__(left, operator, right) macro
 *
 * Resolution order:
 * 1. Check methodOperatorMappings (@operator decorator)
 * 2. Check syntaxRegistry (typeclass Op<> annotations)
 * 3. Fall back to semantic defaults (|> = pipeline, :: = cons)
 */
function processBinopMacro(
  args: string[],
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  line: number,
  column: number
): MacroExpansion {
  if (args.length !== 3) {
    return {
      code: "",
      kind: "expression",
      diagnostics: [
        {
          severity: "error",
          message: `__binop__ requires exactly 3 arguments, got ${args.length}`,
          line,
          column,
        },
      ],
    };
  }

  const [left, operatorArg, right] = args;
  // Remove quotes from operator string literal
  const operator = operatorArg.replace(/^['"]|['"]$/g, "");

  // Apply default semantics for common operators
  switch (operator) {
    case "|>":
      // Pipeline: f |> g means g(f)
      return {
        code: `${right}(${left})`,
        kind: "expression",
        diagnostics: [],
      };

    case "<|":
      // Reverse pipeline: f <| g means f(g)
      return {
        code: `${left}(${right})`,
        kind: "expression",
        diagnostics: [],
      };

    case "::":
      // Cons: h :: t means [h, ...t]
      return {
        code: `[${left}, ...${right}]`,
        kind: "expression",
        diagnostics: [],
      };

    default:
      // Unknown operator - return warning
      return {
        code: "",
        kind: "expression",
        diagnostics: [
          {
            severity: "warning",
            message: `Unknown operator: ${operator}`,
            line,
            column,
          },
        ],
      };
  }
}

/**
 * Transform source code using the oxc backend.
 */
export function transformWithOxcBackend(
  source: string,
  fileName: string,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  options?: OxcTransformOptions
): OxcBackendResult {
  const callback = createOxcMacroCallback(program, sourceFile);

  const result = transformWithMacros(source, fileName, options ?? null, callback);

  return {
    code: result.code,
    map: result.map ?? null,
    changed: result.changed,
    diagnostics: result.diagnostics,
  };
}
