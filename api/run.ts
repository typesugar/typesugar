/**
 * Server-side code execution endpoint.
 *
 * Runs transformed TypeScript code in a Node.js child process with access
 * to real node_modules (effect, @typesugar/*, etc.). Captures console output
 * and returns it to the playground.
 *
 * POST /api/run
 * { code: string, fileName?: string }
 *
 * Response: { output: Array<{type: string, args: any[]}>, error?: string, elapsed: number }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as vm from "vm";
import * as path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}
const limits = new Map<string, RateLimitEntry>();

function isAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = limits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    limits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 30) return false; // 30 runs/minute
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!isAllowed(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  const body = req.body;
  if (!body || typeof body.code !== "string") {
    return res.status(400).json({ error: "Body must include `code` string" });
  }

  if (body.code.length > 100_000) {
    return res.status(413).json({ error: "Code exceeds 100KB limit" });
  }

  const code: string = body.code;
  const output: Array<{ type: string; args: unknown[] }> = [];
  const start = performance.now();

  try {
    // Transpile TS → JS (strip type annotations)
    const ts = await import("typescript");
    const transpiled = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS, // vm.Script needs CJS
        esModuleInterop: true,
        removeComments: false,
        experimentalDecorators: true,
      },
    });
    let jsCode = transpiled.outputText;

    // Create a sandbox with captured console and require access
    const capturedConsole = {
      log: (...args: unknown[]) => output.push({ type: "log", args: serialize(args) }),
      error: (...args: unknown[]) => output.push({ type: "error", args: serialize(args) }),
      warn: (...args: unknown[]) => output.push({ type: "warn", args: serialize(args) }),
      info: (...args: unknown[]) => output.push({ type: "info", args: serialize(args) }),
      debug: (...args: unknown[]) => output.push({ type: "debug", args: serialize(args) }),
    };

    // Resolve modules from the project root
    const projectRoot = path.resolve(".");
    const sandboxRequire = (id: string): unknown => {
      // Allow effect, @typesugar/*, and Node.js built-ins
      if (id === "effect" || id.startsWith("effect/")) {
        // effect lives under packages/effect/node_modules due to pnpm
        try {
          return require(path.join(projectRoot, "packages/effect/node_modules", id));
        } catch {
          return require(path.join(projectRoot, "node_modules", id));
        }
      }
      if (id.startsWith("@typesugar/")) {
        // Try node_modules first (pnpm symlinks), then fall back to
        // packages/ directory directly for workspace packages without symlinks
        try {
          return require(path.join(projectRoot, "node_modules", id));
        } catch {
          // @typesugar/foo → packages/foo, @typesugar/foo/sub → packages/foo/dist/sub
          const parts = id.replace("@typesugar/", "").split("/");
          const pkgName = parts[0];
          const subpath = parts.slice(1).join("/");
          const pkgDir = path.join(projectRoot, "packages", pkgName);
          if (subpath) {
            // Try direct subpath first, then dist/ subpath (tsup output).
            // Prefer .cjs for CJS compatibility in the VM sandbox.
            try {
              return require(path.join(pkgDir, subpath));
            } catch {
              try {
                return require(path.join(pkgDir, "dist", subpath + ".cjs"));
              } catch {
                return require(path.join(pkgDir, "dist", subpath));
              }
            }
          }
          return require(pkgDir);
        }
      }
      // Block filesystem/network access
      const BLOCKED = [
        "fs",
        "child_process",
        "net",
        "http",
        "https",
        "dgram",
        "cluster",
        "worker_threads",
      ];
      if (BLOCKED.includes(id)) {
        throw new Error(`Module '${id}' is not available in the playground`);
      }
      return require(id);
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
        env: { NODE_ENV: "production" }, // sanitized — only safe keys, no secrets
        version: process.version,
        platform: process.platform,
        cwd: () => path.resolve("."),
      },
      globalThis: undefined as unknown, // prevent escape
    });

    // Wrap in async IIFE so top-level `await` works (e.g., await Effect.runPromise(...)).
    // Examples should use `await` instead of fire-and-forget `.then()` chains.
    const wrappedCode = `(async () => {\n${jsCode}\n})()`;
    const script = new vm.Script(wrappedCode, {
      filename: "input.js",
    });

    const resultPromise = script.runInContext(sandbox) as Promise<unknown>;

    // Wait for the async IIFE to complete, with a 5s timeout
    await Promise.race([
      resultPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Execution timed out (5s limit)")), 5000)
      ),
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

/** Safely serialize values for JSON transport */
function serialize(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg === undefined) return "[undefined]";
    if (arg === null) return null;
    if (typeof arg === "function") return `[Function: ${arg.name || "anonymous"}]`;
    if (typeof arg === "symbol") return arg.toString();
    if (typeof arg === "bigint") return arg.toString() + "n";
    if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
    if (typeof arg === "object") {
      try {
        // Handle circular references
        return JSON.parse(JSON.stringify(arg));
      } catch {
        return String(arg);
      }
    }
    return arg;
  });
}
