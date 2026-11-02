#!/usr/bin/env node
/**
 * Load every built Vercel function in .vercel/output/functions and exercise it
 * once, so a bundle that crashes at import time (or on its first request)
 * fails the build instead of shipping as a 500 in production.
 *
 * This exists because the functions were once bundled as CJS, which empties
 * `import.meta` — `createRequire(import.meta.url)` in api/run.ts and in the
 * transformer's ESM dist then threw on cold start and every API route 500'd
 * in production while the deploy reported success.
 *
 * Each function is loaded in its own child process (cwd = the .func dir, as
 * on Vercel) so one function's module state can't mask another's failure.
 *
 * Usage: node scripts/check-vercel-functions.mjs [outputDir]
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

const outputDir = resolve(process.argv[2] ?? ".vercel/output");
const functionsDir = join(outputDir, "functions/api");

if (!existsSync(functionsDir)) {
  console.error(`check-vercel-functions: no functions at ${functionsDir}`);
  process.exit(1);
}

/** One request per function: method + body, and what a healthy reply looks like. */
const PROBES = {
  compile: { method: "POST", body: { code: "export const x: number = 1 + 1;\n" }, status: 200 },
  ls: { method: "GET", body: undefined, status: undefined },
  run: { method: "POST", body: { code: "console.log(1)" }, status: 403 },
};

const funcs = readdirSync(functionsDir).filter((d) => d.endsWith(".func"));
if (funcs.length === 0) {
  console.error("check-vercel-functions: no .func directories found");
  process.exit(1);
}

let failed = 0;
for (const dir of funcs) {
  const name = dir.replace(/\.func$/, "");
  const funcDir = join(functionsDir, dir);
  const config = JSON.parse(readFileSync(join(funcDir, ".vc-config.json"), "utf8"));
  const entry = pathToFileURL(join(funcDir, config.handler)).href;
  const probe = PROBES[name] ?? { method: "GET", body: undefined, status: undefined };

  // The child imports the bundle, checks the default export, and drives one
  // request through a minimal VercelRequest/VercelResponse stand-in.
  const child = `
    const mod = await import(${JSON.stringify(entry)});
    const handler = mod.default?.default ?? mod.default;
    if (typeof handler !== "function") throw new Error("default export is not a function");
    const probe = ${JSON.stringify(probe)};
    const res = {
      statusCode: 0, body: undefined,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      send(b) { this.body = b; return this; },
      end(b) { this.body = b; return this; },
      setHeader() {},
    };
    const req = { method: probe.method, body: probe.body, headers: {}, query: {}, socket: {} };
    await handler(req, res);
    if (res.statusCode >= 500) throw new Error("handler replied " + res.statusCode + ": " + JSON.stringify(res.body));
    if (probe.status !== undefined && res.statusCode !== probe.status)
      throw new Error("expected status " + probe.status + ", got " + res.statusCode + ": " + JSON.stringify(res.body));
    console.log("status " + res.statusCode);
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
    cwd: funcDir,
    encoding: "utf8",
    timeout: 60_000,
  });
  // api/compile.ts logs this when a macro package's registration was lost
  // (e.g. a side-effect import tree-shaken away): it still answers 200, but
  // every macro from that package silently falls through to its runtime stub.
  if (r.status === 0 && /MACRO REGISTRATION ERROR/.test(r.stderr)) {
    failed++;
    console.error(`FAIL api/${name} (loads, but macros are missing)`);
    console.error(r.stderr.trim().split("\n").slice(0, 30).join("\n"));
  } else if (r.status === 0) {
    console.log(`ok   api/${name} (${r.stdout.trim().split("\n").pop()})`);
  } else {
    failed++;
    console.error(`FAIL api/${name}`);
    console.error(
      (r.stderr || r.stdout || String(r.error)).trim().split("\n").slice(0, 20).join("\n")
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${funcs.length} Vercel functions failed to load.`);
  process.exit(1);
}
console.log(`\nAll ${funcs.length} Vercel functions load and respond.`);
