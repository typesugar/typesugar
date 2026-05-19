/**
 * Live playground execution test — mirrors the exact pipeline of
 * `api/compile.ts` + `api/run.ts` so any breakage in the real /playground
 * browser flow shows up here.
 *
 * This is complementary to `playground-examples.test.ts`:
 * - `playground-examples.test.ts` uses a custom `transpileToJS` (ESNext +
 *   import rewrite) with a hand-built module registry. That path caught the
 *   compile-time macro failures we fixed in Wave 6, but it does NOT mirror
 *   the server's CommonJS + `sandboxRequire` pipeline, so runtime issues
 *   that only surface through `ts.ModuleKind.CommonJS` (e.g., strict-mode
 *   reserved-word parse errors in the transpiled JS, top-level `await`
 *   handling) were silently passing.
 * - This file uses the **exact** transpile options and sandbox shape of
 *   `api/run.ts`, so it will fail if a playground example breaks in the
 *   real browser flow. If either pipeline ever diverges again, keep them
 *   in sync.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import { registerTypeRewrite, type MethodInlinePattern } from "@typesugar/core";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as ts from "typescript";
import { createRequire } from "module";

// Force-load ALL macro packages via side-effect imports — same as api/compile.ts.
import "@typesugar/macros";
import "@typesugar/std";
import "@typesugar/fp";
import "@typesugar/effect";

// Mirror `api/compile.ts`'s Option type rewrite registration. Without this the
// zero-cost Some/None inlining doesn't fire and `Some(x).map(...)` leaves
// behind real method calls that blow up at runtime (since `Some(x)` is just
// the value `x`, not a wrapper). Any future constructor/method rewrites added
// to api/compile.ts must be mirrored here or this test will drift out of
// sync with the browser playground.
const OPTION_INLINES: ReadonlyMap<string, MethodInlinePattern> = new Map([
  ["map", { kind: "null-check-apply" }],
  ["flatMap", { kind: "null-check-apply" }],
  ["filter", { kind: "null-check-predicate" }],
  ["filterNot", { kind: "null-check-predicate" }],
  ["getOrElse", { kind: "null-coalesce-call" }],
  ["orElse", { kind: "null-coalesce-call" }],
  ["getOrElseStrict", { kind: "null-coalesce-value" }],
  ["fold", { kind: "fold" }],
] as [string, MethodInlinePattern][]);

registerTypeRewrite({
  typeName: "Option",
  underlyingTypeText: "A | null",
  sourceModule: "@typesugar/fp/data/option",
  methods: new Map(
    [
      "map",
      "flatMap",
      "fold",
      "match",
      "getOrElse",
      "getOrElseStrict",
      "getOrThrow",
      "orElse",
      "filter",
      "filterNot",
      "exists",
      "forall",
      "contains",
      "tap",
      "toArray",
      "toNullable",
      "toUndefined",
      "zip",
    ].map((n) => [n, n])
  ),
  methodInlines: OPTION_INLINES,
  constructors: new Map([
    ["Some", { kind: "identity" }],
    ["None", { kind: "constant", value: "null" }],
    ["of", { kind: "identity" }],
    ["some", { kind: "identity" }],
    ["none", { kind: "constant", value: "null" }],
    ["fromNullable", { kind: "identity" }],
  ]),
  transparent: true,
});

const nodeRequire = createRequire(import.meta.url);

const EXAMPLES_ROOT = path.resolve(__dirname, "..", "docs", "examples");

function collectExamples(dir: string): Array<{ rel: string; full: string }> {
  const out: Array<{ rel: string; full: string }> = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      out.push(...collectExamples(full));
    } else if (/\.s?tsx?$/.test(name)) {
      out.push({ rel: path.relative(EXAMPLES_ROOT, full), full });
    }
  }
  return out;
}

/**
 * Mirror of `api/run.ts`'s `sandboxRequire`. Resolves `effect`, `@typesugar/*`,
 * and Node built-ins the same way the server does.
 */
function makeSandboxRequire(): (id: string) => unknown {
  const projectRoot = path.resolve(__dirname, "..");
  return function sandboxRequire(id: string): unknown {
    if (id === "effect" || id.startsWith("effect/")) {
      try {
        return nodeRequire(path.join(projectRoot, "packages/effect/node_modules", id));
      } catch {
        return nodeRequire(path.join(projectRoot, "node_modules", id));
      }
    }
    if (id.startsWith("@typesugar/")) {
      try {
        return nodeRequire(path.join(projectRoot, "node_modules", id));
      } catch {
        const parts = id.replace("@typesugar/", "").split("/");
        const pkgName = parts[0];
        const subpath = parts.slice(1).join("/");
        const pkgDir = path.join(projectRoot, "packages", pkgName);
        if (subpath) {
          try {
            return nodeRequire(path.join(pkgDir, subpath));
          } catch {
            try {
              return nodeRequire(path.join(pkgDir, "dist", subpath + ".cjs"));
            } catch {
              return nodeRequire(path.join(pkgDir, "dist", subpath));
            }
          }
        }
        return nodeRequire(pkgDir);
      }
    }
    const BLOCKED = new Set([
      "fs",
      "child_process",
      "net",
      "http",
      "https",
      "dgram",
      "cluster",
      "worker_threads",
    ]);
    if (BLOCKED.has(id)) {
      throw new Error(`Module '${id}' is not available in the playground`);
    }
    return nodeRequire(id);
  };
}

const examples = collectExamples(EXAMPLES_ROOT).sort((a, b) => a.rel.localeCompare(b.rel));

describe("playground examples via api/compile + api/run pipeline", () => {
  const sandboxRequire = makeSandboxRequire();

  for (const ex of examples) {
    it(
      ex.rel,
      async () => {
        const source = fs.readFileSync(ex.full, "utf8");

        // 1. Compile via the same code path api/compile.ts uses.
        const compile = transformCode(source, {
          fileName: ex.full,
          strictOutput: false,
        });
        const errors = (compile.diagnostics ?? []).filter((d) => d.severity === "error");
        expect(errors, `compile errors in ${ex.rel}: ${JSON.stringify(errors)}`).toEqual([]);

        // 2. Transpile TS → CJS JS with the EXACT options from api/run.ts.
        const { outputText: jsCode } = ts.transpileModule(compile.code, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
            removeComments: false,
            experimentalDecorators: true,
          },
        });

        // 3. Execute in a vm sandbox whose shape matches api/run.ts.
        const output: Array<{ type: string; args: unknown[] }> = [];
        const capturedConsole = {
          log: (...args: unknown[]) => output.push({ type: "log", args }),
          error: (...args: unknown[]) => output.push({ type: "error", args }),
          warn: (...args: unknown[]) => output.push({ type: "warn", args }),
          info: (...args: unknown[]) => output.push({ type: "info", args }),
          debug: (...args: unknown[]) => output.push({ type: "debug", args }),
        };
        const sandbox = vm.createContext({
          console: capturedConsole,
          require: sandboxRequire,
          exports: {},
          module: { exports: {} },
          __filename: path.resolve("input.js"),
          __dirname: path.resolve(__dirname, ".."),
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
          process: { env: { NODE_ENV: "production" }, version: process.version },
        });

        const wrappedCode = `(async () => {\n${jsCode}\n})()`;
        const script = new vm.Script(wrappedCode, { filename: ex.rel });
        const resultPromise = script.runInContext(sandbox) as Promise<unknown>;
        await Promise.race([
          resultPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Execution timed out")), 10_000)
          ),
        ]);

        // 4. The playground's "Errors panel" surfaces any console.error and
        //    any uncaught exceptions (which would already have thrown above).
        //    Flag any errors here so a red-dot regression in the browser
        //    playground is caught by CI.
        const runtimeErrors = output.filter((o) => o.type === "error");
        expect(
          runtimeErrors,
          `runtime console.error in ${ex.rel}: ${JSON.stringify(runtimeErrors)}`
        ).toEqual([]);

        // 5. At least one visible log line — mirrors the playground's
        //    "expect output in the Run panel" contract.
        const logs = output.filter((o) => o.type === "log" || o.type === "info");
        expect(logs.length, `${ex.rel}: no console.log output`).toBeGreaterThan(0);
      },
      15_000
    );
  }
});
