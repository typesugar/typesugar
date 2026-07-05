/**
 * Tests for consumer-side @opaque type discovery from .d.ts files.
 *
 * These tests verify the end-to-end flow: given a .d.ts file with @opaque
 * type aliases and companion functions, the discovery module correctly
 * derives and registers TypeRewriteEntry entries.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as ts from "typescript";
import { clearTypeRewrites, getTypeRewrite, registerTypeRewrite } from "@typesugar/core";
import { discoverOpaqueTypesFromImports, resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
});

afterEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
});

/**
 * Helper: create a minimal ts.Program with a source file that imports
 * from a virtual module backed by a .d.ts string.
 */
function createTestProgram(
  sourceCode: string,
  dtsContent: string,
  dtsModuleName: string = "my-lib"
): ts.Program {
  const sourceFileName = "/test/source.ts";
  const dtsFileName = `/test/node_modules/${dtsModuleName}/index.d.ts`;

  const files: Record<string, string> = {
    [sourceFileName]: sourceCode,
    [dtsFileName]: dtsContent,
  };

  const compilerHost: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const content = files[fileName];
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      return undefined;
    },
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/test",
    getCanonicalFileName: (f: string) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f: string) => f in files,
    readFile: (f: string) => files[f],
    resolveModuleNames(moduleNames, containingFile) {
      return moduleNames.map((name) => {
        if (name === dtsModuleName) {
          return {
            resolvedFileName: dtsFileName,
            isExternalLibraryImport: true,
            extension: ts.Extension.Dts,
          };
        }
        return undefined;
      });
    },
  };

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  return ts.createProgram([sourceFileName], options, compilerHost);
}

describe("discoverOpaqueTypesFromImports", () => {
  it("discovers @opaque type and registers TypeRewriteEntry", () => {
    const dts = `
/** @opaque A | null */
export type Option<A> = A | null;
export function Some<A>(value: A): Option<A>;
export const None: Option<never>;
export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B>;
export function flatMap<A, B>(opt: Option<A>, f: (a: A) => Option<B>): Option<B>;
export function getOrElse<A>(opt: Option<A>, defaultValue: () => A): A;
`;

    const source = `import { Option, Some, None, map } from "my-lib";`;
    const program = createTestProgram(source, dts);
    const sourceFile = program.getSourceFile("/test/source.ts")!;

    discoverOpaqueTypesFromImports(sourceFile, program);

    const entry = getTypeRewrite("Option");
    expect(entry).toBeDefined();
    expect(entry!.typeName).toBe("Option");
    expect(entry!.underlyingTypeText).toBe("A | null");
    expect(entry!.sourceModule).toBe("my-lib");
    expect(entry!.transparent).toBe(false);

    // Methods: functions whose first param is Option<A>
    expect(entry!.methods?.get("map")).toBe("map");
    expect(entry!.methods?.get("flatMap")).toBe("flatMap");
    expect(entry!.methods?.get("getOrElse")).toBe("getOrElse");

    // Constructors
    expect(entry!.constructors?.get("Some")).toEqual({ kind: "identity" });
    expect(entry!.constructors?.get("None")).toEqual({ kind: "constant", value: "null" });
  });

  it("discovers @opaque on an interface (e.g. @typesugar/fp Option) — PEP-033 N3b", () => {
    // fp publishes Option as an `@opaque interface` (so it can declare its
    // dot-syntax method surface for type-checking) rather than a type alias.
    const dts = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
}
export function Some<A>(value: A): Option<A>;
export const None: Option<never>;
export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B>;
export function flatMap<A, B>(opt: Option<A>, f: (a: A) => Option<B>): Option<B>;
`;

    const source = `import { Option, Some, None, map } from "my-lib";`;
    const program = createTestProgram(source, dts);
    const sourceFile = program.getSourceFile("/test/source.ts")!;

    discoverOpaqueTypesFromImports(sourceFile, program);

    const entry = getTypeRewrite("Option");
    expect(entry).toBeDefined();
    expect(entry!.underlyingTypeText).toBe("A | null");
    expect(entry!.transparent).toBe(false);
    expect(entry!.methods?.get("map")).toBe("map");
    expect(entry!.methods?.get("flatMap")).toBe("flatMap");
    expect(entry!.constructors?.get("Some")).toEqual({ kind: "identity" });
    expect(entry!.constructors?.get("None")).toEqual({ kind: "constant", value: "null" });
  });

  it("skips relative imports", () => {
    const source = `import { Foo } from "./local";`;
    const program = createTestProgram(source, "");
    const sourceFile = program.getSourceFile("/test/source.ts")!;

    discoverOpaqueTypesFromImports(sourceFile, program);

    expect(getTypeRewrite("Foo")).toBeUndefined();
  });

  it("does not overwrite existing type rewrites", () => {
    registerTypeRewrite({
      typeName: "Option",
      underlyingTypeText: "T | null",
      sourceModule: "@typesugar/fp/data/option",
      transparent: true,
    });

    const dts = `
/** @opaque A | null */
export type Option<A> = A | null;
`;
    const source = `import { Option } from "my-lib";`;
    const program = createTestProgram(source, dts);
    const sourceFile = program.getSourceFile("/test/source.ts")!;

    discoverOpaqueTypesFromImports(sourceFile, program);

    // Should keep the original registration
    const entry = getTypeRewrite("Option");
    expect(entry!.sourceModule).toBe("@typesugar/fp/data/option");
    expect(entry!.transparent).toBe(true);
  });

  it("discovers multiple @opaque types from one module", () => {
    const dts = `
/** @opaque A | null */
export type Option<A> = A | null;
export function Some<A>(value: A): Option<A>;

/** @opaque { _tag: 'Left'; left: E } | { _tag: 'Right'; right: A } */
export type Either<E, A> = { _tag: 'Left'; left: E } | { _tag: 'Right'; right: A };
export function Right<E, A>(value: A): Either<E, A>;
export function Left<E, A>(error: E): Either<E, A>;
export function mapEither<E, A, B>(e: Either<E, A>, f: (a: A) => B): Either<E, B>;
`;

    const source = `import { Option, Either } from "my-lib";`;
    const program = createTestProgram(source, dts);
    const sourceFile = program.getSourceFile("/test/source.ts")!;

    discoverOpaqueTypesFromImports(sourceFile, program);

    expect(getTypeRewrite("Option")).toBeDefined();
    expect(getTypeRewrite("Either")).toBeDefined();
    expect(getTypeRewrite("Either")!.constructors?.get("Right")).toEqual({ kind: "identity" });
    expect(getTypeRewrite("Either")!.constructors?.get("Left")).toEqual({ kind: "identity" });
    expect(getTypeRewrite("Either")!.methods?.get("mapEither")).toBe("mapEither");
  });

  it("ignores .d.ts files without @opaque types", () => {
    const dts = `
export type Foo = string;
export interface Bar { x: number; }
export function baz(): void;
`;

    const source = `import { Foo } from "my-lib";`;
    const program = createTestProgram(source, dts);
    const sourceFile = program.getSourceFile("/test/source.ts")!;

    discoverOpaqueTypesFromImports(sourceFile, program);

    expect(getTypeRewrite("Foo")).toBeUndefined();
  });

  describe("DtsFileAccess injection (PEP-056 Wave 3)", () => {
    // Re-export targets of a dependency's .d.ts are usually NOT loaded into the
    // consumer's program (module resolution only follows the entry import),
    // so `program.getSourceFile(resolved)` returns undefined for them and
    // `resolveRelativeDts` must fall back to reading the re-exported file off
    // disk -- this is the exact path `DtsFileAccess` was added to make
    // injectable/browser-safe instead of reaching for `ts.sys` directly.

    /** Entry .d.ts that only re-exports from a sub-module NOT in the program. */
    function createReExportingProgram(): ts.Program {
      const sourceFileName = "/test/source.ts";
      const entryDtsFileName = "/test/node_modules/my-lib/index.d.ts";
      const files: Record<string, string> = {
        [sourceFileName]: `import { Option } from "my-lib";`,
        [entryDtsFileName]: `export type { Option } from "./data/option.js";`,
        // Deliberately NOT registering "./data/option.d.ts" in `files` --
        // program.getSourceFile() must return undefined for it, forcing the
        // disk-fallback path.
      };

      const compilerHost: ts.CompilerHost = {
        getSourceFile(fileName, languageVersion) {
          const content = files[fileName];
          return content !== undefined
            ? ts.createSourceFile(fileName, content, languageVersion, true)
            : undefined;
        },
        getDefaultLibFileName: () => "/lib.d.ts",
        writeFile: () => {},
        getCurrentDirectory: () => "/test",
        getCanonicalFileName: (f: string) => f,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (f: string) => f in files,
        readFile: (f: string) => files[f],
        resolveModuleNames(moduleNames) {
          return moduleNames.map((name) =>
            name === "my-lib"
              ? {
                  resolvedFileName: entryDtsFileName,
                  isExternalLibraryImport: true,
                  extension: ts.Extension.Dts,
                }
              : undefined
          );
        },
      };

      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        noEmit: true,
      };

      return ts.createProgram([sourceFileName], options, compilerHost);
    }

    it("uses an injected fileAccess to read a re-exported .d.ts not already in the program", () => {
      const program = createReExportingProgram();
      const sourceFile = program.getSourceFile("/test/source.ts")!;
      const subDtsPath = "/test/node_modules/my-lib/data/option.d.ts";
      const subDtsContent = `
/** @opaque A | null */
export type Option<A> = A | null;
export function Some<A>(value: A): Option<A>;
`;

      const fileExists = vi.fn((p: string) => p === subDtsPath);
      const readFile = vi.fn((p: string) => (p === subDtsPath ? subDtsContent : undefined));

      discoverOpaqueTypesFromImports(sourceFile, program, false, { fileExists, readFile });

      expect(fileExists).toHaveBeenCalledWith(subDtsPath);
      expect(readFile).toHaveBeenCalledWith(subDtsPath);
      expect(getTypeRewrite("Option")).toBeDefined();
      expect(getTypeRewrite("Option")!.constructors?.get("Some")).toEqual({ kind: "identity" });
    });

    it("registers nothing (but does not throw) when the injected fileAccess can't find the re-exported file", () => {
      const program = createReExportingProgram();
      const sourceFile = program.getSourceFile("/test/source.ts")!;

      const fileAccess = { fileExists: () => false, readFile: () => undefined };

      expect(() =>
        discoverOpaqueTypesFromImports(sourceFile, program, false, fileAccess)
      ).not.toThrow();
      expect(getTypeRewrite("Option")).toBeUndefined();
    });
  });
});
