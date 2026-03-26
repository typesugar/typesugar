/**
 * Playground TypeScript Language Service Worker
 *
 * Runs a TS LanguageService on transformed code in a Web Worker.
 * Built as IIFE by tsup → docs/public/playground-ts-worker.js.
 *
 * TypeScript itself is loaded from CDN via importScripts (not bundled).
 * @typesugar/transformer-core is bundled inline for position mapping.
 */

/* eslint-disable no-var */
// TypeScript is loaded from CDN at runtime via importScripts.
// This file is excluded from tsc --noEmit (see tsconfig.json) because
// `ts` is a runtime global injected by importScripts, not a TS import.
// Type checking is done by tsup/esbuild during the build step.
declare function importScripts(...urls: string[]): void;
declare const ts: typeof import("typescript");
declare const self: Worker;

// Import directly from the specific file to avoid pulling in @typesugar/core's
// heavy barrel exports (globalRegistry, macro system, etc.)
import {
  createPositionMapperCore,
  type PositionMapperCore,
} from "../../transformer-core/src/position-mapping-core.js";

// Load TypeScript from CDN
const TS_CDN = "https://cdn.jsdelivr.net/npm/typescript@5.8/lib";
importScripts(TS_CDN + "/typescript.js");

// ---------------------------------------------------------------------------
// Virtual file system
// ---------------------------------------------------------------------------

interface VirtualFile {
  content: string;
  version: number;
}

const files = new Map<string, VirtualFile>();
const INPUT_FILE = "input.ts";

function setFile(name: string, content: string): void {
  const existing = files.get(name);
  if (existing) {
    existing.content = content;
    existing.version++;
  } else {
    files.set(name, { content, version: 1 });
  }
}

setFile(INPUT_FILE, "");

// ---------------------------------------------------------------------------
// Position mapper for diagnostic filtering (MacroGenerated rule)
// ---------------------------------------------------------------------------

let positionMapper: PositionMapperCore | null = null;

// ---------------------------------------------------------------------------
// Language Service Host
// ---------------------------------------------------------------------------

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
  types: [],
  typeRoots: [],
};

const lsHost: ts.LanguageServiceHost = {
  getScriptFileNames: () => Array.from(files.keys()),
  getScriptVersion: (fileName) => {
    const file = files.get(fileName);
    return file ? String(file.version) : "0";
  },
  getScriptSnapshot: (fileName) => {
    const file = files.get(fileName);
    if (file) return ts.ScriptSnapshot.fromString(file.content);
    return undefined;
  },
  getCurrentDirectory: () => "/",
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: () => "",
  fileExists: (fileName) => files.has(fileName),
  readFile: (fileName) => files.get(fileName)?.content,
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

/** Filter diagnostics using MacroGenerated rule: suppress if position can't map to original */
function filterDiagnostics(diags: readonly ts.Diagnostic[]): SerializedDiagnostic[] {
  const result: SerializedDiagnostic[] = [];
  for (const d of diags) {
    // If we have a position mapper, suppress diagnostics in generated code
    if (positionMapper && d.start !== undefined) {
      const origPos = positionMapper.toOriginal(d.start);
      if (origPos === null) continue; // In macro-generated code → suppress
    }
    result.push(serializeDiagnostic(d));
  }
  return result;
}

// ---------------------------------------------------------------------------
// RPC message handling
// ---------------------------------------------------------------------------

interface WorkerRequest {
  id: number;
  method: string;
  params: unknown[];
}

function handleMessage(msg: WorkerRequest): unknown {
  const { method, params } = msg;

  switch (method) {
    case "updateFile": {
      const [fileName, content] = params as [string, string];
      setFile(fileName, content);
      return { ok: true };
    }

    case "addLib": {
      const [fileName, content] = params as [string, string];
      setFile(fileName, content);
      return { ok: true };
    }

    case "setSourceMap": {
      const [sourceMap, original, transformed] = params as [unknown, string, string];
      positionMapper = createPositionMapperCore(
        sourceMap as Parameters<typeof createPositionMapperCore>[0],
        original,
        transformed
      );
      return { ok: true };
    }

    case "getDiagnostics": {
      const [fileName] = params as [string];
      const syntactic = ls.getSyntacticDiagnostics(fileName);
      const semantic = ls.getSemanticDiagnostics(fileName);
      return filterDiagnostics([...syntactic, ...semantic]);
    }

    case "getCompletions": {
      const [fileName, position] = params as [string, number];
      const result = ls.getCompletionsAtPosition(fileName, position, {
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
      const [fileName, position] = params as [string, number];
      const info = ls.getQuickInfoAtPosition(fileName, position);
      if (!info) return null;
      return {
        kind: info.kind,
        textSpan: info.textSpan,
        displayParts: (info.displayParts ?? []).map((p) => p.text).join(""),
        documentation: (info.documentation ?? []).map((p) => p.text).join(""),
      };
    }

    case "getDefinition": {
      const [fileName, position] = params as [string, number];
      const defs = ls.getDefinitionAtPosition(fileName, position);
      if (!defs) return null;
      return defs
        .filter((d) => d.fileName === fileName)
        .map((d) => ({ textSpan: d.textSpan, fileName: d.fileName }));
    }

    case "getSignatureHelp": {
      const [fileName, position] = params as [string, number];
      const help = ls.getSignatureHelpItems(fileName, position, {});
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

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    const result = handleMessage(msg);
    self.postMessage({ id: msg.id, result });
  } catch (err) {
    self.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// Signal ready
self.postMessage({ id: -1, result: "ready" });
