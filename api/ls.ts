/**
 * Server-side TypeScript Language Service endpoint.
 *
 * Replaces the browser Web Worker with a Vercel serverless function that has
 * access to real node_modules. This means no type stubs — the TS language
 * service resolves Effect, @typesugar/*, and all other types from the real
 * .d.ts files on disk.
 *
 * Protocol:
 *   POST /api/ls
 *   {
 *     method: "getDiagnostics" | "getCompletions" | "getQuickInfo" | "getDefinition" | "getSignatureHelp",
 *     code: string,         // transformed code (from /api/compile response)
 *     fileName: string,
 *     position?: number,    // for position-based queries
 *     sourceMap?: object,   // for diagnostic position filtering
 *     original?: string,    // original source (for diagnostic filtering)
 *   }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as ts from "typescript";
import * as path from "path";
import { createPositionMapperCore, type PositionMapperCore } from "@typesugar/transformer-core";

// ---------------------------------------------------------------------------
// Persistent Language Service (survives across warm Vercel invocations)
// ---------------------------------------------------------------------------

interface VirtualFile {
  content: string;
  version: number;
}

const files = new Map<string, VirtualFile>();
const INPUT_FILE = path.resolve("input.ts");

function setFile(name: string, content: string): void {
  const resolved = path.resolve(name);
  const existing = files.get(resolved);
  if (existing) {
    if (existing.content === content) return; // no change
    existing.content = content;
    existing.version++;
  } else {
    files.set(resolved, { content, version: 1 });
  }
}

// pnpm doesn't hoist peer deps — effect lives under packages/effect/node_modules
const EXTRA_NODE_MODULES = [
  path.resolve("packages/effect/node_modules"),
  path.resolve("node_modules"),
];

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  strict: false,
  noImplicitAny: false,
  noEmit: true,
  allowJs: true,
  jsx: ts.JsxEmit.React,
  experimentalDecorators: true,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
};

const defaultHost = ts.createCompilerHost(compilerOptions);

const lsHost: ts.LanguageServiceHost = {
  getScriptFileNames: () => [INPUT_FILE],
  getScriptVersion: (fileName) => {
    const file = files.get(fileName);
    return file ? String(file.version) : "0";
  },
  getScriptSnapshot: (fileName) => {
    const file = files.get(fileName);
    if (file) return ts.ScriptSnapshot.fromString(file.content);
    // Fall through to real filesystem for node_modules types
    const content = ts.sys.readFile(fileName);
    if (content !== undefined) return ts.ScriptSnapshot.fromString(content);
    return undefined;
  },
  getCurrentDirectory: () => path.resolve("."),
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: (options) => defaultHost.getDefaultLibFileName(options),
  fileExists: (fileName) => {
    if (files.has(fileName)) return true;
    return ts.sys.fileExists(fileName);
  },
  readFile: (fileName) => {
    const file = files.get(fileName);
    if (file) return file.content;
    return ts.sys.readFile(fileName);
  },
  getDirectories: (dirPath) => ts.sys.getDirectories(dirPath),
  directoryExists: (dirPath) => ts.sys.directoryExists(dirPath),

  // Real module resolution with pnpm support
  resolveModuleNames: (moduleNames, containingFile) => {
    return moduleNames.map((name): ts.ResolvedModule | undefined => {
      // Default resolution first
      const result = ts.resolveModuleName(name, containingFile, compilerOptions, ts.sys);
      if (result.resolvedModule) return result.resolvedModule;

      // Try extra node_modules dirs (pnpm peer deps)
      for (const dir of EXTRA_NODE_MODULES) {
        const candidate = path.join(dir, name);
        const pkgJson = path.join(candidate, "package.json");
        if (ts.sys.fileExists(pkgJson)) {
          try {
            const pkg = JSON.parse(ts.sys.readFile(pkgJson) ?? "{}");
            const types = pkg.types ?? pkg.typings ?? "index.d.ts";
            const resolvedFileName = path.resolve(candidate, types);
            if (ts.sys.fileExists(resolvedFileName)) {
              return { resolvedFileName, isExternalLibraryImport: true };
            }
          } catch {
            /* skip */
          }
        }
      }
      return undefined;
    });
  },
};

const documentRegistry = ts.createDocumentRegistry();
const ls = ts.createLanguageService(lsHost, documentRegistry);

// ---------------------------------------------------------------------------
// Diagnostic serialization + filtering
// ---------------------------------------------------------------------------

interface SerializedDiagnostic {
  start: number;
  length: number;
  messageText: string;
  category: number;
  code: number;
}

function serializeDiagnostic(d: ts.Diagnostic): SerializedDiagnostic {
  return {
    start: d.start ?? 0,
    length: d.length ?? 0,
    messageText: typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
    category: d.category,
    code: d.code,
  };
}

// TS error codes that are almost always false positives from macro expansions
const SUPPRESSED_CODES = new Set([
  2304, // Cannot find name 'x' — match/do-notation bindings
  2552, // Cannot find name 'x'. Did you mean 'y'? — same
  2503, // Cannot find namespace — macro-generated references
]);

function filterDiagnostics(
  diags: readonly ts.Diagnostic[],
  mapper: PositionMapperCore | null
): SerializedDiagnostic[] {
  const result: SerializedDiagnostic[] = [];
  for (const d of diags) {
    if (SUPPRESSED_CODES.has(d.code)) continue;
    // Suppress diagnostics in macro-generated code
    if (mapper && d.start !== undefined) {
      const origPos = mapper.toOriginal(d.start);
      if (origPos === null) continue;
    }
    result.push(serializeDiagnostic(d));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

function handleMethod(
  method: string,
  code: string,
  fileName: string,
  position: number | undefined,
  mapper: PositionMapperCore | null
): unknown {
  // Update the virtual file
  setFile(fileName, code);
  const resolved = path.resolve(fileName);

  switch (method) {
    case "getDiagnostics": {
      const syntactic = ls.getSyntacticDiagnostics(resolved);
      const semantic = ls.getSemanticDiagnostics(resolved);
      return filterDiagnostics([...syntactic, ...semantic], mapper);
    }

    case "getCompletions": {
      if (position === undefined) return null;
      const result = ls.getCompletionsAtPosition(resolved, position, {
        includeCompletionsForModuleExports: false,
        includeCompletionsWithInsertText: true,
      });
      if (!result) return null;
      return {
        isGlobalCompletion: result.isGlobalCompletion,
        isMemberCompletion: result.isMemberCompletion,
        entries: result.entries.map((e) => ({
          name: e.name,
          kind: e.kind,
          sortText: e.sortText,
          insertText: e.insertText,
          isRecommended: e.isRecommended,
        })),
      };
    }

    case "getQuickInfo": {
      if (position === undefined) return null;
      const info = ls.getQuickInfoAtPosition(resolved, position);
      if (!info) return null;
      return {
        kind: info.kind,
        textSpan: info.textSpan,
        displayParts: (info.displayParts ?? []).map((p) => p.text).join(""),
        documentation: (info.documentation ?? []).map((p) => p.text).join(""),
      };
    }

    case "getDefinition": {
      if (position === undefined) return null;
      const defs = ls.getDefinitionAtPosition(resolved, position);
      if (!defs) return null;
      return defs
        .filter((d) => d.fileName === resolved)
        .map((d) => ({ textSpan: d.textSpan, fileName: d.fileName }));
    }

    case "getSignatureHelp": {
      if (position === undefined) return null;
      const help = ls.getSignatureHelpItems(resolved, position, {});
      if (!help) return null;
      return {
        selectedItemIndex: help.selectedItemIndex,
        argumentIndex: help.argumentIndex,
        items: help.items.map((item) => ({
          label: [...(item.prefixDisplayParts ?? []), ...(item.suffixDisplayParts ?? [])]
            .map((p) => p.text)
            .join(""),
          parameters: item.parameters.map((p) => ({
            label: p.displayParts.map((dp) => dp.text).join(""),
            documentation: (p.documentation ?? []).map((dp) => dp.text).join(""),
          })),
          documentation: (item.documentation ?? []).map((p) => p.text).join(""),
        })),
      };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Rate limiter (reuse pattern from compile.ts)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}
const limits = new Map<string, RateLimitEntry>();
const RATE_WINDOW = 60_000;
const RATE_MAX = 300; // higher than compile — LS gets called more frequently

function isAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = limits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    limits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", service: "language-service" });
  }

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
  if (!body || typeof body.method !== "string" || typeof body.code !== "string") {
    return res.status(400).json({
      error: "Body must include `method` (string) and `code` (string)",
    });
  }

  const {
    method,
    code,
    fileName = "input.ts",
    position,
    sourceMap,
    original,
  } = body as {
    method: string;
    code: string;
    fileName?: string;
    position?: number;
    sourceMap?: unknown;
    original?: string;
  };

  // Build position mapper for diagnostic filtering (if source map provided)
  let mapper: PositionMapperCore | null = null;
  if (sourceMap && original) {
    mapper = createPositionMapperCore(
      sourceMap as Parameters<typeof createPositionMapperCore>[0],
      original,
      code
    );
  }

  const start = performance.now();

  try {
    const result = handleMethod(method, code, fileName, position, mapper);
    const elapsed = Math.round(performance.now() - start);

    res.setHeader("X-LS-Time-Ms", String(elapsed));
    res.setHeader("Cache-Control", "no-cache");

    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Language service failed", message });
  }
}
