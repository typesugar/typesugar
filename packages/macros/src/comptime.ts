/**
 * comptime macro - Evaluate expressions at compile time
 *
 * Inspired by Zig's comptime keyword, this macro evaluates expressions
 * during compilation and replaces them with their computed values.
 *
 * Uses Node's vm module to execute transpiled TypeScript in a separate
 * context, giving full JavaScript semantics (closures, recursion, all
 * operators, built-in methods) without maintaining a custom interpreter.
 *
 * SECURITY: comptime runs code with the privileges of the build (the
 * compiler process). It is NOT a sandbox for untrusted code. The vm context
 * is hardened — no host-realm objects are reachable from it, `eval`/`new
 * Function` are disabled, and the fs/env helpers are permission-checked on
 * the host side — but Node documents `node:vm` as not being a security
 * mechanism, and the permissions are a guard against accidents only. Do not
 * build untrusted code outside a disposable, isolated environment. Editor
 * hosts should disable evaluation via `setComptimeEvaluationEnabled(false)`.
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
import { TS9209 } from "@typesugar/core";

/**
 * Permissions that can be granted to comptime blocks.
 *
 * By default a comptime block gets no file-system or environment access
 * through the provided `fs` / `process.env` / `require()` helpers.
 * Permissions must be explicitly granted:
 *
 * - fs: 'read' | 'write' | true - File system access (restricted to the project root)
 * - env: 'read' | true - Environment variable access
 * - net: boolean | string[] - Network access (not yet implemented)
 * - time: boolean - Real time access (not yet implemented)
 *
 * **These permissions are a guard against accidents, not a security boundary.**
 * comptime code runs inside the compiler process with build-time privileges.
 * The `node:vm` context it runs in is hardened (no host-realm objects are
 * reachable, string code generation is disabled), but Node documents `vm` as
 * NOT a security mechanism. Never compile untrusted code that contains
 * comptime blocks outside a disposable, isolated environment.
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

// ---------------------------------------------------------------------------
// Execution policy (editor hosts)
// ---------------------------------------------------------------------------

let comptimeEvaluationEnabled = true;

/**
 * Enable or disable comptime evaluation for this process.
 *
 * comptime executes the code it is given with the privileges of the process
 * running the transformer. Editor hosts (the TypeScript language-service
 * plugin, the LSP server) transform every file the moment it is opened, so a
 * cloned-but-unreviewed repository would run its comptime blocks just by
 * being viewed. Those hosts must call `setComptimeEvaluationEnabled(false)`
 * unless the user has explicitly opted in (e.g. a trusted workspace).
 *
 * While disabled, `comptime(...)` calls are left unexpanded and a warning is
 * reported at each call site.
 */
export function setComptimeEvaluationEnabled(enabled: boolean): void {
  comptimeEvaluationEnabled = enabled;
}

/** Whether comptime evaluation is currently enabled (see {@link setComptimeEvaluationEnabled}). */
export function isComptimeEvaluationEnabled(): boolean {
  return comptimeEvaluationEnabled;
}

// ---------------------------------------------------------------------------
// Host side of the sandbox bridge
// ---------------------------------------------------------------------------
//
// SECURITY MODEL. No host-realm object or function is ever placed where code
// inside the vm context can reach it: every host function has a `.constructor`
// that is the HOST `Function`, and `hostFn.constructor("return process")()`
// is a full escape. Instead:
//
//   - the context is created from a null-prototype object with
//     `codeGeneration: { strings: false, wasm: false }`, so the context's own
//     `Function`/`eval` refuse to compile strings;
//   - all globals (`fs`, `path`, `process`, `require`, `console`) are built by
//     a bootstrap script INSIDE the context, so they are context-realm objects;
//   - the bootstrap captures exactly two host functions in a closure (never on
//     the global object): `hostCall(op, argsJson) => resultJson` and
//     `hostLog(level, text)`. Both take and return only primitive strings, and
//     neither ever throws or calls back into context code, so no host object
//     (including a host Error) crosses into the context;
//   - permissions are enforced on the host side of the bridge, so replacing
//     the in-context helpers cannot widen access.
//
// This is defence in depth, not a sandbox for untrusted code — see
// ComptimePermissions above and docs/guides/comptime.md.

type BridgeOutcome =
  | { ok: true; value?: unknown }
  | { ok: false; name: string; message: string; permission?: string };

/** Path functions forwarded to the host `node:path` module. */
const BRIDGED_PATH_FUNCTIONS = [
  "join",
  "resolve",
  "dirname",
  "basename",
  "extname",
  "relative",
  "normalize",
  "isAbsolute",
  "parse",
  "format",
  "toNamespacedPath",
] as const;

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`comptime: ${what} must be a string, got ${typeof value}`);
  }
  return value;
}

/**
 * Build the host-side operation table. Every operation receives JSON-decoded
 * (host-realm, plain-data) arguments and returns plain data, which is
 * JSON-encoded before it crosses back into the context.
 */
function createHostOperations(
  baseDir: string,
  projectRoot: string,
  permissions: ComptimePermissions
): Record<string, (...args: unknown[]) => unknown> {
  const normalizedRoot = nodePath.normalize(projectRoot);

  const checkRead = () => {
    if (!permissions.fs) {
      throw new ComptimePermissionError("fs", "File read");
    }
  };

  const checkWrite = () => {
    const fsPermission = permissions.fs;
    if (fsPermission !== true && fsPermission !== "write") {
      throw new ComptimePermissionError("fs", "File write");
    }
  };

  const checkEnvRead = () => {
    if (!permissions.env) {
      throw new ComptimePermissionError("env", "Environment variable read");
    }
  };

  const resolvePath = (input: unknown): string => {
    const relativePath = requireString(input, "path");
    if (nodePath.isAbsolute(relativePath)) {
      throw new Error(
        `Security: absolute paths are not allowed in comptime fs. ` +
          `Use a path relative to the source file instead: "${relativePath}"`
      );
    }
    const resolved = nodePath.normalize(nodePath.resolve(baseDir, relativePath));
    const rel = nodePath.relative(normalizedRoot, resolved);
    if (rel === ".." || rel.startsWith(".." + nodePath.sep) || nodePath.isAbsolute(rel)) {
      throw new Error(
        `Security: path "${relativePath}" resolves to "${resolved}" which is ` +
          `outside the project root "${normalizedRoot}". ` +
          `File access is restricted to the project directory.`
      );
    }
    return resolved;
  };

  const validEncoding = (enc: unknown): BufferEncoding | undefined => {
    if (enc === null || enc === undefined) return undefined;
    const e = requireString(enc, "encoding");
    if (!Buffer.isEncoding(e)) throw new TypeError(`comptime: unknown encoding "${e}"`);
    return e;
  };

  const statToData = (st: nodeFs.Stats) => ({
    size: st.size,
    mode: st.mode,
    mtimeMs: st.mtimeMs,
    atimeMs: st.atimeMs,
    ctimeMs: st.ctimeMs,
    birthtimeMs: st.birthtimeMs,
    isFile: st.isFile(),
    isDirectory: st.isDirectory(),
    isSymbolicLink: st.isSymbolicLink(),
  });

  const ops: Record<string, (...args: unknown[]) => unknown> = {
    "fs.require": () => {
      if (!permissions.fs) throw new ComptimePermissionError("fs", "require('fs')");
      return true;
    },
    "fs.readFile": (p, enc) => {
      checkRead();
      const abs = resolvePath(p);
      const encoding = validEncoding(enc);
      if (encoding) return { text: nodeFs.readFileSync(abs, encoding) };
      return { base64: nodeFs.readFileSync(abs).toString("base64") };
    },
    "fs.exists": (p) => {
      checkRead();
      return nodeFs.existsSync(resolvePath(p));
    },
    "fs.readdir": (p, withFileTypes) => {
      checkRead();
      const abs = resolvePath(p);
      if (withFileTypes === true) {
        return nodeFs.readdirSync(abs, { withFileTypes: true }).map((d) => ({
          name: d.name,
          isFile: d.isFile(),
          isDirectory: d.isDirectory(),
          isSymbolicLink: d.isSymbolicLink(),
        }));
      }
      return nodeFs.readdirSync(abs);
    },
    "fs.stat": (p) => {
      checkRead();
      return statToData(nodeFs.statSync(resolvePath(p)));
    },
    "fs.writeFile": (p, payload, enc) => {
      checkWrite();
      const abs = resolvePath(p);
      const data = payload as { text?: unknown; base64?: unknown } | null;
      if (data && typeof data.text === "string") {
        nodeFs.writeFileSync(abs, data.text, { encoding: validEncoding(enc) ?? "utf8" });
      } else if (data && typeof data.base64 === "string") {
        nodeFs.writeFileSync(abs, Buffer.from(data.base64, "base64"));
      } else {
        throw new TypeError("comptime: writeFileSync data must be a string or Uint8Array");
      }
      return undefined;
    },
    "fs.mkdir": (p, recursive) => {
      checkWrite();
      return nodeFs.mkdirSync(resolvePath(p), { recursive: recursive === true });
    },
    "env.get": (name) => {
      checkEnvRead();
      return process.env[requireString(name, "environment variable name")];
    },
    "env.has": (name) => {
      checkEnvRead();
      return requireString(name, "environment variable name") in process.env;
    },
    "env.keys": () => {
      checkEnvRead();
      return Object.keys(process.env);
    },
    "buffer.toString": (base64, enc) => {
      return Buffer.from(requireString(base64, "data"), "base64").toString(
        validEncoding(enc) ?? "utf8"
      );
    },
  };

  for (const fn of BRIDGED_PATH_FUNCTIONS) {
    ops[`path.${fn}`] = (...args: unknown[]) => {
      if (fn === "parse") return nodePath.parse(requireString(args[0], "path"));
      if (fn === "format") {
        const o = args[0];
        if (o === null || typeof o !== "object") {
          throw new TypeError("comptime: path.format expects an object");
        }
        return nodePath.format(o as nodePath.FormatInputPathObject);
      }
      const strings = args.map((a) => requireString(a, `path.${fn} argument`));
      return (nodePath[fn] as (...a: string[]) => unknown)(...strings);
    };
  }

  return ops;
}

/**
 * The single host function exposed (via closure only) to the context.
 * Takes and returns primitive strings; never throws.
 */
function createHostCall(ops: Record<string, (...args: unknown[]) => unknown>) {
  return (op: unknown, argsJson: unknown): string => {
    let outcome: BridgeOutcome;
    try {
      if (typeof op !== "string" || typeof argsJson !== "string") {
        throw new TypeError("comptime: malformed bridge call");
      }
      const impl = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : undefined;
      if (!impl) throw new Error(`comptime: unknown bridge operation "${op}"`);
      const args: unknown = JSON.parse(argsJson);
      if (!Array.isArray(args)) throw new TypeError("comptime: malformed bridge arguments");
      outcome = { ok: true, value: impl(...args) };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      outcome =
        error instanceof ComptimePermissionError
          ? { ok: false, name, message, permission: error.permission }
          : { ok: false, name, message };
    }
    try {
      return JSON.stringify(outcome);
    } catch {
      return '{"ok":false,"name":"Error","message":"comptime: bridge result is not serializable"}';
    }
  };
}

function createHostLog() {
  return (level: unknown, text: unknown): void => {
    try {
      const msg = typeof text === "string" ? text : "";
      if (level === "warn") console.warn("[comptime]", msg);
      else if (level === "error") console.error("[comptime]", msg);
      else console.log("[comptime]", msg);
    } catch {
      // Logging must never throw back into the context.
    }
  };
}

/**
 * In-context bootstrap. Evaluates to a function that receives the two host
 * bridge functions and installs context-realm `fs`, `path`, `process`,
 * `require` and `console` globals that marshal only primitives across the
 * bridge. The host functions stay in this closure and are never reachable
 * from user code.
 */
const SANDBOX_BOOTSTRAP = String.raw`(function (hostCall, hostLog, init) {
  "use strict";
  var g = globalThis;
  var parse = JSON.parse;
  var stringify = JSON.stringify;
  var defineProperty = Object.defineProperty;

  // Stack-trace hooks can expose function objects from other frames; pin it off.
  try { defineProperty(Error, "prepareStackTrace", { value: undefined, writable: false, configurable: false }); } catch (_e) {}

  function call(op, args) {
    var raw;
    try { raw = hostCall(op, stringify(args)); }
    catch (_e) { throw new Error("comptime: host bridge call '" + op + "' failed"); }
    var r = parse(raw);
    if (!r.ok) {
      var e = r.name === "TypeError" ? new TypeError(r.message) : new Error(r.message);
      if (r.name && r.name !== e.name) e.name = r.name;
      if (r.permission) e.permission = r.permission;
      throw e;
    }
    return r.value;
  }

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var B64_INDEX = {};
  for (var bi = 0; bi < B64.length; bi++) B64_INDEX[B64.charAt(bi)] = bi;
  function bytesToB64(u8) {
    var out = "";
    for (var i = 0; i < u8.length; i += 3) {
      var a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0;
      var n = (a << 16) | (b << 8) | c;
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) +
        (i + 1 < u8.length ? B64.charAt((n >> 6) & 63) : "=") +
        (i + 2 < u8.length ? B64.charAt(n & 63) : "=");
    }
    return out;
  }
  function b64ToBytes(s, Ctor) {
    var clean = s.replace(/=+$/, "");
    var len = Math.floor((clean.length * 3) / 4);
    var out = new Ctor(len);
    var o = 0;
    for (var i = 0; i < clean.length; i += 4) {
      var n = (B64_INDEX[clean.charAt(i)] << 18) | (B64_INDEX[clean.charAt(i + 1)] << 12) |
        ((B64_INDEX[clean.charAt(i + 2)] || 0) << 6) | (B64_INDEX[clean.charAt(i + 3)] || 0);
      if (o < len) out[o++] = (n >> 16) & 255;
      if (o < len) out[o++] = (n >> 8) & 255;
      if (o < len) out[o++] = n & 255;
    }
    return out;
  }

  class Buffer extends Uint8Array {
    toString(encoding) {
      return call("buffer.toString", [bytesToB64(this), encoding === undefined ? "utf8" : String(encoding)]);
    }
  }

  function encodingOf(o) {
    if (typeof o === "string") return o;
    if (o && typeof o === "object" && typeof o.encoding === "string") return o.encoding;
    return null;
  }
  function statObject(d) {
    return {
      size: d.size, mode: d.mode,
      mtimeMs: d.mtimeMs, atimeMs: d.atimeMs, ctimeMs: d.ctimeMs, birthtimeMs: d.birthtimeMs,
      mtime: new Date(d.mtimeMs), atime: new Date(d.atimeMs), ctime: new Date(d.ctimeMs), birthtime: new Date(d.birthtimeMs),
      isFile: function () { return d.isFile; },
      isDirectory: function () { return d.isDirectory; },
      isSymbolicLink: function () { return d.isSymbolicLink; }
    };
  }
  function direntObject(d) {
    return {
      name: d.name,
      isFile: function () { return d.isFile; },
      isDirectory: function () { return d.isDirectory; },
      isSymbolicLink: function () { return d.isSymbolicLink; }
    };
  }

  var fs = {
    readFileSync: function (p, options) {
      var enc = encodingOf(options);
      var r = call("fs.readFile", [p, enc]);
      return enc ? r.text : b64ToBytes(r.base64, Buffer);
    },
    existsSync: function (p) { return call("fs.exists", [p]); },
    readdirSync: function (p, options) {
      var withTypes = !!(options && typeof options === "object" && options.withFileTypes);
      var r = call("fs.readdir", [p, withTypes]);
      return withTypes ? r.map(direntObject) : r;
    },
    statSync: function (p) { return statObject(call("fs.stat", [p])); },
    writeFileSync: function (p, data, options) {
      var payload;
      if (typeof data === "string") payload = { text: data };
      else if (data instanceof Uint8Array) payload = { base64: bytesToB64(data) };
      else payload = null;
      call("fs.writeFile", [p, payload, encodingOf(options)]);
    },
    mkdirSync: function (p, options) {
      return call("fs.mkdir", [p, !!(options && typeof options === "object" && options.recursive)]);
    }
  };

  var path = { sep: init.sep, delimiter: init.delimiter };
  init.pathFunctions.forEach(function (name) {
    path[name] = function () { return call("path." + name, Array.prototype.slice.call(arguments)); };
  });

  var env = new Proxy({}, {
    get: function (_t, k) { return typeof k === "string" ? call("env.get", [k]) : undefined; },
    has: function (_t, k) { return typeof k === "string" ? call("env.has", [k]) : false; },
    ownKeys: function () { return call("env.keys", []); },
    getOwnPropertyDescriptor: function (_t, k) {
      if (typeof k !== "string") return undefined;
      var v = call("env.get", [k]);
      return v === undefined ? undefined : { value: v, writable: false, enumerable: true, configurable: true };
    }
  });
  var cwd = init.cwd;
  var proc = { env: env, cwd: function () { return cwd; }, platform: init.platform, arch: init.arch };

  function sandboxRequire(name) {
    switch (name) {
      case "fs": case "node:fs": call("fs.require", []); return fs;
      case "path": case "node:path": return path;
      case "process": case "node:process": return proc;
      default:
        throw new Error("comptime: require('" + String(name) + "') is not supported. " +
          "Only 'fs', 'path', and 'process' are available.");
    }
  }

  function fmt(a) {
    if (typeof a === "string") return a;
    try { var s = stringify(a); return s === undefined ? String(a) : s; }
    catch (_e) { try { return String(a); } catch (_e2) { return "[unprintable]"; } }
  }
  var con = {};
  ["log", "info", "debug", "warn", "error"].forEach(function (level) {
    con[level] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
      try { hostLog(level, parts.join(" ")); } catch (_e) {}
    };
  });

  g.fs = fs;
  g.path = path;
  g.process = proc;
  g.require = sandboxRequire;
  g.console = con;
  g.Buffer = Buffer;
})`;

/**
 * Create the hardened vm context for one comptime evaluation.
 */
function createComptimeContext(
  baseDir: string,
  projectRoot: string,
  permissions: ComptimePermissions
): vm.Context {
  const context = vm.createContext(Object.create(null), {
    name: "typesugar-comptime",
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: "afterEvaluate",
  });
  const install = vm.runInContext(SANDBOX_BOOTSTRAP, context, {
    filename: "typesugar-comptime-bootstrap.js",
  }) as (hostCall: unknown, hostLog: unknown, init: unknown) => void;
  // `init` is created inside the context so the bootstrap never holds a
  // host-realm object.
  const init = vm.runInContext(
    `(${JSON.stringify({
      cwd: baseDir,
      platform: process.platform,
      arch: process.arch,
      sep: nodePath.sep,
      delimiter: nodePath.delimiter,
      pathFunctions: BRIDGED_PATH_FUNCTIONS,
    })})`,
    context
  );
  install(
    createHostCall(createHostOperations(baseDir, projectRoot, permissions)),
    createHostLog(),
    init
  );
  return context;
}

/**
 * Read name/message/permission off a thrown value without assuming it is a
 * host-realm Error (values thrown inside the context are context-realm).
 */
function describeThrown(error: unknown): { name: string; message: string; permission?: string } {
  try {
    if (error !== null && (typeof error === "object" || typeof error === "function")) {
      const e = error as { name?: unknown; message?: unknown; permission?: unknown };
      const name = typeof e.name === "string" ? e.name : "Error";
      const message = typeof e.message === "string" ? e.message : "(non-Error value thrown)";
      const permission = typeof e.permission === "string" ? e.permission : undefined;
      return { name, message, permission };
    }
    return { name: "Error", message: String(error) };
  } catch {
    return { name: "Error", message: "(unprintable error)" };
  }
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

    if (!comptimeEvaluationEnabled) {
      // Editor hosts disable comptime so that opening a file never executes
      // its code. Leave the call as-is and say so, rather than skipping
      // silently.
      ctx.reportWarning(
        callExpr,
        "comptime evaluation is disabled in this host (e.g. the editor language service); " +
          "the call was left unexpanded. comptime runs code with build-time privileges, " +
          "so editors only evaluate it when explicitly enabled."
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
/**
 * The directory comptime `fs` access is confined to: the project, i.e. the
 * tsconfig's directory — NOT `program.getCurrentDirectory()`, which is the
 * process cwd and made a build started from another directory reject every
 * project path as "outside the project root" (docs review 2026-10).
 *
 * 1. `compilerOptions.configFilePath` (set by tsc / ts-patch and any host that
 *    parses the tsconfig with its file name);
 * 2. else the nearest `tsconfig.json` at or above the source file's directory;
 * 3. else the program's current directory (unless it is "/" — single-file
 *    `transformCode` uses that), else the source file's own directory.
 */
function comptimeProjectRoot(program: ts.Program, baseDir: string): string {
  const configFilePath = program.getCompilerOptions().configFilePath;
  if (typeof configFilePath === "string" && configFilePath) {
    return nodePath.dirname(nodePath.resolve(configFilePath));
  }
  for (let dir = nodePath.resolve(baseDir); ; ) {
    if (nodeFs.existsSync(nodePath.join(dir, "tsconfig.json"))) return dir;
    const parent = nodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const cwd = program.getCurrentDirectory();
  return cwd && cwd !== "/" ? cwd : baseDir;
}

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
  const projectRoot = comptimeProjectRoot(ctx.program, baseDir);

  try {
    const context = createComptimeContext(baseDir, projectRoot, permissions);

    const result = vm.runInContext(cleanedJs, context, {
      timeout: COMPTIME_TIMEOUT_MS,
      filename: "comptime-eval.js",
    });

    return jsValueToExpression(ctx, result, callExpr);
  } catch (error: unknown) {
    const thrown = describeThrown(error);
    const errMsg = thrown.message;
    ctx
      .diagnostic(TS9209)
      .at(callExpr)
      .note(formatComptimeError(thrown, sourceText, ctx, callExpr))
      .emit();
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
  error: { name: string; message: string; permission?: string },
  sourceText: string,
  ctx: MacroContextImpl,
  callExpr: ts.CallExpression
): string {
  const rawMessage = error.message;

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
  if (error.name === "ComptimePermissionError" && error.permission) {
    hint =
      `\n  Hint: Add { ${error.permission}: 'read' } as the first argument to comptime(). ` +
      `Example: comptime({ ${error.permission}: 'read' }, () => { ... })`;
  } else if (
    error.name === "EvalError" ||
    rawMessage.includes("Code generation from strings disallowed")
  ) {
    hint =
      "\n  Hint: eval() and new Function() are disabled inside comptime. " +
      "Write the code directly in the comptime function instead.";
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
