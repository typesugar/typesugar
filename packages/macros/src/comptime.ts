/**
 * comptime macro - Evaluate expressions at compile time
 *
 * Inspired by Zig's comptime keyword, this macro evaluates expressions
 * during compilation and replaces them with their computed values.
 *
 * Uses Node's vm module to execute transpiled TypeScript in a sandbox,
 * giving full JavaScript semantics (closures, recursion, all operators,
 * built-in methods) without maintaining a custom interpreter.
 *
 * Usage:
 *   const x = comptime(() => 5 * 5);           // becomes: const x = 25;
 *   const factorial5 = comptime(() => {
 *     let result = 1;
 *     for (let i = 1; i <= 5; i++) result *= i;
 *     return result;
 *   });                                         // becomes: const factorial5 = 120;
 *
 * With permissions (for file/env access):
 *   const data = comptime({ fs: 'read' }, () => {
 *     return fs.readFileSync('./data.json', 'utf8');
 *   });
 *   const env = comptime({ env: 'read' }, () => process.env.NODE_ENV);
 */

import * as ts from "typescript";
import * as vm from "node:vm";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext, ComptimeValue } from "@typesugar/core";
import { MacroContextImpl } from "@typesugar/core";
import { jsValueToExpression } from "@typesugar/core";

/**
 * Permissions that can be granted to comptime blocks.
 *
 * By default, comptime blocks run in a restricted sandbox with no I/O access.
 * Permissions must be explicitly granted:
 *
 * - fs: 'read' | 'write' | true - File system access
 * - env: 'read' | true - Environment variable access
 * - net: boolean | string[] - Network access (not yet implemented)
 * - time: boolean - Real time access (not yet implemented)
 */
export interface ComptimePermissions {
  fs?: boolean | "read" | "write";
  env?: boolean | "read";
  net?: boolean | string[];
  time?: boolean;
}

/**
 * Error thrown when a comptime operation is blocked due to missing permissions.
 */
class ComptimePermissionError extends Error {
  constructor(
    public readonly permission: keyof ComptimePermissions,
    public readonly action: string
  ) {
    super(`comptime permission denied: ${action} requires { ${permission}: 'read' | true }`);
    this.name = "ComptimePermissionError";
  }
}

/** Maximum execution time for comptime evaluation (ms) */
const COMPTIME_TIMEOUT_MS = 5000;

/** Maximum iteration limit hint (for documentation; actual enforcement is via timeout) */
const MAX_ITERATIONS = 100_000;

/**
 * Create a permission-checked fs module for the sandbox.
 * Permissions are passed directly and checked at each operation.
 * All resolved paths are validated against projectRoot to prevent traversal.
 */
function createSandboxFs(
  baseDir: string,
  projectRoot: string,
  permissions: ComptimePermissions
): Record<string, unknown> {
  const normalizedRoot = nodePath.normalize(projectRoot);

  const checkRead = () => {
    const fsPermission = permissions.fs;
    if (!fsPermission) {
      throw new ComptimePermissionError("fs", "File read");
    }
  };

  const checkWrite = () => {
    const fsPermission = permissions.fs;
    if (fsPermission !== true && fsPermission !== "write") {
      throw new ComptimePermissionError("fs", "File write");
    }
  };

  const resolvePath = (relativePath: string): string => {
    if (nodePath.isAbsolute(relativePath)) {
      throw new Error(
        `Security: absolute paths are not allowed in comptime fs. ` +
          `Use a path relative to the source file instead: "${relativePath}"`
      );
    }
    const resolved = nodePath.normalize(nodePath.resolve(baseDir, relativePath));
    if (!resolved.startsWith(normalizedRoot + nodePath.sep) && resolved !== normalizedRoot) {
      throw new Error(
        `Security: path "${relativePath}" resolves to "${resolved}" which is ` +
          `outside the project root "${normalizedRoot}". ` +
          `File access is restricted to the project directory.`
      );
    }
    return resolved;
  };

  return {
    readFileSync: (
      filePath: string,
      encoding?: BufferEncoding | { encoding?: BufferEncoding }
    ): string | Buffer => {
      checkRead();
      const absolutePath = resolvePath(filePath);
      const enc = typeof encoding === "string" ? encoding : encoding?.encoding;
      return nodeFs.readFileSync(absolutePath, enc as BufferEncoding);
    },

    existsSync: (filePath: string): boolean => {
      checkRead();
      const absolutePath = resolvePath(filePath);
      return nodeFs.existsSync(absolutePath);
    },

    readdirSync: (
      dirPath: string,
      options?: { withFileTypes?: boolean }
    ): string[] | nodeFs.Dirent[] => {
      checkRead();
      const absolutePath = resolvePath(dirPath);
      if (options?.withFileTypes) {
        return nodeFs.readdirSync(absolutePath, { withFileTypes: true });
      }
      return nodeFs.readdirSync(absolutePath);
    },

    statSync: (filePath: string): nodeFs.Stats => {
      checkRead();
      const absolutePath = resolvePath(filePath);
      return nodeFs.statSync(absolutePath);
    },

    writeFileSync: (
      filePath: string,
      data: string | Buffer,
      options?: { encoding?: BufferEncoding }
    ): void => {
      checkWrite();
      const absolutePath = resolvePath(filePath);
      nodeFs.writeFileSync(absolutePath, data, options);
    },

    mkdirSync: (dirPath: string, options?: { recursive?: boolean }): string | undefined => {
      checkWrite();
      const absolutePath = resolvePath(dirPath);
      return nodeFs.mkdirSync(absolutePath, options);
    },
  };
}

/**
 * Create a permission-checked process module for the sandbox.
 */
function createSandboxProcess(
  baseDir: string,
  permissions: ComptimePermissions
): Record<string, unknown> {
  const checkEnvRead = () => {
    const envPermission = permissions.env;
    if (!envPermission) {
      throw new ComptimePermissionError("env", "Environment variable read");
    }
  };

  return {
    env: new Proxy(
      {},
      {
        get(_target, prop: string) {
          checkEnvRead();
          return process.env[prop];
        },
        has(_target, prop: string) {
          checkEnvRead();
          return prop in process.env;
        },
        ownKeys() {
          checkEnvRead();
          return Object.keys(process.env);
        },
        getOwnPropertyDescriptor(_target, prop: string) {
          checkEnvRead();
          if (prop in process.env) {
            return {
              value: process.env[prop],
              writable: false,
              enumerable: true,
              configurable: true,
            };
          }
          return undefined;
        },
      }
    ),
    cwd: () => baseDir,
    platform: process.platform,
    arch: process.arch,
  };
}

/**
 * Create a sandboxed require function that only allows specific modules.
 */
function createSandboxRequire(
  baseDir: string,
  projectRoot: string,
  permissions: ComptimePermissions
): (moduleName: string) => unknown {
  const sandboxFs = createSandboxFs(baseDir, projectRoot, permissions);
  const sandboxProcess = createSandboxProcess(baseDir, permissions);

  return (moduleName: string): unknown => {
    switch (moduleName) {
      case "fs":
      case "node:fs": {
        if (!permissions.fs) {
          throw new ComptimePermissionError("fs", "require('fs')");
        }
        return sandboxFs;
      }
      case "path":
      case "node:path":
        return nodePath;
      case "process":
        return sandboxProcess;
      default:
        throw new Error(
          `comptime: require('${moduleName}') is not supported. ` +
            `Only 'fs', 'path', and 'process' are available.`
        );
    }
  };
}

/**
 * Compiled regex for cleaning transpiled output. Created once, reused.
 */
const RE_USE_STRICT = /^"use strict";\s*/;
const RE_DEFINE_PROPERTY = /\s*Object\.defineProperty\(exports.*\n?/g;
const RE_EXPORTS_VOID = /\s*exports\.\S+ = void 0;\s*/g;

/**
 * Shared compiler options for transpileModule. Allocated once.
 */
const TRANSPILE_OPTIONS: ts.TranspileOptions = {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: false,
    removeComments: true,
  },
  reportDiagnostics: true,
};

/**
 * Parse a permissions object literal from the AST.
 */
function parsePermissions(ctx: MacroContextImpl, expr: ts.Expression): ComptimePermissions {
  const permissions: ComptimePermissions = {};

  if (!ts.isObjectLiteralExpression(expr)) {
    ctx.reportWarning(expr, "comptime permissions should be an object literal");
    return permissions;
  }

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;

    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;

    if (!name) continue;

    const value = prop.initializer;

    switch (name) {
      case "fs": {
        if (value.kind === ts.SyntaxKind.TrueKeyword) {
          permissions.fs = true;
        } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
          permissions.fs = false;
        } else if (ts.isStringLiteral(value)) {
          const text = value.text;
          if (text === "read" || text === "write") {
            permissions.fs = text;
          }
        }
        break;
      }
      case "env": {
        if (value.kind === ts.SyntaxKind.TrueKeyword) {
          permissions.env = true;
        } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
          permissions.env = false;
        } else if (ts.isStringLiteral(value) && value.text === "read") {
          permissions.env = "read";
        }
        break;
      }
      case "net": {
        if (value.kind === ts.SyntaxKind.TrueKeyword) {
          permissions.net = true;
        } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
          permissions.net = false;
        } else if (ts.isArrayLiteralExpression(value)) {
          permissions.net = value.elements.filter(ts.isStringLiteral).map((e) => e.text);
        }
        break;
      }
      case "time": {
        if (value.kind === ts.SyntaxKind.TrueKeyword) {
          permissions.time = true;
        } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
          permissions.time = false;
        }
        break;
      }
    }
  }

  return permissions;
}

export const comptimeMacro = defineExpressionMacro({
  name: "comptime",
  module: "typesugar",
  description: "Evaluate an expression at compile time",
  cacheable: false, // Can read files/env, results depend on execution context

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "comptime expects 1 or 2 arguments: comptime(fn) or comptime(permissions, fn)"
      );
      return callExpr;
    }

    let permissions: ComptimePermissions = {};
    let fnArg: ts.Expression;

    if (args.length === 2) {
      // comptime({ fs: 'read' }, () => { ... })
      permissions = parsePermissions(ctx as MacroContextImpl, args[0]);
      fnArg = args[1];
    } else {
      // comptime(() => { ... })
      fnArg = args[0];
    }

    // If it's an arrow function or function expression, evaluate via vm
    if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
      return evaluateViaVm(ctx as MacroContextImpl, fnArg, callExpr, permissions);
    }

    // For simple expressions without permissions, try the lightweight AST evaluator first
    if (args.length === 1) {
      const result = ctx.evaluate(fnArg);
      if (result.kind !== "error") {
        return (ctx as MacroContextImpl).comptimeValueToExpression(result);
      }
    }

    // Fall back to vm-based evaluation for complex expressions
    return evaluateViaVm(ctx as MacroContextImpl, fnArg, callExpr, permissions);
  },
});

/**
 * Evaluate a TypeScript expression/function at compile time using Node's vm module.
 *
 * This transpiles the source to JavaScript, runs it in a sandboxed context,
 * and converts the result back to a TypeScript AST node.
 */
function evaluateViaVm(
  ctx: MacroContextImpl,
  node: ts.Node,
  callExpr: ts.CallExpression,
  permissions: ComptimePermissions = {}
): ts.Expression {
  // Use printer to avoid "Node must have a real position" on synthetic nodes (TS < 5.8)
  const sourceText = nodeToString(node, ctx);

  // Wrap in an IIFE if it's a function — call it immediately
  const isFunction = ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  const codeToEval = isFunction ? `(${sourceText})()` : `(${sourceText})`;

  // Transpile TypeScript to JavaScript (reuse shared compiler options)
  const { outputText, diagnostics } = ts.transpileModule(codeToEval, TRANSPILE_OPTIONS);

  if (diagnostics && diagnostics.length > 0) {
    const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    ctx.reportError(callExpr, `Cannot transpile comptime expression: ${messages.join("; ")}`);
    return callExpr;
  }

  // Strip the trailing export {} that transpileModule sometimes adds
  const cleanedJs = outputText
    .replace(RE_USE_STRICT, "")
    .replace(RE_DEFINE_PROPERTY, "")
    .replace(RE_EXPORTS_VOID, "");

  // Get the base directory for relative path resolution
  const baseDir = nodePath.dirname(ctx.sourceFile.fileName);
  const projectRoot = ctx.program.getCurrentDirectory();

  try {
    const sandbox = createComptimeSandbox(baseDir, projectRoot, permissions);
    const context = vm.createContext(sandbox);

    const result = vm.runInContext(cleanedJs, context, {
      timeout: COMPTIME_TIMEOUT_MS,
      filename: "comptime-eval.js",
    });

    return jsValueToExpression(ctx, result, callExpr);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    ctx.reportError(callExpr, formatComptimeError(error, sourceText, ctx, callExpr));
    // Return an IIFE that throws the error at runtime
    // This prevents the transformer from trying to re-expand the call
    const factory = ctx.factory;
    return factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock([
            factory.createThrowStatement(
              factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
                factory.createStringLiteral(`comptime evaluation failed: ${errMsg}`),
              ])
            ),
          ])
        )
      ),
      undefined,
      []
    );
  }
}

/**
 * Format a comptime evaluation error with source context.
 *
 * Includes the original source snippet, file location, and a clear
 * explanation of what went wrong -- not just the raw vm error.
 */
function formatComptimeError(
  error: unknown,
  sourceText: string,
  ctx: MacroContextImpl,
  callExpr: ts.CallExpression
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);

  // Get source location (may fail for synthetic nodes)
  let location = "unknown";
  try {
    const sourceFile = ctx.sourceFile;
    const start = callExpr.getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    location = `${sourceFile.fileName}:${line + 1}:${character + 1}`;
  } catch {
    // Synthetic nodes have pos/end = -1, skip location
  }

  // Truncate long source snippets
  const maxSnippetLen = 200;
  const snippet =
    sourceText.length > maxSnippetLen ? sourceText.slice(0, maxSnippetLen) + "..." : sourceText;

  // Detect common error patterns and provide helpful messages
  let hint = "";
  if (error instanceof ComptimePermissionError) {
    hint =
      `\n  Hint: Add { ${error.permission}: 'read' } as the first argument to comptime(). ` +
      `Example: comptime({ ${error.permission}: 'read' }, () => { ... })`;
  } else if (rawMessage.includes("Script execution timed out")) {
    hint =
      `\n  Hint: The expression took longer than ${COMPTIME_TIMEOUT_MS}ms to evaluate. ` +
      `Check for infinite loops or very expensive computations.`;
  } else if (rawMessage.includes("is not defined") || rawMessage.includes("is not a function")) {
    const match = rawMessage.match(/(\w+) is not (defined|a function)/);
    const name = match?.[1] ?? "unknown";
    hint =
      `\n  Hint: '${name}' is not available in the comptime sandbox. ` +
      `Only safe built-ins (Math, JSON, Array, etc.) are accessible. ` +
      `Use comptime({ fs: 'read' }, ...) for file access or ` +
      `comptime({ env: 'read' }, ...) for environment variables.`;
  } else if (rawMessage.includes("Cannot read properties of")) {
    hint =
      "\n  Hint: A null/undefined value was accessed. " +
      "Check that all variables are properly initialized.";
  } else if (rawMessage.includes("require") && rawMessage.includes("not supported")) {
    hint =
      "\n  Hint: Only 'fs', 'path', and 'process' modules are available in comptime. " +
      "For fs access, add { fs: 'read' } permission.";
  }

  return (
    `Compile-time evaluation failed at ${location}\n` +
    `  Source: comptime(${snippet})\n` +
    `  Error: ${rawMessage}${hint}`
  );
}

/**
 * Create a sandboxed environment for comptime evaluation.
 * Only safe, side-effect-free globals are exposed, plus permission-checked
 * modules for fs, path, and process.
 */
function createComptimeSandbox(
  baseDir: string,
  projectRoot: string,
  permissions: ComptimePermissions
): Record<string, unknown> {
  const sandboxFs = createSandboxFs(baseDir, projectRoot, permissions);
  const sandboxProcess = createSandboxProcess(baseDir, permissions);
  const sandboxRequire = createSandboxRequire(baseDir, projectRoot, permissions);

  return {
    // Safe built-ins
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    WeakMap,
    WeakSet,
    JSON,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    NaN,
    Infinity,
    undefined,

    // Console for debugging (output goes to build log)
    console: {
      log: (...args: unknown[]) => console.log("[comptime]", ...args),
      warn: (...args: unknown[]) => console.warn("[comptime]", ...args),
      error: (...args: unknown[]) => console.error("[comptime]", ...args),
    },

    // Permission-checked modules (available as globals)
    fs: sandboxFs,
    path: nodePath,
    process: sandboxProcess,

    // require() for CommonJS-style imports
    require: sandboxRequire,
  };
}

/**
 * Convert a TS node to its source text when getText() is unavailable
 * (e.g., for synthetically created nodes).
 * Uses the context's shared printer to avoid creating a new one per call.
 */
function nodeToString(node: ts.Node, ctx: MacroContextImpl): string {
  return ctx.printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile);
}

/**
 * Convert a JS value to a ComptimeValue (for interop with the lightweight evaluator).
 * Handles circular references gracefully by tracking seen objects.
 */
export function jsToComptimeValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): ComptimeValue {
  if (value === null) return { kind: "null" };
  if (value === undefined) return { kind: "undefined" };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "bigint") return { kind: "bigint", value };
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return { kind: "error", message: "Circular reference detected in array" };
    }
    seen.add(value);
    return { kind: "array", elements: value.map((v) => jsToComptimeValue(v, seen)) };
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return { kind: "error", message: "Circular reference detected in object" };
    }
    seen.add(value);
    const properties = new Map<string, ComptimeValue>();
    for (const [k, v] of Object.entries(value)) {
      properties.set(k, jsToComptimeValue(v, seen));
    }
    return { kind: "object", properties };
  }
  return {
    kind: "error",
    message: `Cannot convert ${typeof value} to ComptimeValue`,
  };
}

// Register the macro
globalRegistry.register(comptimeMacro);
