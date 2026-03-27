/**
 * Tests for consumer-side @opaque type discovery from .d.ts files.
 *
 * These tests verify the end-to-end flow: given a .d.ts file with @opaque
 * type aliases and companion functions, the discovery module correctly
 * derives and registers TypeRewriteEntry entries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
});
