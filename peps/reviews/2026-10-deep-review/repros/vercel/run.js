"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// api/run.ts
var run_exports = {};
__export(run_exports, {
  default: () => handler
});
module.exports = __toCommonJS(run_exports);
var vm = __toESM(require("vm"), 1);
var path = __toESM(require("path"), 1);
var import_module = require("module");
var import_meta = {};
var require2 = (0, import_module.createRequire)(import_meta.url);
var limits = /* @__PURE__ */ new Map();
function isAllowed(ip) {
  const now = Date.now();
  const entry = limits.get(ip);
  if (!entry || now - entry.windowStart > 6e4) {
    limits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 30)
    return false;
  entry.count++;
  return true;
}
async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!isAllowed(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Rate limit exceeded" });
  }
  const body = req.body;
  if (!body || typeof body.code !== "string") {
    return res.status(400).json({ error: "Body must include `code` string" });
  }
  if (body.code.length > 1e5) {
    return res.status(413).json({ error: "Code exceeds 100KB limit" });
  }
  const code = body.code;
  const output = [];
  const start = performance.now();
  try {
    const ts = await import("typescript");
    const transpiled = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        // vm.Script needs CJS
        esModuleInterop: true,
        removeComments: false,
        experimentalDecorators: true
      }
    });
    let jsCode = transpiled.outputText;
    const capturedConsole = {
      log: (...args) => output.push({ type: "log", args: serialize(args) }),
      error: (...args) => output.push({ type: "error", args: serialize(args) }),
      warn: (...args) => output.push({ type: "warn", args: serialize(args) }),
      info: (...args) => output.push({ type: "info", args: serialize(args) }),
      debug: (...args) => output.push({ type: "debug", args: serialize(args) })
    };
    const projectRoot = path.resolve(".");
    const sandboxRequire = (id) => {
      if (id === "effect" || id.startsWith("effect/")) {
        try {
          return require2(path.join(projectRoot, "packages/effect/node_modules", id));
        } catch {
          return require2(path.join(projectRoot, "node_modules", id));
        }
      }
      if (id.startsWith("@typesugar/")) {
        try {
          return require2(path.join(projectRoot, "node_modules", id));
        } catch {
          const parts = id.replace("@typesugar/", "").split("/");
          const pkgName = parts[0];
          const subpath = parts.slice(1).join("/");
          const pkgDir = path.join(projectRoot, "packages", pkgName);
          if (subpath) {
            try {
              return require2(path.join(pkgDir, subpath));
            } catch {
              try {
                return require2(path.join(pkgDir, "dist", subpath + ".cjs"));
              } catch {
                return require2(path.join(pkgDir, "dist", subpath));
              }
            }
          }
          return require2(pkgDir);
        }
      }
      const BLOCKED = [
        "fs",
        "child_process",
        "net",
        "http",
        "https",
        "dgram",
        "cluster",
        "worker_threads"
      ];
      if (BLOCKED.includes(id)) {
        throw new Error(`Module '${id}' is not available in the playground`);
      }
      return require2(id);
    };
    const sandbox = vm.createContext({
      console: capturedConsole,
      require: sandboxRequire,
      exports: {},
      module: { exports: {} },
      __filename: path.resolve("input.js"),
      __dirname: projectRoot,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      Error,
      TypeError,
      RangeError,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      RegExp,
      Proxy,
      Reflect,
      BigInt,
      process: {
        env: { NODE_ENV: "production" },
        // sanitized — only safe keys, no secrets
        version: process.version,
        platform: process.platform,
        cwd: () => path.resolve(".")
      },
      globalThis: void 0
      // prevent escape
    });
    const wrappedCode = `(async () => {
${jsCode}
})()`;
    const script = new vm.Script(wrappedCode, {
      filename: "input.js"
    });
    const resultPromise = script.runInContext(sandbox);
    await Promise.race([
      resultPromise,
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Execution timed out (5s limit)")), 5e3)
      )
    ]);
    const elapsed = Math.round(performance.now() - start);
    return res.status(200).json({ output, elapsed });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    output.push({ type: "error", args: [message] });
    return res.status(200).json({ output, error: message, elapsed });
  }
}
function serialize(args) {
  return args.map((arg) => {
    if (arg === void 0)
      return "[undefined]";
    if (arg === null)
      return null;
    if (typeof arg === "function")
      return `[Function: ${arg.name || "anonymous"}]`;
    if (typeof arg === "symbol")
      return arg.toString();
    if (typeof arg === "bigint")
      return arg.toString() + "n";
    if (arg instanceof Error)
      return { name: arg.name, message: arg.message, stack: arg.stack };
    if (typeof arg === "object") {
      try {
        return JSON.parse(JSON.stringify(arg));
      } catch {
        return String(arg);
      }
    }
    return arg;
  });
}
