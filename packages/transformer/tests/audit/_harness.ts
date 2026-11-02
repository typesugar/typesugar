/**
 * Shared harness for the 2026-11 correctness audit tests (audit/FABLE-AUDIT-2026-11.md).
 *
 * Unlike `transformCode` (one fresh program per call), `project()` builds ONE
 * `TransformationPipeline` over an in-memory multi-file project so tests can
 * transform several files against the SAME `ts.Program` — the shape the CLI
 * `build`/`watch` commands and the language service actually run in.
 */

import * as ts from "typescript";
import * as path from "path";
import { TransformationPipeline, type TransformResult } from "@typesugar/transformer/pipeline";

export const AUDIT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  strict: false,
  noImplicitAny: false,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
};

export interface VirtualProject {
  pipeline: TransformationPipeline;
  /** Absolute paths of the project files, in insertion order. */
  roots: string[];
  /** Mutable backing store (edit a file's content to simulate a watch-mode change). */
  files: Record<string, string>;
  /** Transform a file by its short name (e.g. "main.ts"). */
  transform(name: string): TransformResult;
}

/** Virtual filesystem over in-memory files; falls through to disk for libs/packages. */
export function createVirtualFs(files: Record<string, string>) {
  const resolved: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    resolved[path.resolve(name)] = content;
  }
  return {
    resolved,
    readFile: (f: string) => resolved[f] ?? ts.sys.readFile(f),
    fileExists: (f: string) => f in resolved || ts.sys.fileExists(f),
  };
}

export function project(
  files: Record<string, string>,
  compilerOptions: ts.CompilerOptions = AUDIT_COMPILER_OPTIONS
): VirtualProject {
  const vfs = createVirtualFs(files);
  const roots = Object.keys(files).map((f) => path.resolve(f));
  const pipeline = new TransformationPipeline(compilerOptions, roots, {
    readFile: vfs.readFile,
    fileExists: vfs.fileExists,
  });
  return {
    pipeline,
    roots,
    files: vfs.resolved,
    transform: (name) => pipeline.transform(path.resolve(name)),
  };
}

/** Transform a single self-contained file (optionally with sibling files) in a fresh program. */
export function transformOne(
  code: string,
  files: Record<string, string> = {},
  compilerOptions?: ts.CompilerOptions
): TransformResult {
  return project({ "main.ts": code, ...files }, compilerOptions).transform("main.ts");
}

/** The `export const <name> = …;` line of a transformed output, trimmed. */
export function exportLine(code: string, name: string): string | undefined {
  return code
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(`export const ${name} =`));
}

export function errors(result: TransformResult): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
}

/** A minimal, self-contained Eq typeclass with `@op` tags (no std dependency). */
export const EQ_TYPECLASS = `
/** @typeclass */
export interface Eq<A> {
  /** @op === */
  equals(a: A, b: A): boolean;
  /** @op !== */
  notEquals(a: A, b: A): boolean;
}
`.trim();

export const EQ_OPS_MARKER = `/** @syntax-operators Eq */\nexport const __eqOps = true;\nexport type EqOpsMarker = true;\n`;
