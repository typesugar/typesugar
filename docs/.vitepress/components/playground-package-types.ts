/**
 * Loads real .d.ts files from packages/&ast;/dist/ and registers them
 * as virtual files for Monaco and the TS worker.
 *
 * Replaces the hand-written stubs that previously lived inline in
 * Playground.vue and api/playground-declarations.ts.
 */

import type * as Monaco from "monaco-editor";

// ---------------------------------------------------------------------------
// 1. Load all real .d.ts files from the monorepo packages via Vite glob
// ---------------------------------------------------------------------------

const rawDtsFiles = import.meta.glob("../../../packages/*/dist/**/*.d.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// ---------------------------------------------------------------------------
// 2. Map file paths → virtual node_modules paths
// ---------------------------------------------------------------------------

export interface VirtualTypeFile {
  /** Virtual path, e.g. "node_modules/@typesugar/fp/dist/index.d.ts" */
  path: string;
  content: string;
}

function mapPath(globPath: string): string | null {
  // globPath looks like "../../../packages/fp/dist/index.d.ts"
  const match = globPath.match(/packages\/([^/]+)\/dist\/(.+)$/);
  if (!match) return null;
  const [, pkg, relPath] = match;

  // Skip packages that aren't relevant to playground users
  const SKIP = new Set([
    "playground",
    "preprocessor",
    "transformer",
    "transformer-core",
    "ts-plugin",
    "vscode",
    "eslint-plugin",
    "prettier-plugin",
    "unplugin-typesugar",
  ]);
  if (SKIP.has(pkg)) return null;

  const moduleName = pkg === "typesugar" ? "typesugar" : `@typesugar/${pkg}`;
  return `node_modules/${moduleName}/dist/${relPath}`;
}

const packageTypeFiles: VirtualTypeFile[] = [];
const packageNames = new Set<string>();

for (const [globPath, content] of Object.entries(rawDtsFiles)) {
  const virtualPath = mapPath(globPath);
  if (!virtualPath) continue;
  packageTypeFiles.push({ path: virtualPath, content });

  // Track package names for package.json generation
  const pkgMatch = virtualPath.match(/^node_modules\/(@typesugar\/[^/]+|typesugar)\//);
  if (pkgMatch) packageNames.add(pkgMatch[1]);
}

// ---------------------------------------------------------------------------
// 3. Generate package.json stubs for module resolution
// ---------------------------------------------------------------------------

for (const name of packageNames) {
  packageTypeFiles.push({
    path: `node_modules/${name}/package.json`,
    content: JSON.stringify({
      name,
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts" }, "./*": { types: "./dist/*/index.d.ts" } },
    }),
  });
}

// ---------------------------------------------------------------------------
// 4. External dependency stubs
//    Only need enough for the real .d.ts imports to resolve.
// ---------------------------------------------------------------------------

// typescript — only referenced by macro internals, not user-facing
packageTypeFiles.push({
  path: "node_modules/typescript/package.json",
  content: JSON.stringify({ name: "typescript", types: "./lib/typescript.d.ts" }),
});
packageTypeFiles.push({
  path: "node_modules/typescript/lib/typescript.d.ts",
  content: `
declare namespace ts {
  interface Node { kind: number; pos: number; end: number; parent: Node; }
  interface SourceFile extends Node { fileName: string; text: string; }
  interface TypeChecker { getTypeAtLocation(node: Node): Type; }
  interface Type { flags: number; symbol?: Symbol; }
  interface Symbol { name: string; flags: number; }
  interface Program { getTypeChecker(): TypeChecker; getSourceFile(fileName: string): SourceFile | undefined; }
  interface CompilerOptions { [key: string]: any; }
  interface Diagnostic { file?: SourceFile; start?: number; length?: number; messageText: string | DiagnosticMessageChain; category: number; code: number; }
  interface DiagnosticMessageChain { messageText: string; category: number; code: number; next?: DiagnosticMessageChain[]; }
  enum ScriptTarget { ES5 = 1, ES2015 = 2, ES2020 = 7, ESNext = 99, Latest = 99 }
  enum ModuleKind { CommonJS = 1, ESNext = 99 }
  enum ModuleResolutionKind { NodeJs = 2, Bundler = 100 }
  enum ScriptKind { TS = 3, TSX = 4 }
  function createSourceFile(fileName: string, sourceText: string, languageVersion: any): SourceFile;
  function forEachChild<T>(node: Node, cbNode: (node: Node) => T | undefined): T | undefined;
  function isIdentifier(node: Node): boolean;
  function isCallExpression(node: Node): boolean;
  const factory: any;
  const sys: any;
}
export = ts;
export as namespace ts;
`,
});

// effect — user-facing, needed for examples and @typesugar/effect's .d.ts
packageTypeFiles.push({
  path: "node_modules/effect/package.json",
  content: JSON.stringify({ name: "effect", types: "./dist/index.d.ts" }),
});
packageTypeFiles.push({
  path: "node_modules/effect/dist/index.d.ts",
  content: `
export interface Effect<out A, out E = never, out R = never> {
  readonly [Symbol.iterator]: () => Iterator<Effect<A, E, R>, A>;
}

export declare const Effect: {
  succeed<A>(value: A): Effect<A>;
  fail<E>(error: E): Effect<never, E>;
  sync<A>(fn: () => A): Effect<A>;
  tryPromise<A>(options: { try: () => Promise<A>; catch: (e: unknown) => any } | (() => Promise<A>)): Effect<A, any>;
  flatMap<A, B, E1, R1, E2, R2>(self: Effect<A, E1, R1>, f: (a: A) => Effect<B, E2, R2>): Effect<B, E1 | E2, R1 | R2>;
  map<A, B, E, R>(self: Effect<A, E, R>, f: (a: A) => B): Effect<B, E, R>;
  tap<A, E, R, X, E2, R2>(self: Effect<A, E, R>, f: (a: A) => Effect<X, E2, R2>): Effect<A, E | E2, R | R2>;
  catchAll<A, E, R, A2, E2, R2>(self: Effect<A, E, R>, f: (e: E) => Effect<A2, E2, R2>): Effect<A | A2, E2, R | R2>;
  all<T extends readonly Effect<any, any, any>[]>(effects: T, options?: { concurrency?: number | "unbounded" }): Effect<any, any, any>;
  gen<Eff extends Effect<any, any, any>, A>(f: () => Generator<Eff, A>): Effect<A, any, any>;
  provide<A, E, R>(self: Effect<A, E, R>, layer: Layer<any, any, any>): Effect<A, E, Exclude<R, any>>;
  runPromise<A, E>(effect: Effect<A, E>): Promise<A>;
  runSync<A, E>(effect: Effect<A, E>): A;
  log(message: string): Effect<void>;
  serviceFunctionEffect<S, T extends Record<string, any>>(tag: Context.Tag<S, T>, f: (s: T) => (...args: any[]) => Effect<any, any, any>): (...args: any[]) => Effect<any, any, any>;
};

export interface Layer<out ROut, out E = never, in RIn = never> {
  readonly _tag: "Layer";
}

export declare const Layer: {
  succeed<T>(tag: Context.Tag<T, any>, impl: any): Layer<T>;
  effect<T>(tag: Context.Tag<T, any>, effect: Effect<any, any, any>): Layer<T, any, any>;
  scoped<T>(tag: Context.Tag<T, any>, effect: Effect<any, any, any>): Layer<T, any, any>;
  mergeAll<Layers extends readonly Layer<any, any, any>[]>(...layers: Layers): Layer<any, any, any>;
  provide<ROut, E, RIn, ROut2, E2, RIn2>(self: Layer<ROut, E, RIn>, that: Layer<ROut2, E2, RIn2>): Layer<ROut, E | E2, Exclude<RIn, ROut2> | RIn2>;
};

export declare namespace Context {
  interface Tag<Id, Shape> {
    readonly _tag: "Tag";
    readonly _id: Id;
    readonly _shape: Shape;
  }
  function GenericTag<Id, Shape>(key: string): Tag<Id, Shape>;
  function Tag<Id>(key?: string): new () => Tag<Id, any>;
}

export interface Stream<out A, out E = never, out R = never> {
  readonly _tag: "Stream";
}

export declare const Stream: {
  fromIterable<A>(iterable: Iterable<A>): Stream<A>;
  map<A, B, E, R>(self: Stream<A, E, R>, f: (a: A) => B): Stream<B, E, R>;
  flatMap<A, B, E1, R1, E2, R2>(self: Stream<A, E1, R1>, f: (a: A) => Stream<B, E2, R2>): Stream<B, E1 | E2, R1 | R2>;
  run<A, E, R>(self: Stream<A, E, R>): Effect<A[], E, R>;
};

export declare const pipe: {
  <A, B>(a: A, ab: (a: A) => B): B;
  <A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
  <A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D;
  <A, B, C, D, E>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D, de: (d: D) => E): E;
};

export type Option<A> = { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" };
export type Either<E, A> = { readonly _tag: "Left"; readonly left: E } | { readonly _tag: "Right"; readonly right: A };
export type Cause<E> = { readonly _tag: string };
export type Chunk<A> = ReadonlyArray<A>;
export type Schedule<out Env, in In, out Out> = { readonly _tag: "Schedule" };
`,
});

// ---------------------------------------------------------------------------
// 5. Globals (typeclass interfaces + primitive instances)
//    These are emitted by the transformer without explicit imports.
// ---------------------------------------------------------------------------

const GLOBALS_CONTENT = `
interface Eq<A> { eq(a: A, b: A): boolean; neq(a: A, b: A): boolean; equals?(a: A, b: A): boolean; notEquals?(a: A, b: A): boolean; }
declare namespace Eq { function registerInstance<T>(name: string, instance: unknown): void; }
interface Ord<A> extends Eq<A> { compare(a: A, b: A): number; lt(a: A, b: A): boolean; gt(a: A, b: A): boolean; lte(a: A, b: A): boolean; gte(a: A, b: A): boolean; }
declare namespace Ord { function registerInstance<T>(name: string, instance: unknown): void; }
interface Clone<A> { clone(a: A): A; }
declare namespace Clone { function registerInstance<T>(name: string, instance: unknown): void; }
interface Debug<A> { debug(a: A): string; }
declare namespace Debug { function registerInstance<T>(name: string, instance: unknown): void; }
interface Hash<A> { hash(a: A): number; }
declare namespace Hash { function registerInstance<T>(name: string, instance: unknown): void; }
interface Show<A> { show(a: A): string; }
declare namespace Show { function registerInstance<T>(name: string, instance: unknown): void; }
declare const eqNumber: Eq<number>;
declare const eqString: Eq<string>;
declare const eqBoolean: Eq<boolean>;
declare const ordNumber: Ord<number>;
declare const ordString: Ord<string>;
declare function __typesugar_createStateMachineInstance(def: any): any;
declare const __typesugar_parser: { grammar(text: string): any };
`;

packageTypeFiles.push({
  path: "__playground_globals__.d.ts",
  content: GLOBALS_CONTENT,
});

// ---------------------------------------------------------------------------
// 6. Exports
// ---------------------------------------------------------------------------

/** All virtual type files for the playground */
export const PACKAGE_TYPE_FILES: readonly VirtualTypeFile[] = packageTypeFiles;

/** Combined globals string (for the worker's ambient declarations) */
export const GLOBALS_DECLARATIONS = GLOBALS_CONTENT;

/**
 * Register all package types with Monaco's TypeScript defaults.
 * Call once during Monaco initialization.
 */
export function registerMonacoTypes(monacoInstance: typeof Monaco): void {
  for (const { path, content } of PACKAGE_TYPE_FILES) {
    monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(content, `file:///${path}`);
  }
}
