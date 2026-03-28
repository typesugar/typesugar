import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as ts from "typescript";
import * as path from "path";
import { transformCode, type TransformDiagnostic } from "@typesugar/transformer";
import { AMBIENT_DECLARATIONS } from "./playground-declarations.js";
import { registerTypeRewrite, globalRegistry, type MethodInlinePattern } from "@typesugar/core";

// Force-load ALL macro packages that register via side effects.
// Every @typesugar/* package that calls globalRegistry.register() MUST be listed
// here. If you add a new package with macros, add it here too — otherwise the
// playground will silently fall through to runtime fallbacks.
//
// IMPORTANT: Each of these packages must externalize @typesugar/core (and
// @typesugar/macros if they import it) in their tsup.config.ts so they share
// the same globalRegistry and instanceRegistry.
import "@typesugar/std";
import "@typesugar/fp";
import "@typesugar/graph";
import "@typesugar/parser";
import "@typesugar/strings";
import "@typesugar/symbolic";
import "@typesugar/testing/macros";
import "@typesugar/erased";
import "@typesugar/effect";
import "@typesugar/type-system";
import "@typesugar/contracts";
import "@typesugar/codec";
import "@typesugar/mapper";
import "@typesugar/fusion";
import "@typesugar/hlist";
import "@typesugar/units";
import "@typesugar/sql";

// ---------------------------------------------------------------------------
// Macro registration validation
// ---------------------------------------------------------------------------
// Fail loudly at startup if expected macros aren't registered, rather than
// silently falling through to runtime fallbacks at execution time.

const EXPECTED_MACROS: ReadonlyArray<{ name: string; from: string }> = [
  // @typesugar/testing
  { name: "assert", from: "@typesugar/testing" },
  { name: "typeAssert", from: "@typesugar/testing" },
  { name: "assertType", from: "@typesugar/testing" },
  { name: "forAll", from: "@typesugar/testing" },
  { name: "assertSnapshot", from: "@typesugar/testing" },
  // @typesugar/std
  { name: "match", from: "@typesugar/std" },
  { name: "letYield", from: "@typesugar/std" },
  { name: "parYield", from: "@typesugar/std" },
  // @typesugar/macros (loaded by transformer)
  { name: "comptime", from: "typesugar" },
  { name: "staticAssert", from: "typesugar" },
  { name: "typeclass", from: "typesugar" },
  { name: "typeInfo", from: "typesugar" },
  // Package-specific macros
  { name: "erased", from: "@typesugar/erased" },
  { name: "grammar", from: "@typesugar/parser" },
  { name: "transformInto", from: "@typesugar/mapper" },
  { name: "lazy", from: "@typesugar/fusion" },
  { name: "units", from: "@typesugar/units" },
  { name: "sql", from: "@typesugar/sql" },
];

{
  const registered = new Set(globalRegistry.getAll().map((m) => m.name));
  const missing = EXPECTED_MACROS.filter((m) => !registered.has(m.name));
  if (missing.length > 0) {
    const list = missing.map((m) => `  - ${m.name} (from ${m.from})`).join("\n");
    console.error(
      `[typesugar] MACRO REGISTRATION ERROR: ${missing.length} expected macros are NOT registered.\n` +
        `This means the transformer will silently skip these macros and runtime fallbacks will run instead.\n\n` +
        `Missing macros:\n${list}\n\n` +
        `Fix: ensure the owning package is imported in api/compile.ts and externalizes @typesugar/core in tsup.config.ts`
    );
  } else {
    console.log(`[typesugar] All ${EXPECTED_MACROS.length} expected macros registered OK`);
  }
}

// ---------------------------------------------------------------------------
// Virtual ambient declarations file
// ---------------------------------------------------------------------------

const AMBIENT_FILE = path.resolve("__playground_ambient__.d.ts");

// ---------------------------------------------------------------------------
// Pre-populate the type rewrite registry for @opaque types.
//
// The @opaque macro normally fires when compiling @typesugar/fp's source,
// but in single-file playground compilation those sources are never compiled.
// We register the entries manually so the transformer can erase constructors
// and rewrite dot-syntax method calls to standalone functions.
// ---------------------------------------------------------------------------

function methodMap(names: string[]): ReadonlyMap<string, string> {
  return new Map(names.map((n) => [n, n]));
}

const OPTION_INLINES: ReadonlyMap<string, MethodInlinePattern> = new Map<
  string,
  MethodInlinePattern
>([
  ["map", { kind: "null-check-apply" }],
  ["flatMap", { kind: "null-check-apply" }],
  ["filter", { kind: "null-check-predicate" }],
  ["filterNot", { kind: "null-check-predicate" }],
  ["getOrElse", { kind: "null-coalesce-call" }],
  ["orElse", { kind: "null-coalesce-call" }],
  ["getOrElseStrict", { kind: "null-coalesce-value" }],
  ["fold", { kind: "fold" }],
]);

registerTypeRewrite({
  typeName: "Option",
  underlyingTypeText: "A | null",
  sourceModule: "@typesugar/fp/data/option",
  methods: methodMap([
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
  ]),
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

// ---------------------------------------------------------------------------
// LRU Cache (survives across warm Vercel invocations)
// ---------------------------------------------------------------------------

interface CacheEntry {
  code: string;
  diagnostics: TransformDiagnostic[];
  changed: boolean;
}

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, entry);
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

const cache = new LRUCache(200);

// ---------------------------------------------------------------------------
// Rate Limiter (sliding window, per-IP)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;
  private maxEntries: number;

  constructor(maxRequests: number, windowMs: number, maxEntries = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  isAllowed(ip: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(ip);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.limits.set(ip, { count: 1, windowStart: now });
      this.cleanup();
      return true;
    }

    if (entry.count >= this.maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  private cleanup(): void {
    if (this.limits.size > this.maxEntries) {
      const now = Date.now();
      for (const [ip, entry] of this.limits) {
        if (now - entry.windowStart > this.windowMs) {
          this.limits.delete(ip);
        }
      }
      if (this.limits.size > this.maxEntries) {
        const oldest = this.limits.keys().next().value;
        if (oldest) this.limits.delete(oldest);
      }
    }
  }
}

const rateLimiter = new RateLimiter(60, 60_000);

// ---------------------------------------------------------------------------
// Content hashing (FNV-1a)
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Incremental strict output typecheck
//
// The built-in typecheckOutput() in transformCode creates a fresh
// ts.createProgram() per call (~200ms). Instead, we call transformCode
// WITHOUT strictOutput and run our own incremental typecheck here:
// a persistent compiler host + oldProgram gives ts.createProgram ~46%
// faster incremental rebuilds by reusing unchanged ASTs (ambient decls,
// lib.d.ts).
// ---------------------------------------------------------------------------

const STRICT_OPTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  strict: false,
  strictNullChecks: false,
  noImplicitAny: false,
  noEmit: true,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
  types: [],
  typeRoots: [],
};

/** Persistent host — reused across calls so lib.d.ts resolution is cached. */
const strictHost = ts.createCompilerHost(STRICT_OPTS);
const _origStrictRead = strictHost.readFile.bind(strictHost);
const _origStrictExists = strictHost.fileExists.bind(strictHost);

/** Mutable virtual file contents for the current typecheck. */
let _strictFiles = new Map<string, string>();
let _strictKnown = new Set<string>();

strictHost.readFile = (f) => {
  const v = _strictFiles.get(f);
  if (v !== undefined) return v;
  if (_strictKnown.has(f)) {
    if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
    return ts.sys.readFile(f);
  }
  if (f.includes("lib.") && f.endsWith(".d.ts")) return _origStrictRead(f);
  return ts.sys.readFile(f);
};
strictHost.fileExists = (f) => {
  if (_strictKnown.has(f)) return true;
  if (f.includes("lib.") && f.endsWith(".d.ts")) return _origStrictExists(f);
  return ts.sys.fileExists(f);
};

/** Previous program — passed to ts.createProgram for structural reuse. */
let _strictOldProgram: ts.Program | undefined;

function typecheckOutput(
  outputCode: string,
  inputCode: string,
  fileName: string
): TransformDiagnostic[] {
  const inputFileName = fileName.replace(/\.(ts|tsx|sts|stsx)$/, ".__input__.$1");

  _strictFiles = new Map([
    [fileName, outputCode],
    [inputFileName, inputCode],
  ]);
  _strictKnown = new Set([fileName, inputFileName, AMBIENT_FILE]);

  const rootFiles = [fileName, inputFileName, AMBIENT_FILE];
  const program = ts.createProgram(rootFiles, STRICT_OPTS, strictHost, _strictOldProgram);
  _strictOldProgram = program;

  function getDiags(target: string) {
    const sf = program.getSourceFile(target);
    if (!sf)
      return {
        msgs: new Set<string>(),
        diags: [] as { msg: string; start: number; length: number }[],
      };
    const raw = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    const msgs = new Set<string>();
    const diags: { msg: string; start: number; length: number }[] = [];
    for (const d of raw) {
      const msg = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
      msgs.add(msg);
      diags.push({ msg, start: d.start ?? 0, length: d.length ?? 0 });
    }
    return { msgs, diags };
  }

  const { diags: outputDiags } = getDiags(fileName);
  if (outputDiags.length === 0) return [];

  const { msgs: inputMsgs } = getDiags(inputFileName);
  return outputDiags
    .filter((d) => !inputMsgs.has(d.msg))
    .map((d) => ({
      file: fileName,
      start: d.start,
      length: d.length,
      message: `[strictOutput] ${d.msg}`,
      severity: "warning" as const,
    }));
}

// ---------------------------------------------------------------------------
// Compile: transform + optional strictOutput typecheck
// ---------------------------------------------------------------------------

interface CompileResult {
  code: string;
  diagnostics: TransformDiagnostic[];
  changed: boolean;
  cached: boolean;
  sourceMap?: unknown; // RawSourceMap — sent to client for position mapping
}

function compile(code: string, fileName: string, strict: boolean): CompileResult {
  const cacheKey = hashContent(code + "\0" + fileName + "\0" + (strict ? "strict" : "fast"));

  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const resolvedFileName = path.resolve(fileName);
  const result = transformCode(code, {
    fileName,
    extraRootFiles: [AMBIENT_FILE],
    strictOutput: false,
    preserveBlankLines: true,
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });

  // Only run the expensive strictOutput typecheck when requested
  if (strict && result.changed) {
    const strictDiags = typecheckOutput(result.code, code, resolvedFileName);
    if (strictDiags.length > 0) {
      result.diagnostics = [...result.diagnostics, ...strictDiags];
    }
  }

  const entry: CacheEntry = {
    code: result.code,
    diagnostics: result.diagnostics,
    changed: result.changed,
  };
  cache.set(cacheKey, entry);

  return { ...entry, cached: false, sourceMap: result.sourceMap ?? undefined };
}

// ---------------------------------------------------------------------------
// Vercel serverless handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).json({ status: "warm", cacheSize: cache.size });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!rateLimiter.isAllowed(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
  }

  const body = req.body;
  if (!body || typeof body.code !== "string") {
    return res.status(400).json({ error: "Request body must include a `code` string" });
  }

  if (body.code.length > 100_000) {
    return res.status(413).json({ error: "Code exceeds 100KB limit" });
  }

  const code: string = body.code;
  const fileName: string = typeof body.fileName === "string" ? body.fileName : "input.ts";
  const strict: boolean = body.strict === true;

  if (code.trim() === "") {
    return res.status(200).json({
      code: "",
      diagnostics: [],
      changed: false,
      cached: false,
    });
  }

  const start = performance.now();

  try {
    const result = compile(code, fileName, strict);
    const elapsed = Math.round(performance.now() - start);

    console.log(
      JSON.stringify({
        type: "compile",
        fileName,
        codeLength: code.length,
        elapsed,
        cached: result.cached,
        changed: result.changed,
        diagnosticCount: result.diagnostics.length,
      })
    );

    res.setHeader("X-Compile-Time-Ms", String(elapsed));
    res.setHeader("X-Compile-Cached", result.cached ? "true" : "false");
    res.setHeader("Cache-Control", "no-cache");

    return res.status(200).json({
      code: result.code,
      diagnostics: result.diagnostics,
      changed: result.changed,
      cached: result.cached,
      compileTimeMs: elapsed,
      sourceMap: result.sourceMap,
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);

    console.error(
      JSON.stringify({
        type: "compile_error",
        fileName,
        codeLength: code.length,
        elapsed,
        error: message,
      })
    );

    return res.status(500).json({
      error: "Compilation failed",
      message,
    });
  }
}
