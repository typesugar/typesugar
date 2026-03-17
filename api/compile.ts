import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { transformCode } from "@typesugar/transformer-core";
import { scanImportsForScope, globalResolutionScope } from "@typesugar/core";
import type { TransformDiagnostic } from "@typesugar/transformer-core";

// ---------------------------------------------------------------------------
// LRU Cache (server-side, in-memory, survives across warm invocations)
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
    // Move to end (most recently used)
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
// Rate Limiter (sliding window, per-IP, best-effort in serverless)
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
      // New window
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
      // If still too many, delete oldest entries
      if (this.limits.size > this.maxEntries) {
        const oldest = this.limits.keys().next().value;
        if (oldest) this.limits.delete(oldest);
      }
    }
  }
}

// 60 requests per minute per IP
const rateLimiter = new RateLimiter(60, 60_000);

// ---------------------------------------------------------------------------
// Content hashing (FNV-1a, fast and collision-resistant enough for a cache key)
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
// TypeScript lib file loading (cached at module level for warm reuse)
// ---------------------------------------------------------------------------

const LIB_DIR = path.join(path.dirname(require.resolve("typescript")));

const libFileCache = new Map<string, string>();

function readLibFile(fileName: string): string | undefined {
  const baseName = path.basename(fileName);
  const cached = libFileCache.get(baseName);
  if (cached !== undefined) return cached;

  const filePath = path.join(LIB_DIR, baseName);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    libFileCache.set(baseName, content);
    return content;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// @typesugar type stubs for virtual filesystem
// ---------------------------------------------------------------------------

const TYPESUGAR_STUBS: Record<string, string> = {};

function loadTypesugarStubs(): void {
  if (Object.keys(TYPESUGAR_STUBS).length > 0) return;

  // Provide minimal type declarations for `import { ... } from "typesugar"`
  // and common @typesugar/* packages. These give the type checker enough
  // information for the transformer to resolve types without loading the
  // full package trees.
  TYPESUGAR_STUBS["/node_modules/typesugar/index.d.ts"] = `
export function typeclass(name: string, options?: object): void;
export function typeclass(target: any, context?: ClassDecoratorContext): any;
export function instance<T>(desc: string, obj: T): T;
export function instance(...args: unknown[]): PropertyDecorator & ClassDecorator & MethodDecorator;
export const impl: typeof instance;
export function deriving(...typeclasses: unknown[]): ClassDecorator & PropertyDecorator;
export function summon<T>(): T;
export function extend<T>(value: T): T & Record<string, (...args: any[]) => any>;
export function implicit<T>(): T;
export function registerExtensions<T extends Record<string, Function>>(typeName: string, namespace: T): void;
export function registerExtension<F extends Function>(typeName: string, fn: F): void;
export function comptime<T>(fn: () => T): T;
export function comptime<T>(expr: T): T;
export function derive(...derives: unknown[]): ClassDecorator & PropertyDecorator & MethodDecorator;
export function operators(config?: Record<string, string>): ClassDecorator & PropertyDecorator & MethodDecorator;
export function ops<T>(expr: T): T;
export function pipe<T, R>(value: T, ...fns: Function[]): R;
export function compose<T extends Function[]>(...fns: T): Function;
export function flow(...fns: Array<(...args: unknown[]) => unknown>): (...args: unknown[]) => unknown;
export function specialize<T extends Function>(fn: T, dicts?: unknown[]): T;
export function reflect(target: any, context?: ClassDecoratorContext): any;
export function typeInfo<T>(): { name: string; fields: Array<{ name: string; type: string }> };
export function fieldNames<T>(): string[];
export function validator<T>(): (value: unknown) => value is T;
export function cfg<T>(condition: string, ifTrue: T, ifFalse: T): T;
export function includeStr(path: string): string;
export function includeJson<T = unknown>(path: string): T;
export function staticAssert(condition: boolean, message: string): void;
export function tailrec(target: any, context?: ClassMethodDecoratorContext): any;
export function hkt(target: any, context?: ClassDecoratorContext): any;
export function registerOperators(config: Record<string, string>): void;
export function getOperatorMethod(op: string): string | undefined;
export function getOperatorString(method: string): string | undefined;
export function clearOperatorMappings(): void;
export const Eq: unique symbol;
export const Ord: unique symbol;
export const Clone: unique symbol;
export const Debug: unique symbol;
export const Hash: unique symbol;
export const Default: unique symbol;
export const Json: unique symbol;
export const Builder: unique symbol;
export const TypeGuard: unique symbol;
`;

  TYPESUGAR_STUBS["/node_modules/@typesugar/macros/index.d.ts"] =
    TYPESUGAR_STUBS["/node_modules/typesugar/index.d.ts"];

  TYPESUGAR_STUBS["/node_modules/@typesugar/core/index.d.ts"] = `
export * from "typesugar";
`;

  TYPESUGAR_STUBS["/node_modules/@typesugar/typeclass/index.d.ts"] = `
export { typeclass, instance, deriving, summon, extend, implicit } from "typesugar";
`;

  TYPESUGAR_STUBS["/node_modules/@typesugar/std/index.d.ts"] = `
export {};
`;
}

// ---------------------------------------------------------------------------
// Enhanced compiler host with real lib files + typesugar stubs
// ---------------------------------------------------------------------------

function getScriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx") || fileName.endsWith(".stsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function createServerCompilerHost(
  code: string,
  fileName: string,
  options: ts.CompilerOptions
): ts.CompilerHost {
  loadTypesugarStubs();

  const allFiles = new Map<string, string>();
  allFiles.set(fileName, code);
  for (const [path, content] of Object.entries(TYPESUGAR_STUBS)) {
    allFiles.set(path, content);
  }

  return {
    getSourceFile(
      requestedFileName: string,
      languageVersion: ts.ScriptTarget
    ): ts.SourceFile | undefined {
      // User code
      if (requestedFileName === fileName) {
        return ts.createSourceFile(
          requestedFileName,
          code,
          languageVersion,
          true,
          getScriptKind(fileName)
        );
      }

      // @typesugar stubs
      const stub = allFiles.get(requestedFileName);
      if (stub !== undefined) {
        return ts.createSourceFile(requestedFileName, stub, languageVersion, true);
      }

      // Real lib files from node_modules/typescript/lib/
      if (requestedFileName.includes("lib.") && requestedFileName.endsWith(".d.ts")) {
        const content = readLibFile(requestedFileName);
        if (content !== undefined) {
          return ts.createSourceFile(requestedFileName, content, languageVersion, true);
        }
        // Graceful fallback: empty lib file rather than undefined
        return ts.createSourceFile(requestedFileName, "", languageVersion, true);
      }

      return undefined;
    },

    getDefaultLibFileName: (opts) => "/" + ts.getDefaultLibFileName(opts),

    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],

    fileExists: (f: string) =>
      f === fileName || allFiles.has(f) || (f.includes("lib.") && f.endsWith(".d.ts")),

    readFile: (f: string) => {
      if (f === fileName) return code;
      const stub = allFiles.get(f);
      if (stub !== undefined) return stub;
      if (f.includes("lib.") && f.endsWith(".d.ts")) return readLibFile(f);
      return undefined;
    },

    getCanonicalFileName: (f: string) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",

    resolveModuleNames(
      moduleNames: string[],
      containingFile: string
    ): (ts.ResolvedModule | undefined)[] {
      return moduleNames.map((name) => {
        if (name === "typesugar") {
          return {
            resolvedFileName: "/node_modules/typesugar/index.d.ts",
            isExternalLibraryImport: true,
          };
        }
        if (name.startsWith("@typesugar/")) {
          const pkg = name.replace("@typesugar/", "");
          const resolved = `/node_modules/@typesugar/${pkg}/index.d.ts`;
          if (allFiles.has(resolved)) {
            return {
              resolvedFileName: resolved,
              isExternalLibraryImport: true,
            };
          }
        }
        return undefined;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Compiler options for the server
// ---------------------------------------------------------------------------

const SERVER_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  strict: false,
  noImplicitAny: false,
  strictNullChecks: false,
  experimentalDecorators: true,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
};

// ---------------------------------------------------------------------------
// Main compile function
// ---------------------------------------------------------------------------

interface CompileResult {
  code: string;
  diagnostics: TransformDiagnostic[];
  changed: boolean;
  cached: boolean;
}

function compile(code: string, fileName: string): CompileResult {
  const cacheKey = hashContent(code + "\0" + fileName);

  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const host = createServerCompilerHost(code, fileName, SERVER_COMPILER_OPTIONS);

  // Build a program with the user file + typesugar stubs
  const rootFiles = [fileName];
  const program = ts.createProgram(rootFiles, SERVER_COMPILER_OPTIONS, host);

  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile) {
    // Critical: scan imports to register typeclasses in scope.
    // This is what the full transformer does but transformCode() skips.
    globalResolutionScope.reset();
    scanImportsForScope(sourceFile, globalResolutionScope);
  }

  const result = transformCode(code, {
    fileName,
    program,
    compilerOptions: SERVER_COMPILER_OPTIONS,
  });

  const entry: CacheEntry = {
    code: result.code,
    diagnostics: result.diagnostics,
    changed: result.changed,
  };
  cache.set(cacheKey, entry);

  return { ...entry, cached: false };
}

// ---------------------------------------------------------------------------
// Vercel serverless handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Keep-warm ping
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).json({ status: "warm", cacheSize: cache.size });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limiting
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!rateLimiter.isAllowed(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
  }

  // Input validation
  const body = req.body;
  if (!body || typeof body.code !== "string") {
    return res.status(400).json({ error: "Request body must include a `code` string" });
  }

  if (body.code.length > 100_000) {
    return res.status(413).json({ error: "Code exceeds 100KB limit" });
  }

  const code: string = body.code;
  const fileName: string = typeof body.fileName === "string" ? body.fileName : "input.ts";

  // Empty code is a keep-warm ping
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
    const result = compile(code, fileName);
    const elapsed = Math.round(performance.now() - start);

    // Logging for monitoring
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
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);

    // Error logging for monitoring
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
