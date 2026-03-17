<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef, computed, nextTick } from "vue";
import type * as Monaco from "monaco-editor";
import LZString from "lz-string";
const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString;
import ErrorBoundary from "./ErrorBoundary.vue";
import { EXAMPLE_GROUPS, DEFAULT_CODE } from "./playground-examples";
import type { ExamplePreset, ExampleGroup } from "./playground-examples";

interface TransformResult {
  original: string;
  code: string;
  changed: boolean;
  diagnostics: Array<{
    file: string;
    start: number;
    length: number;
    message: string;
    severity: "error" | "warning";
    line?: number;
    column?: number;
  }>;
  preprocessed?: boolean;
}

interface ConsoleMessage {
  type: "log" | "error" | "warn" | "info";
  args: unknown[];
  timestamp: number;
}

// ExamplePreset, ExampleGroup, DEFAULT_CODE, and EXAMPLE_GROUPS are imported
// from ./playground-examples.ts which auto-discovers docs/examples/**/*.{ts,sts}

const STORAGE_KEYS = {
  code: "typesugar-playground-code",
  fileType: "typesugar-playground-fileType",
  tsVersion: "typesugar-playground-tsVersion",
  showConsole: "typesugar-playground-showConsole",
};

const props = withDefaults(
  defineProps<{
    initialCode?: string;
    initialFileType?: ".ts" | ".sts";
  }>(),
  {
    initialCode: DEFAULT_CODE,
    initialFileType: ".ts",
  }
);

const inputContainer = ref<HTMLElement | null>(null);
const outputContainer = ref<HTMLElement | null>(null);
const inputEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const outputEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const monaco = shallowRef<typeof Monaco | null>(null);
const playground = shallowRef<{
  transform: (code: string, options: { fileName: string; verbose?: boolean }) => TransformResult;
  preprocessCode: (code: string, options: { fileName: string }) => { code: string; changed: boolean };
} | null>(null);
const sandboxIframe = ref<HTMLIFrameElement | null>(null);
const runtimeCode = ref<string>("");

const fileType = ref<".ts" | ".sts">(props.initialFileType);
const tsVersion = ref("5.8");
const isLoading = ref(true);
const isRunning = ref(false);
const isTransforming = ref(false);
const loadingProgress = ref(0);
const loadingMessage = ref("Initializing...");
const transformError = ref<string | null>(null);
const lastResult = ref<TransformResult | null>(null);
const transformTime = ref<number>(0);

// Server compilation state
const useServerCompilation = ref(true);
const isServerAvailable = ref(true);
const serverCompilationFailed = ref(false);

const activeTab = ref<"js" | "errors">("js");
const consoleMessages = ref<ConsoleMessage[]>([]);
const showConsole = ref(true);

// Sharing state
const shareTooltip = ref<string | null>(null);
const showPresetsDropdown = ref(false);
const selectedPreset = ref<string>("Welcome");

const fileName = computed(() => `input${fileType.value}`);

const errorCount = computed(() => lastResult.value?.diagnostics?.length ?? 0);

const statusText = computed(() => {
  if (isLoading.value) return "Loading...";
  if (isTransforming.value) return "Transforming...";
  if (transformError.value) return `Error`;
  const fallbackSuffix = serverCompilationFailed.value ? " (offline)" : "";
  if (!lastResult.value) return "Ready" + fallbackSuffix;
  const changed = lastResult.value.changed ? "transformed" : "unchanged";
  const preprocessed = lastResult.value.preprocessed ? " + preprocessed" : "";
  const time = transformTime.value > 0 ? ` (${transformTime.value}ms)` : "";
  return `✓ ${changed}${preprocessed}${time}${fallbackSuffix}`;
});

const statusClass = computed(() => {
  if (isLoading.value) return "loading";
  if (isTransforming.value) return "transforming";
  if (transformError.value || errorCount.value > 0) return "error";
  return "success";
});


function registerStsLanguage(monacoInstance: typeof Monaco) {
  if (monacoInstance.languages.getLanguages().some((lang) => lang.id === "sts")) {
    return;
  }

  monacoInstance.languages.register({ id: "sts", extensions: [".sts", ".stsx"] });

  monacoInstance.languages.setMonarchTokensProvider("sts", {
    defaultToken: "",
    tokenPostfix: ".sts",

    keywords: [
      "abstract", "any", "as", "asserts", "async", "await", "boolean", "break",
      "case", "catch", "class", "const", "constructor", "continue", "debugger",
      "declare", "default", "delete", "do", "else", "enum", "export", "extends",
      "false", "finally", "for", "from", "function", "get", "if", "implements",
      "import", "in", "infer", "instanceof", "interface", "is", "keyof", "let",
      "module", "namespace", "never", "new", "null", "number", "object", "of",
      "package", "private", "protected", "public", "readonly", "require", "return",
      "satisfies", "set", "static", "string", "super", "switch", "symbol", "this",
      "throw", "true", "try", "type", "typeof", "undefined", "unique", "unknown",
      "var", "void", "while", "with", "yield",
    ],

    typeKeywords: ["F", "HKT", "Kind", "Type", "Functor", "Monad", "Apply", "Applicative"],

    operators: [
      "<=", ">=", "==", "!=", "===", "!==", "=>", "+", "-", "**", "*", "/", "%",
      "++", "--", "<<", "</", ">>", ">>>", "&", "|", "^", "!", "~", "&&", "||",
      "??", "?", ":", "=", "+=", "-=", "*=", "**=", "/=", "%=", "<<=", ">>=",
      ">>>=", "&=", "|=", "^=", "@", "|>", "<|", "::", "~>",
    ],

    symbols: /[=><!~?:&|+\-*\/\^%@]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    digits: /\d+(_+\d+)*/,
    octaldigits: /[0-7]+(_+[0-7]+)*/,
    binarydigits: /[0-1]+(_+[0-1]+)*/,
    hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

    regexpctl: /[(){}\[\]\$\^|\-*+?\.]/,
    regexpesc: /\\(?:[bBdDfnrstvwWn0\\\/]|@regexpctl|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,

    tokenizer: {
      root: [[/[{}]/, "delimiter.bracket"], { include: "common" }],

      common: [
        [/F<_>/, "type.identifier.hkt"],
        [/\b_\b/, "type.identifier.placeholder"],
        [/@@typeclass\b/, "annotation.typeclass"],
        [/@@impl\b/, "annotation.impl"],
        [/@@deriving\b/, "annotation.deriving"],
        [/@@derive\b/, "annotation.derive"],
        [/@@extension\b/, "annotation.extension"],
        [/@@comptime\b/, "annotation.comptime"],
        [/@@macro\b/, "annotation.macro"],
        [/@@[a-zA-Z_$][\w$]*/, "annotation"],
        [/\|>/, "operator.pipeline"],
        [/<\|/, "operator.pipeline"],
        [/::/, "operator.cons"],
        [/~>/, "operator.kind"],
        [/[a-z_$][\w$]*/, {
          cases: {
            "@typeKeywords": "type.identifier",
            "@keywords": "keyword",
            "@default": "identifier",
          },
        }],
        [/[A-Z][\w\$]*/, "type.identifier"],
        { include: "@whitespace" },
        [/\/(?=([^\\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/, { token: "regexp", bracket: "@open", next: "@regexp" }],
        [/[()\[\]]/, "@brackets"],
        [/[<>](?!@symbols)/, "@brackets"],
        [/!(?=([^=]|$))/, "delimiter"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        [/(@digits)[eE]([\-+]?(@digits))?/, "number.float"],
        [/(@digits)\.(@digits)([eE][\-+]?(@digits))?/, "number.float"],
        [/0[xX](@hexdigits)n?/, "number.hex"],
        [/0[oO]?(@octaldigits)n?/, "number.octal"],
        [/0[bB](@binarydigits)n?/, "number.binary"],
        [/(@digits)n?/, "number"],
        [/[;,.]/, "delimiter"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
        [/`/, "string", "@string_backtick"],
      ],

      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*\*(?!\/)/, "comment.doc", "@jsdoc"],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],

      comment: [[/[^\/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[\/*]/, "comment"]],
      jsdoc: [[/[^\/*]+/, "comment.doc"], [/\*\//, "comment.doc", "@pop"], [/[\/*]/, "comment.doc"]],

      regexp: [
        [/(\{)(\d+(?:,\d*)?)(\})/, ["regexp.escape.control", "regexp.escape.control", "regexp.escape.control"]],
        [/(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/, ["regexp.escape.control", { token: "regexp.escape.control", next: "@regexrange" }]],
        [/(\()(\?:|\?=|\?!)/, ["regexp.escape.control", "regexp.escape.control"]],
        [/[()]/, "regexp.escape.control"],
        [/@regexpctl/, "regexp.escape.control"],
        [/[^\\\/]/, "regexp"],
        [/@regexpesc/, "regexp.escape"],
        [/\\\./, "regexp.invalid"],
        [/(\/)([dgimsuy]*)/, [{ token: "regexp", bracket: "@close", next: "@pop" }, "keyword.other"]],
      ],

      regexrange: [
        [/-/, "regexp.escape.control"],
        [/\^/, "regexp.invalid"],
        [/@regexpesc/, "regexp.escape"],
        [/[^\]]/, "regexp"],
        [/\]/, { token: "regexp.escape.control", next: "@pop", bracket: "@close" }],
      ],

      string_double: [[/[^\\"]+/, "string"], [/@escapes/, "string.escape"], [/\\./, "string.escape.invalid"], [/"/, "string", "@pop"]],
      string_single: [[/[^\\']+/, "string"], [/@escapes/, "string.escape"], [/\\./, "string.escape.invalid"], [/'/, "string", "@pop"]],
      string_backtick: [
        [/\$\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
        [/[^\\`$]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/`/, "string", "@pop"],
      ],
      bracketCounting: [[/\{/, "delimiter.bracket", "@bracketCounting"], [/\}/, "delimiter.bracket", "@pop"], { include: "common" }],
    },
  });

  monacoInstance.editor.defineTheme("typesugar-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "annotation.typeclass", foreground: "c678dd", fontStyle: "bold" },
      { token: "annotation.impl", foreground: "c678dd", fontStyle: "bold" },
      { token: "annotation.deriving", foreground: "c678dd", fontStyle: "bold" },
      { token: "annotation.derive", foreground: "c678dd", fontStyle: "bold" },
      { token: "annotation.extension", foreground: "c678dd", fontStyle: "bold" },
      { token: "annotation.comptime", foreground: "e5c07b", fontStyle: "bold" },
      { token: "annotation.macro", foreground: "c678dd", fontStyle: "bold" },
      { token: "annotation", foreground: "c678dd" },
      { token: "operator.pipeline", foreground: "56b6c2", fontStyle: "bold" },
      { token: "operator.cons", foreground: "56b6c2", fontStyle: "bold" },
      { token: "operator.kind", foreground: "56b6c2" },
      { token: "type.identifier.hkt", foreground: "e5c07b", fontStyle: "italic" },
      { token: "type.identifier.placeholder", foreground: "e5c07b", fontStyle: "italic" },
      { token: "type.identifier", foreground: "e5c07b" },
    ],
    colors: {},
  });

  monacoInstance.editor.defineTheme("typesugar-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "annotation.typeclass", foreground: "a626a4", fontStyle: "bold" },
      { token: "annotation.impl", foreground: "a626a4", fontStyle: "bold" },
      { token: "annotation.deriving", foreground: "a626a4", fontStyle: "bold" },
      { token: "annotation.derive", foreground: "a626a4", fontStyle: "bold" },
      { token: "annotation.extension", foreground: "a626a4", fontStyle: "bold" },
      { token: "annotation.comptime", foreground: "986801", fontStyle: "bold" },
      { token: "annotation.macro", foreground: "a626a4", fontStyle: "bold" },
      { token: "annotation", foreground: "a626a4" },
      { token: "operator.pipeline", foreground: "0184bc", fontStyle: "bold" },
      { token: "operator.cons", foreground: "0184bc", fontStyle: "bold" },
      { token: "operator.kind", foreground: "0184bc" },
      { token: "type.identifier.hkt", foreground: "986801", fontStyle: "italic" },
      { token: "type.identifier.placeholder", foreground: "986801", fontStyle: "italic" },
      { token: "type.identifier", foreground: "986801" },
    ],
    colors: {},
  });
}

function registerTypesugarTypes(monacoInstance: typeof Monaco) {
  // Configure TypeScript compiler options first
  monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monacoInstance.languages.typescript.ScriptTarget.Latest,
    module: monacoInstance.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    strict: false,
    noEmit: true,
    allowJs: true,
    jsx: monacoInstance.languages.typescript.JsxEmit.React,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  });

  // Main typesugar module
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "typesugar" {
  // Static assertions
  export function staticAssert(condition: boolean, message?: string): void;

  // Compile-time evaluation
  export function comptime<T>(fn: () => T): T;

  // Derive decorators
  export function derive(...traits: symbol[]): ClassDecorator;
  export const Eq: unique symbol;
  export const Ord: unique symbol;
  export const Clone: unique symbol;
  export const Debug: unique symbol;
  export const Hash: unique symbol;
  export const Default: unique symbol;
  export const Json: unique symbol;
  export const Builder: unique symbol;
  export const TypeGuard: unique symbol;

  // Typeclass decorators
  export function typeclass(target: any): any;
  export function instance(name: string): ClassDecorator;
  export function impl(name: string): ClassDecorator;
  export function derive(...traits: symbol[]): ClassDecorator;
  /** @deprecated Use \`derive\` instead */
  export function deriving(...traits: symbol[]): ClassDecorator;
  export function summon<T>(): T;
  export function extend<T, U>(base: T, extension: U): T & U;
  export function implicit<T>(): T;

  // Operators
  export function operators(target: any): any;
  export function ops<T>(expr: T): T;
  export function pipe<A, B>(a: A, fn: (a: A) => B): B;
  export function pipe<A, B, C>(a: A, fn1: (a: A) => B, fn2: (b: B) => C): C;
  export function pipe<A, B, C, D>(a: A, fn1: (a: A) => B, fn2: (b: B) => C, fn3: (c: C) => D): D;
  export function pipe<A, B, C, D, E>(a: A, fn1: (a: A) => B, fn2: (b: B) => C, fn3: (c: C) => D, fn4: (d: D) => E): E;
  export function compose<A, B, C>(f: (b: B) => C, g: (a: A) => B): (a: A) => C;
  export function flow<A, B>(f: (a: A) => B): (a: A) => B;
  export function flow<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C;
  export function flow<A, B, C, D>(f: (a: A) => B, g: (b: B) => C, h: (c: C) => D): (a: A) => D;

  // Reflection
  export function reflect(target: any): any;
  export function typeInfo<T>(): object;
  export function fieldNames<T>(): string[];
  export function validator<T>(): (value: unknown) => value is T;

  // Conditional compilation
  export function cfg(condition: string): PropertyDecorator;

  // File includes
  export function includeStr(path: string): string;
  export function includeJson<T = unknown>(path: string): T;

  // Specialization
  export function specialize<T>(fn: T): T;
  export function mono<T>(fn: T): T;
  export function inlineCall<T>(fn: T): T;

  // Tail recursion
  export function tailrec(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor;

  // Higher-Kinded Types
  export function hkt(target: any): any;
  export type _  = { readonly _: unique symbol };

  // Extension methods
  export function extension(target: any): any;
  export function registerExtensions(target: any): any;
  export function registerExtension(name: string): MethodDecorator;
}
`, "file:///node_modules/typesugar/index.d.ts");

  // @typesugar/core
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/core" {
  export interface MacroContext {
    readonly program: any;
    readonly sourceFile: any;
    readonly factory: any;
    readonly checker: any;
  }

  export interface ExpressionMacro {
    name: string;
    kind: "expression";
    module?: string;
    description?: string;
    expand(ctx: MacroContext, node: any, args: any[]): any;
  }

  export interface AttributeMacro {
    name: string;
    kind: "attribute";
    module?: string;
    description?: string;
    expand(ctx: MacroContext, node: any): any;
  }

  export interface DeriveMacro {
    name: string;
    kind: "derive";
    module?: string;
    description?: string;
    expand(ctx: MacroContext, node: any): any[];
  }

  export const globalRegistry: {
    register(macro: ExpressionMacro | AttributeMacro | DeriveMacro): void;
    getExpression(name: string): ExpressionMacro | undefined;
    getAttribute(name: string): AttributeMacro | undefined;
    getDerive(name: string): DeriveMacro | undefined;
  };

  export function createMacroContext(program: any, sourceFile: any, context: any): MacroContext;
}
`, "file:///node_modules/@typesugar/core/index.d.ts");

  // @typesugar/macros
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/macros" {
  export * from "typesugar";

  // Quasiquoting
  export function quote(strings: TemplateStringsArray, ...values: any[]): any;
  export function quoteStatements(strings: TemplateStringsArray, ...values: any[]): any[];
  export function quoteType(strings: TemplateStringsArray, ...values: any[]): any;
  export function ident(name: string): any;
  export function raw(node: any): any;
  export function spread(nodes: any[]): any;

  // Pattern macros
  export function defineSyntaxMacro(pattern: string, replacement: string): void;
  export function defineRewrite(from: string, to: string): void;

  // Custom derive
  export function defineCustomDerive(name: string, impl: (info: any) => string): void;
  export function defineFieldDerive(name: string, impl: (field: any) => string): void;
}
`, "file:///node_modules/@typesugar/macros/index.d.ts");

  // @typesugar/testing
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/testing" {
  // Power assertions
  export function assert(condition: boolean, message?: string): void;
  export function powerAssert(condition: boolean, message?: string): void;

  // Static assertions
  export function staticAssert(condition: boolean, message?: string): void;
  export function comptimeAssert(condition: boolean, message?: string): void;

  // Type assertions
  export function typeAssert<T>(): void;
  export function assertType<T>(value: T): void;
  export type Equal<A, B> = A extends B ? (B extends A ? true : false) : false;
  export type Extends<A, B> = A extends B ? true : false;

  // Snapshot testing
  export function assertSnapshot<T>(value: T): void;

  // Property-based testing
  export function forAll<T>(gen: any, prop: (value: T) => boolean | void): void;

  // Arbitrary generation
  export const Arbitrary: unique symbol;
}
`, "file:///node_modules/@typesugar/testing/index.d.ts");

  // @typesugar/fp - Functional programming utilities
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/fp" {
  // Option type
  export type Option<A> = Some<A> | None;
  export interface Some<A> { readonly _tag: "Some"; readonly value: A; }
  export interface None { readonly _tag: "None"; }
  export function some<A>(value: A): Option<A>;
  export const none: None;
  export function isSome<A>(opt: Option<A>): opt is Some<A>;
  export function isNone<A>(opt: Option<A>): opt is None;

  // Either type
  export type Either<E, A> = Left<E> | Right<A>;
  export interface Left<E> { readonly _tag: "Left"; readonly left: E; }
  export interface Right<A> { readonly _tag: "Right"; readonly right: A; }
  export function left<E, A = never>(e: E): Either<E, A>;
  export function right<A, E = never>(a: A): Either<E, A>;
  export function isLeft<E, A>(e: Either<E, A>): e is Left<E>;
  export function isRight<E, A>(e: Either<E, A>): e is Right<A>;

  // Function utilities
  export function identity<A>(a: A): A;
  export function constant<A>(a: A): () => A;
  export function flip<A, B, C>(f: (a: A, b: B) => C): (b: B, a: A) => C;
  export function curry<A, B, C>(f: (a: A, b: B) => C): (a: A) => (b: B) => C;
  export function uncurry<A, B, C>(f: (a: A) => (b: B) => C): (a: A, b: B) => C;
}
`, "file:///node_modules/@typesugar/fp/index.d.ts");

  // @typesugar/effect - Effect system
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/effect" {
  export interface Effect<R, E, A> {
    readonly _R: (_: R) => void;
    readonly _E: () => E;
    readonly _A: () => A;
  }

  export function succeed<A>(value: A): Effect<unknown, never, A>;
  export function fail<E>(error: E): Effect<unknown, E, never>;
  export function sync<A>(fn: () => A): Effect<unknown, never, A>;
  export function async<A>(fn: (cb: (a: A) => void) => void): Effect<unknown, never, A>;

  export function map<R, E, A, B>(self: Effect<R, E, A>, f: (a: A) => B): Effect<R, E, B>;
  export function flatMap<R, E, A, R2, E2, B>(self: Effect<R, E, A>, f: (a: A) => Effect<R2, E2, B>): Effect<R | R2, E | E2, B>;
  export function catchAll<R, E, A, R2, E2, B>(self: Effect<R, E, A>, f: (e: E) => Effect<R2, E2, B>): Effect<R | R2, E2, A | B>;

  export function runSync<E, A>(effect: Effect<unknown, E, A>): A;
  export function runPromise<E, A>(effect: Effect<unknown, E, A>): Promise<A>;
}
`, "file:///node_modules/@typesugar/effect/index.d.ts");

  // @typesugar/std - Standard library
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/std" {
  // Array utilities
  export function head<A>(arr: A[]): A | undefined;
  export function tail<A>(arr: A[]): A[];
  export function last<A>(arr: A[]): A | undefined;
  export function init<A>(arr: A[]): A[];
  export function take<A>(n: number, arr: A[]): A[];
  export function drop<A>(n: number, arr: A[]): A[];
  export function chunk<A>(size: number, arr: A[]): A[][];
  export function zip<A, B>(as: A[], bs: B[]): [A, B][];
  export function unzip<A, B>(pairs: [A, B][]): [A[], B[]];
  export function groupBy<A, K extends string | number>(arr: A[], fn: (a: A) => K): Record<K, A[]>;
  export function sortBy<A>(arr: A[], fn: (a: A) => number | string): A[];
  export function unique<A>(arr: A[]): A[];
  export function partition<A>(arr: A[], pred: (a: A) => boolean): [A[], A[]];

  // Object utilities
  export function keys<T extends object>(obj: T): (keyof T)[];
  export function values<T extends object>(obj: T): T[keyof T][];
  export function entries<T extends object>(obj: T): [keyof T, T[keyof T]][];
  export function fromEntries<K extends string | number | symbol, V>(entries: [K, V][]): Record<K, V>;
  export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
  export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>;
  export function merge<T extends object, U extends object>(a: T, b: U): T & U;

  // String utilities
  export function capitalize(s: string): string;
  export function uncapitalize(s: string): string;
  export function camelCase(s: string): string;
  export function snakeCase(s: string): string;
  export function kebabCase(s: string): string;
  export function pascalCase(s: string): string;
  export function words(s: string): string[];
  export function trim(s: string): string;
  export function padLeft(s: string, len: number, char?: string): string;
  export function padRight(s: string, len: number, char?: string): string;
}
`, "file:///node_modules/@typesugar/std/index.d.ts");

  // @typesugar/collections - Immutable collections
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/collections" {
  export class List<A> {
    static of<A>(...items: A[]): List<A>;
    static from<A>(iterable: Iterable<A>): List<A>;
    static empty<A>(): List<A>;

    head(): A | undefined;
    tail(): List<A>;
    cons(value: A): List<A>;
    concat(other: List<A>): List<A>;
    map<B>(f: (a: A) => B): List<B>;
    flatMap<B>(f: (a: A) => List<B>): List<B>;
    filter(pred: (a: A) => boolean): List<A>;
    fold<B>(init: B, f: (acc: B, a: A) => B): B;
    toArray(): A[];
    [Symbol.iterator](): Iterator<A>;
  }

  export class Vector<A> {
    static of<A>(...items: A[]): Vector<A>;
    static from<A>(iterable: Iterable<A>): Vector<A>;
    static empty<A>(): Vector<A>;

    get(index: number): A | undefined;
    set(index: number, value: A): Vector<A>;
    push(value: A): Vector<A>;
    pop(): Vector<A>;
    map<B>(f: (a: A) => B): Vector<B>;
    filter(pred: (a: A) => boolean): Vector<A>;
    toArray(): A[];
    readonly length: number;
    [Symbol.iterator](): Iterator<A>;
  }

  export class HashMap<K, V> {
    static of<K, V>(...entries: [K, V][]): HashMap<K, V>;
    static from<K, V>(entries: Iterable<[K, V]>): HashMap<K, V>;
    static empty<K, V>(): HashMap<K, V>;

    get(key: K): V | undefined;
    set(key: K, value: V): HashMap<K, V>;
    delete(key: K): HashMap<K, V>;
    has(key: K): boolean;
    keys(): Iterable<K>;
    values(): Iterable<V>;
    entries(): Iterable<[K, V]>;
    map<V2>(f: (v: V, k: K) => V2): HashMap<K, V2>;
    readonly size: number;
  }

  export class HashSet<A> {
    static of<A>(...items: A[]): HashSet<A>;
    static from<A>(iterable: Iterable<A>): HashSet<A>;
    static empty<A>(): HashSet<A>;

    add(value: A): HashSet<A>;
    delete(value: A): HashSet<A>;
    has(value: A): boolean;
    union(other: HashSet<A>): HashSet<A>;
    intersection(other: HashSet<A>): HashSet<A>;
    difference(other: HashSet<A>): HashSet<A>;
    map<B>(f: (a: A) => B): HashSet<B>;
    filter(pred: (a: A) => boolean): HashSet<A>;
    toArray(): A[];
    readonly size: number;
    [Symbol.iterator](): Iterator<A>;
  }
}
`, "file:///node_modules/@typesugar/collections/index.d.ts");

  // @typesugar/validate - Runtime validation
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/validate" {
  export interface Schema<T> {
    parse(value: unknown): T;
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: ValidationError };
    optional(): Schema<T | undefined>;
    nullable(): Schema<T | null>;
    default(value: T): Schema<T>;
    transform<U>(fn: (value: T) => U): Schema<U>;
    refine(pred: (value: T) => boolean, message?: string): Schema<T>;
  }

  export class ValidationError extends Error {
    readonly issues: { path: string[]; message: string }[];
  }

  export function string(): Schema<string>;
  export function number(): Schema<number>;
  export function boolean(): Schema<boolean>;
  export function literal<T extends string | number | boolean>(value: T): Schema<T>;
  export function array<T>(schema: Schema<T>): Schema<T[]>;
  export function object<T extends Record<string, Schema<any>>>(shape: T): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }>;
  export function union<T extends Schema<any>[]>(...schemas: T): Schema<T[number] extends Schema<infer U> ? U : never>;
  export function intersection<A, B>(a: Schema<A>, b: Schema<B>): Schema<A & B>;
  export function record<K extends string, V>(keySchema: Schema<K>, valueSchema: Schema<V>): Schema<Record<K, V>>;
  export function tuple<T extends Schema<any>[]>(...schemas: T): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }>;
}
`, "file:///node_modules/@typesugar/validate/index.d.ts");

  // @typesugar/contracts - Design by contract
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/contracts" {
  export function requires(condition: boolean, message?: string): void;
  export function ensures(condition: boolean, message?: string): void;
  export function invariant(condition: boolean, message?: string): void;
  export function unreachable(message?: string): never;

  export function pre(condition: () => boolean, message?: string): MethodDecorator;
  export function post(condition: (result: any) => boolean, message?: string): MethodDecorator;
  export function classInvariant(condition: () => boolean, message?: string): ClassDecorator;
}
`, "file:///node_modules/@typesugar/contracts/index.d.ts");

  // @typesugar/math - Math utilities
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/math" {
  export function clamp(value: number, min: number, max: number): number;
  export function lerp(a: number, b: number, t: number): number;
  export function inverseLerp(a: number, b: number, value: number): number;
  export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  export function deg2rad(degrees: number): number;
  export function rad2deg(radians: number): number;
  export function gcd(a: number, b: number): number;
  export function lcm(a: number, b: number): number;
  export function factorial(n: number): number;
  export function isPrime(n: number): boolean;
  export function fibonacci(n: number): number;

  export class Vec2 {
    constructor(x: number, y: number);
    readonly x: number;
    readonly y: number;
    add(other: Vec2): Vec2;
    sub(other: Vec2): Vec2;
    mul(scalar: number): Vec2;
    div(scalar: number): Vec2;
    dot(other: Vec2): number;
    length(): number;
    normalize(): Vec2;
    static zero: Vec2;
    static one: Vec2;
  }

  export class Vec3 {
    constructor(x: number, y: number, z: number);
    readonly x: number;
    readonly y: number;
    readonly z: number;
    add(other: Vec3): Vec3;
    sub(other: Vec3): Vec3;
    mul(scalar: number): Vec3;
    div(scalar: number): Vec3;
    dot(other: Vec3): number;
    cross(other: Vec3): Vec3;
    length(): number;
    normalize(): Vec3;
    static zero: Vec3;
    static one: Vec3;
  }
}
`, "file:///node_modules/@typesugar/math/index.d.ts");

  // @typesugar/strings - String utilities
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/strings" {
  // String interpolation
  export function fmt(strings: TemplateStringsArray, ...values: any[]): string;
  export function dedent(strings: TemplateStringsArray, ...values: any[]): string;
  export function indent(s: string, spaces: number): string;

  // Formatting
  export function pluralize(word: string, count: number): string;
  export function truncate(s: string, maxLength: number, suffix?: string): string;
  export function wordWrap(s: string, width: number): string;

  // Escaping
  export function escapeHtml(s: string): string;
  export function unescapeHtml(s: string): string;
  export function escapeRegex(s: string): string;

  // Comparison
  export function levenshtein(a: string, b: string): number;
  export function fuzzyMatch(pattern: string, text: string): boolean;
  export function similarity(a: string, b: string): number;
}
`, "file:///node_modules/@typesugar/strings/index.d.ts");

  // @typesugar/parser - Parser combinators
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/parser" {
  export interface Parser<A> {
    parse(input: string): ParseResult<A>;
    map<B>(f: (a: A) => B): Parser<B>;
    flatMap<B>(f: (a: A) => Parser<B>): Parser<B>;
    or(other: Parser<A>): Parser<A>;
    many(): Parser<A[]>;
    many1(): Parser<A[]>;
    optional(): Parser<A | undefined>;
    sepBy(sep: Parser<any>): Parser<A[]>;
    between(left: Parser<any>, right: Parser<any>): Parser<A>;
  }

  export type ParseResult<A> =
    | { success: true; value: A; rest: string }
    | { success: false; error: string; position: number };

  export function str(s: string): Parser<string>;
  export function regex(r: RegExp): Parser<string>;
  export function digit(): Parser<string>;
  export function letter(): Parser<string>;
  export function whitespace(): Parser<string>;
  export function eof(): Parser<void>;
  export function satisfy(pred: (char: string) => boolean): Parser<string>;
  export function seq<T extends Parser<any>[]>(...parsers: T): Parser<{ [K in keyof T]: T[K] extends Parser<infer U> ? U : never }>;
  export function choice<T extends Parser<any>[]>(...parsers: T): Parser<T[number] extends Parser<infer U> ? U : never>;
  export function lazy<A>(fn: () => Parser<A>): Parser<A>;
}
`, "file:///node_modules/@typesugar/parser/index.d.ts");

  // @typesugar/codec - Encoding/decoding
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/codec" {
  export interface Codec<A> {
    encode(value: A): string;
    decode(data: string): A;
  }

  export const json: <A>() => Codec<A>;
  export const base64: Codec<Uint8Array>;
  export const hex: Codec<Uint8Array>;
  export const url: Codec<Record<string, string>>;
}
`, "file:///node_modules/@typesugar/codec/index.d.ts");

  // @typesugar/type-system - Type-level utilities
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(`
declare module "@typesugar/type-system" {
  // HKT marker
  export type _ = { readonly _: unique symbol };

  // Type-level utilities
  export type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;
  export type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never;
  export type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;
  export type Init<T extends any[]> = T extends [...infer I, any] ? I : never;
  export type Length<T extends any[]> = T["length"];
  export type Reverse<T extends any[]> = T extends [infer H, ...infer R] ? [...Reverse<R>, H] : [];
  export type Concat<A extends any[], B extends any[]> = [...A, ...B];

  // Conditional types
  export type If<C extends boolean, T, F> = C extends true ? T : F;
  export type Not<T extends boolean> = T extends true ? false : true;
  export type And<A extends boolean, B extends boolean> = A extends true ? B : false;
  export type Or<A extends boolean, B extends boolean> = A extends true ? true : B;

  // Object utilities
  export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
  export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
  export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
  export type DeepMutable<T> = T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
}
`, "file:///node_modules/@typesugar/type-system/index.d.ts");
}

// TypeScript lib files to load from CDN for full intellisense
const TS_VERSION = "5.8.3";
const TS_LIB_FILES = [
  "lib.es5.d.ts",
  "lib.es2015.d.ts",
  "lib.es2015.core.d.ts",
  "lib.es2015.collection.d.ts",
  "lib.es2015.generator.d.ts",
  "lib.es2015.iterable.d.ts",
  "lib.es2015.promise.d.ts",
  "lib.es2015.proxy.d.ts",
  "lib.es2015.reflect.d.ts",
  "lib.es2015.symbol.d.ts",
  "lib.es2015.symbol.wellknown.d.ts",
  "lib.es2016.d.ts",
  "lib.es2016.array.include.d.ts",
  "lib.es2017.d.ts",
  "lib.es2017.object.d.ts",
  "lib.es2017.sharedmemory.d.ts",
  "lib.es2017.string.d.ts",
  "lib.es2017.intl.d.ts",
  "lib.es2017.typedarrays.d.ts",
  "lib.es2018.d.ts",
  "lib.es2018.asyncgenerator.d.ts",
  "lib.es2018.asynciterable.d.ts",
  "lib.es2018.intl.d.ts",
  "lib.es2018.promise.d.ts",
  "lib.es2018.regexp.d.ts",
  "lib.es2019.d.ts",
  "lib.es2019.array.d.ts",
  "lib.es2019.object.d.ts",
  "lib.es2019.string.d.ts",
  "lib.es2019.symbol.d.ts",
  "lib.es2019.intl.d.ts",
  "lib.es2020.d.ts",
  "lib.es2020.bigint.d.ts",
  "lib.es2020.intl.d.ts",
  "lib.es2020.promise.d.ts",
  "lib.es2020.sharedmemory.d.ts",
  "lib.es2020.string.d.ts",
  "lib.es2020.symbol.wellknown.d.ts",
  "lib.es2021.d.ts",
  "lib.es2021.promise.d.ts",
  "lib.es2021.string.d.ts",
  "lib.es2021.weakref.d.ts",
  "lib.es2021.intl.d.ts",
  "lib.es2022.d.ts",
  "lib.es2022.array.d.ts",
  "lib.es2022.error.d.ts",
  "lib.es2022.intl.d.ts",
  "lib.es2022.object.d.ts",
  "lib.es2022.regexp.d.ts",
  "lib.es2022.string.d.ts",
  "lib.dom.d.ts",
  "lib.dom.iterable.d.ts",
];

const LIB_CACHE_KEY = `typesugar-ts-libs-${TS_VERSION}`;

async function loadTypeScriptLibs(monacoInstance: typeof Monaco): Promise<void> {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;

  // Check sessionStorage cache first
  let cachedLibs: Record<string, string> = {};
  try {
    const cached = sessionStorage.getItem(LIB_CACHE_KEY);
    if (cached) {
      cachedLibs = JSON.parse(cached);
      // If we have all libs cached, register them immediately
      if (Object.keys(cachedLibs).length === TS_LIB_FILES.length) {
        for (const [fileName, content] of Object.entries(cachedLibs)) {
          monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
            content,
            `file:///node_modules/typescript/lib/${fileName}`
          );
        }
        console.log(`[Playground] Loaded ${TS_LIB_FILES.length} TS lib files from cache`);
        return;
      }
    }
  } catch {
    // Cache read failed, continue to fetch
  }

  // Fetch libs from CDN (in parallel batches to avoid overwhelming the network)
  const BATCH_SIZE = 10;
  const allLibs: Record<string, string> = {};

  for (let i = 0; i < TS_LIB_FILES.length; i += BATCH_SIZE) {
    const batch = TS_LIB_FILES.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (fileName) => {
        // Check if already in partial cache
        if (cachedLibs[fileName]) {
          return { fileName, content: cachedLibs[fileName] };
        }
        const url = `https://cdn.jsdelivr.net/npm/typescript@${TS_VERSION}/lib/${fileName}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${fileName}: ${response.status}`);
        }
        const content = await response.text();
        return { fileName, content };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { fileName, content } = result.value;
        allLibs[fileName] = content;
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
          content,
          `file:///node_modules/typescript/lib/${fileName}`
        );
      } else {
        console.warn(`[Playground] Failed to load lib file:`, result.reason);
      }
    }
  }

  // Cache in sessionStorage
  try {
    sessionStorage.setItem(LIB_CACHE_KEY, JSON.stringify(allLibs));
    console.log(`[Playground] Loaded and cached ${Object.keys(allLibs).length} TS lib files`);
  } catch {
    // sessionStorage full or unavailable
    console.log(`[Playground] Loaded ${Object.keys(allLibs).length} TS lib files (cache write failed)`);
  }
}

// ---------------------------------------------------------------------------
// Server Compilation
// ---------------------------------------------------------------------------

interface ServerCompileResult {
  code: string;
  diagnostics: TransformResult["diagnostics"];
  changed: boolean;
  cached?: boolean;
  compileTimeMs?: number;
}

// Client-side cache for compiled results (LRU, 50 entries)
const compileCache = new Map<string, ServerCompileResult>();
const COMPILE_CACHE_MAX_SIZE = 50;

function fnv1aHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

function getCacheKey(code: string, fileName: string): string {
  return fnv1aHash(code + "\0" + fileName);
}

function getFromCompileCache(key: string): ServerCompileResult | undefined {
  const entry = compileCache.get(key);
  if (!entry) return undefined;
  // Move to end (most recently used)
  compileCache.delete(key);
  compileCache.set(key, entry);
  return entry;
}

function setInCompileCache(key: string, value: ServerCompileResult): void {
  if (compileCache.has(key)) {
    compileCache.delete(key);
  }
  compileCache.set(key, value);
  if (compileCache.size > COMPILE_CACHE_MAX_SIZE) {
    const oldest = compileCache.keys().next().value;
    if (oldest) compileCache.delete(oldest);
  }
}

const COMPILE_TIMEOUT_MS = 10000; // 10 second timeout

async function compileCodeOnServer(
  code: string,
  fileName: string
): Promise<ServerCompileResult | null> {
  // Check client-side cache first
  const cacheKey = getCacheKey(code, fileName);
  const cached = getFromCompileCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);

  try {
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, fileName }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 429) {
        console.warn("[Playground] Server rate limited, using fallback");
      } else {
        console.warn(`[Playground] Server compile failed: ${response.status}`);
      }
      return null;
    }

    // Log server cache status for debugging
    const serverCached = response.headers.get("X-Compile-Cached") === "true";
    if (serverCached) {
      console.log("[Playground] Server returned cached result");
    }

    const result = (await response.json()) as ServerCompileResult;

    // Cache the result
    setInCompileCache(cacheKey, result);

    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[Playground] Server compile timed out, using fallback");
    } else {
      console.warn("[Playground] Server compile error:", err);
    }
    return null;
  }
}

async function warmUpServer(): Promise<void> {
  try {
    const response = await fetch("/api/compile", { method: "GET" });
    if (response.ok) {
      console.log("[Playground] Server warmed up");
    }
  } catch {
    console.log("[Playground] Server warm-up failed (may be offline)");
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function doTransform() {
  if (!inputEditor.value) return;

  const code = inputEditor.value.getValue();
  transformError.value = null;
  isTransforming.value = true;
  serverCompilationFailed.value = false;

  const start = performance.now();

  // Try server compilation first if enabled and available
  if (useServerCompilation.value && isServerAvailable.value) {
    const serverResult = await compileCodeOnServer(code, fileName.value);
    if (serverResult) {
      transformTime.value = serverResult.compileTimeMs ?? Math.round(performance.now() - start);

      // Add line/column info to diagnostics
      const diagnostics = serverResult.diagnostics?.map((d) => {
        const model = inputEditor.value?.getModel();
        if (model && typeof d.start === "number") {
          const pos = model.getPositionAt(d.start);
          return { ...d, line: pos.lineNumber, column: pos.column };
        }
        return d;
      }) ?? [];

      lastResult.value = {
        original: code,
        code: serverResult.code,
        changed: serverResult.changed,
        diagnostics,
      };
      outputEditor.value?.setValue(serverResult.code);

      if (diagnostics.length > 0) {
        transformError.value = diagnostics.map((d) => d.message).join("; ");
      }

      isTransforming.value = false;
      return;
    }

    // Server compilation failed, mark as unavailable and fall back
    isServerAvailable.value = false;
    serverCompilationFailed.value = true;
    console.log("[Playground] Server unavailable, using browser fallback");
  }

  // Fallback to browser-based transformation
  if (!playground.value) {
    transformError.value = "Playground not loaded";
    isTransforming.value = false;
    return;
  }

  try {
    const result = playground.value.transform(code, {
      fileName: fileName.value,
      verbose: false,
    });
    transformTime.value = Math.round(performance.now() - start);

    // Add line/column info to diagnostics
    if (result.diagnostics) {
      result.diagnostics = result.diagnostics.map((d) => {
        const model = inputEditor.value?.getModel();
        if (model && typeof d.start === "number") {
          const pos = model.getPositionAt(d.start);
          return { ...d, line: pos.lineNumber, column: pos.column };
        }
        return d;
      });
    }

    lastResult.value = result;
    outputEditor.value?.setValue(result.code);

    if (result.diagnostics.length > 0) {
      transformError.value = result.diagnostics.map((d) => d.message).join("; ");
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    transformError.value = err.message;
  } finally {
    isTransforming.value = false;
  }
}

function scheduleTransform() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(doTransform, 300);
}

async function loadPlayground() {
  try {
    loadingProgress.value = 20;
    loadingMessage.value = "Loading TypeScript...";
    const ts = await import("typescript");
    (window as Record<string, unknown>).ts = ts;

    loadingProgress.value = 50;
    loadingMessage.value = "Loading transformer...";
    const playgroundModule = await import("@typesugar/playground");
    playground.value = playgroundModule;

    loadingProgress.value = 70;
    loadingMessage.value = "Loading runtime libraries...";
    const runtimeMod = await import("../../../packages/playground/dist/runtime.global.js?raw");
    runtimeCode.value = runtimeMod.default;

    loadingProgress.value = 80;
    loadingMessage.value = "Ready";
  } catch (e) {
    console.error("Failed to load playground:", e);
    transformError.value = `Failed to load playground: ${e}`;
  }
}

function createSandboxHtml(code: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { margin: 0; font-family: monospace; }</style>
</head>
<body>
<script>
// Console capture
const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
['log', 'error', 'warn', 'info'].forEach(method => {
  console[method] = (...args) => {
    originalConsole[method](...args);
    parent.postMessage({ type: 'console', method, args: args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch { return String(a); }
    })}, '*');
  };
});

// Error capture
window.onerror = (msg, url, line, col, err) => {
  parent.postMessage({ type: 'console', method: 'error', args: [\`Error: \${msg} (line \${line})\`] }, '*');
  return true;
};

window.onunhandledrejection = (e) => {
  parent.postMessage({ type: 'console', method: 'error', args: [\`Unhandled rejection: \${e.reason}\`] }, '*');
};

// Browser shims for Node.js globals used by bundled dependencies
if (typeof process === 'undefined') {
  window.process = { env: {}, argv: [], platform: 'browser', version: '', stdout: {}, stderr: {} };
}
if (typeof global === 'undefined') {
  window.global = window;
}
<\/script>
${runtimeCode.value ? `<script>${runtimeCode.value}<\/script>` : ""}
<script>
// Execution timeout
const __timeout = setTimeout(() => {
  parent.postMessage({ type: 'console', method: 'error', args: ['Execution timeout (5s)'] }, '*');
  parent.postMessage({ type: 'done' }, '*');
}, 5000);

try {
  ${code}
  clearTimeout(__timeout);
  parent.postMessage({ type: 'done' }, '*');
} catch (e) {
  clearTimeout(__timeout);
  parent.postMessage({ type: 'console', method: 'error', args: [e.message || String(e)] }, '*');
  parent.postMessage({ type: 'done' }, '*');
}
<\/script>
</body>
</html>`;
}

async function runCode() {
  if (!lastResult.value || isRunning.value) return;

  isRunning.value = true;
  consoleMessages.value = [];
  showConsole.value = true;

  const tsCode = lastResult.value.code;

  // Use TypeScript to transpile to JavaScript
  let jsCode: string;
  try {
    const ts = (window as Record<string, unknown>).ts as typeof import("typescript");
    if (ts && ts.transpileModule) {
      const result = ts.transpileModule(tsCode, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          removeComments: false,
        },
      });
      jsCode = result.outputText;
    } else {
      jsCode = tsCode;
    }
  } catch (e) {
    jsCode = tsCode;
  }

  // Rewrite @typesugar/* imports to use the runtime registry.
  // Other imports (macro imports already expanded by transformer) get stripped.
  jsCode = jsCode.replace(
    /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
    (_match, bindings: string, specifier: string) => {
      if (specifier === "typesugar" || specifier.startsWith("@typesugar/")) {
        const trimmed = bindings.trim();
        // import * as X from "..." → const X = globalThis.__typesugar_modules["..."];
        const nsMatch = trimmed.match(/^\*\s+as\s+(\w+)$/);
        if (nsMatch) {
          return `const ${nsMatch[1]} = globalThis.__typesugar_modules["${specifier}"];`;
        }
        // import { A, B, C } from "..." → const { A, B, C } = globalThis.__typesugar_modules["..."];
        const namedMatch = trimmed.match(/^\{(.+)\}$/);
        if (namedMatch) {
          return `const { ${namedMatch[1]} } = globalThis.__typesugar_modules["${specifier}"];`;
        }
        // import X from "..." → const X = globalThis.__typesugar_modules["..."].default;
        return `const ${trimmed} = globalThis.__typesugar_modules["${specifier}"].default;`;
      }
      return "";
    }
  );
  // Remove export keywords
  jsCode = jsCode.replace(/^export\s+/gm, "");

  const html = createSandboxHtml(jsCode);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  // Track if execution completed normally
  let executionCompleted = false;

  const messageHandler = (event: MessageEvent) => {
    // Only handle messages from our blob URL or same origin
    if (event.source !== sandboxIframe.value?.contentWindow) {
      return;
    }

    if (event.data.type === "console") {
      consoleMessages.value.push({
        type: event.data.method,
        args: event.data.args,
        timestamp: Date.now(),
      });
    } else if (event.data.type === "done") {
      executionCompleted = true;
      isRunning.value = false;
      window.removeEventListener("message", messageHandler);
      URL.revokeObjectURL(url);
    }
  };

  // Set up message handler BEFORE loading the iframe to avoid race condition
  window.addEventListener("message", messageHandler);

  // Now load the iframe
  if (sandboxIframe.value) {
    sandboxIframe.value.src = url;
  }

  // Fallback timeout - handles cases where iframe execution hangs (e.g., infinite loops)
  // The iframe's internal 5s timeout can't fire for sync infinite loops, so this catches them
  setTimeout(() => {
    if (isRunning.value) {
      // Only show timeout message if execution didn't complete normally
      if (!executionCompleted) {
        consoleMessages.value.push({
          type: "error",
          args: ["Execution timed out (code may contain an infinite loop)"],
          timestamp: Date.now(),
        });
      }
      isRunning.value = false;
      window.removeEventListener("message", messageHandler);
      URL.revokeObjectURL(url);
    }
  }, 6000);
}

// --- Sharing Functions ---

function buildShareUrl(): string {
  const code = inputEditor.value?.getValue() ?? "";
  const compressed = compressToEncodedURIComponent(code);
  const params = new URLSearchParams({
    code: compressed,
    mode: fileType.value,
    ts: tsVersion.value,
  });
  return `${window.location.origin}${window.location.pathname}#${params.toString()}`;
}

function copyShareUrl() {
  const url = buildShareUrl();
  navigator.clipboard.writeText(url).then(() => {
    showTooltip("Link copied!");
    // Update URL without reload
    history.replaceState(null, "", url);
  }).catch(() => {
    showTooltip("Failed to copy");
  });
}

function copyCode() {
  const code = inputEditor.value?.getValue() ?? "";
  navigator.clipboard.writeText(code).then(() => {
    showTooltip("Code copied!");
  }).catch(() => {
    showTooltip("Failed to copy");
  });
}

function copyOutputCode() {
  const code = outputEditor.value?.getValue() ?? "";
  navigator.clipboard.writeText(code).then(() => {
    showTooltip("Output copied!");
  }).catch(() => {
    showTooltip("Failed to copy");
  });
}

function showTooltip(message: string) {
  shareTooltip.value = message;
  setTimeout(() => {
    shareTooltip.value = null;
  }, 2000);
}

function loadFromUrl(): boolean {
  if (typeof window === "undefined") return false;

  const hash = window.location.hash.slice(1);
  if (!hash) return false;

  try {
    const params = new URLSearchParams(hash);
    const compressedCode = params.get("code");
    const mode = params.get("mode") as ".ts" | ".sts" | null;
    const ts = params.get("ts");

    if (compressedCode) {
      // Try lz-string decompression first
      let code = decompressFromEncodedURIComponent(compressedCode);

      // Fallback to old base64 format for backwards compatibility
      if (!code) {
        try {
          code = decodeURIComponent(atob(compressedCode));
        } catch {
          code = null;
        }
      }

      if (code) {
        inputEditor.value?.setValue(code);
      }
    }
    if (mode === ".ts" || mode === ".sts") {
      fileType.value = mode;
    }
    if (ts) {
      tsVersion.value = ts;
    }
    return true;
  } catch (e) {
    console.error("Failed to load from URL:", e);
    return false;
  }
}

// --- LocalStorage Persistence ---

function saveToStorage() {
  if (typeof localStorage === "undefined") return;

  try {
    const code = inputEditor.value?.getValue() ?? "";
    localStorage.setItem(STORAGE_KEYS.code, code);
    localStorage.setItem(STORAGE_KEYS.fileType, fileType.value);
    localStorage.setItem(STORAGE_KEYS.tsVersion, tsVersion.value);
    localStorage.setItem(STORAGE_KEYS.showConsole, String(showConsole.value));
  } catch (e) {
    console.warn("Failed to save to localStorage:", e);
  }
}

function loadFromStorage(): boolean {
  if (typeof localStorage === "undefined") return false;

  try {
    const savedCode = localStorage.getItem(STORAGE_KEYS.code);
    const savedFileType = localStorage.getItem(STORAGE_KEYS.fileType) as ".ts" | ".sts" | null;
    const savedTsVersion = localStorage.getItem(STORAGE_KEYS.tsVersion);
    const savedShowConsole = localStorage.getItem(STORAGE_KEYS.showConsole);

    if (savedCode && inputEditor.value) {
      inputEditor.value.setValue(savedCode);
    }
    if (savedFileType === ".ts" || savedFileType === ".sts") {
      fileType.value = savedFileType;
    }
    if (savedTsVersion) {
      tsVersion.value = savedTsVersion;
    }
    if (savedShowConsole !== null) {
      showConsole.value = savedShowConsole === "true";
    }

    return !!savedCode;
  } catch (e) {
    console.warn("Failed to load from localStorage:", e);
    return false;
  }
}

// --- Example Presets ---

function loadPreset(preset: ExamplePreset) {
  inputEditor.value?.setValue(preset.code);
  fileType.value = preset.fileType;
  selectedPreset.value = preset.name;
  showPresetsDropdown.value = false;

  // Update language if needed
  if (inputEditor.value && monaco.value) {
    const model = inputEditor.value.getModel();
    if (model) {
      monaco.value.editor.setModelLanguage(model, preset.fileType === ".sts" ? "sts" : "typescript");
    }
  }

  doTransform();
}

function togglePresetsDropdown() {
  showPresetsDropdown.value = !showPresetsDropdown.value;
}

function closePresetsDropdown() {
  showPresetsDropdown.value = false;
}

function clearConsole() {
  consoleMessages.value = [];
}

function goToErrorLine(line?: number) {
  if (line && inputEditor.value) {
    inputEditor.value.revealLineInCenter(line);
    inputEditor.value.setPosition({ lineNumber: line, column: 1 });
    inputEditor.value.focus();
  }
}

async function initMonaco() {
  if (typeof window === "undefined") return;

  try {
    loadingProgress.value = 5;
    loadingMessage.value = "Loading editor...";
    const loader = await import("@monaco-editor/loader");

    loadingProgress.value = 10;
    loadingMessage.value = "Initializing Monaco...";
    const monacoInstance = await loader.default.init();
    monaco.value = monacoInstance;

    loadingProgress.value = 15;
    loadingMessage.value = "Configuring syntax...";
    registerStsLanguage(monacoInstance);
    registerTypesugarTypes(monacoInstance);

    // Load TypeScript lib files in background (non-blocking)
    // Editor works immediately, intellisense improves as libs load
    loadTypeScriptLibs(monacoInstance).catch((err) => {
      console.warn("[Playground] Failed to load TS lib files:", err);
    });

    // Warm up the server compilation endpoint (non-blocking)
    warmUpServer();

    await loadPlayground();

    const isDark = document.documentElement.classList.contains("dark");
    const theme = isDark ? "typesugar-dark" : "typesugar-light";

    if (inputContainer.value) {
      inputEditor.value = monacoInstance.editor.create(inputContainer.value, {
        value: props.initialCode,
        language: fileType.value === ".sts" ? "sts" : "typescript",
        theme,
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        padding: { top: 12, bottom: 12 },
      });

      inputEditor.value.onDidChangeModelContent(() => {
        scheduleTransform();
        scheduleSave();
      });

      // Keyboard shortcuts
      inputEditor.value.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
        () => runCode()
      );
      inputEditor.value.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        () => copyShareUrl()
      );
    }

    if (outputContainer.value) {
      outputEditor.value = monacoInstance.editor.create(outputContainer.value, {
        value: "",
        language: "javascript",
        theme,
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        readOnly: true,
        padding: { top: 12, bottom: 12 },
      });
    }

    loadingProgress.value = 90;
    loadingMessage.value = "Loading saved state...";

    // Priority: URL hash > localStorage > default
    const loadedFromUrl = loadFromUrl();
    if (!loadedFromUrl) {
      const loadedFromStorage = loadFromStorage();
      if (!loadedFromStorage) {
        // Keep the default initialCode from props
      }
    }

    // Update language based on loaded fileType
    if (inputEditor.value && monaco.value) {
      const model = inputEditor.value.getModel();
      if (model) {
        monacoInstance.editor.setModelLanguage(model, fileType.value === ".sts" ? "sts" : "typescript");
      }
    }

    loadingProgress.value = 100;
    loadingMessage.value = "Ready";
    isLoading.value = false;

    doTransform();

    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      const newTheme = isDark ? "typesugar-dark" : "typesugar-light";
      monacoInstance.editor.setTheme(newTheme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // Close presets dropdown when clicking outside
    document.addEventListener("click", handleDocumentClick);
  } catch (e) {
    console.error("Failed to initialize Monaco:", e);
    transformError.value = `Failed to load editor: ${e}`;
    isLoading.value = false;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(saveToStorage, 1000);
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest(".presets-dropdown-container")) {
    showPresetsDropdown.value = false;
  }
}

function setFileType(type: ".ts" | ".sts") {
  fileType.value = type;
  if (inputEditor.value && monaco.value) {
    const model = inputEditor.value.getModel();
    if (model) {
      monaco.value.editor.setModelLanguage(model, type === ".sts" ? "sts" : "typescript");
    }
  }
  doTransform();
}

watch(fileType, (newType) => {
  if (inputEditor.value && monaco.value) {
    const model = inputEditor.value.getModel();
    if (model) {
      monaco.value.editor.setModelLanguage(model, newType === ".sts" ? "sts" : "typescript");
    }
  }
  saveToStorage();
});

watch(tsVersion, () => {
  saveToStorage();
});

watch(showConsole, () => {
  saveToStorage();
});

onMounted(() => {
  initMonaco();
});

onUnmounted(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  document.removeEventListener("click", handleDocumentClick);
  inputEditor.value?.dispose();
  outputEditor.value?.dispose();
});
</script>

<template>
  <ErrorBoundary
    fallback-message="The playground encountered an error. Please try refreshing the page."
  >
    <div
      class="playground-container"
      role="application"
      aria-label="typesugar Interactive Playground"
    >
      <!-- Skip link for keyboard navigation -->
      <a href="#input-editor" class="skip-link">Skip to editor</a>

      <!-- Tooltip for copy feedback -->
      <Transition name="tooltip">
        <div v-if="shareTooltip" class="share-tooltip" role="status" aria-live="polite">
          {{ shareTooltip }}
        </div>
      </Transition>

      <!-- Toolbar -->
      <div class="toolbar" role="toolbar" aria-label="Playground controls">
        <div class="toolbar-left">
          <!-- Example Presets Dropdown -->
          <div class="presets-dropdown-container">
            <button
              class="presets-btn"
              @click="togglePresetsDropdown"
              :aria-expanded="showPresetsDropdown"
              aria-haspopup="listbox"
              aria-label="Load example preset"
            >
              <span class="presets-icon" aria-hidden="true">📚</span>
              Examples
              <span class="dropdown-arrow" aria-hidden="true">▼</span>
            </button>
            <Transition name="dropdown">
              <div
                v-if="showPresetsDropdown"
                class="presets-dropdown"
                role="listbox"
                aria-label="Example presets"
              >
                <template v-for="group in EXAMPLE_GROUPS" :key="group.label">
                  <div class="preset-group-header">{{ group.label }}</div>
                  <button
                    v-for="preset in group.presets"
                    :key="preset.name"
                    class="preset-item"
                    :class="{ active: selectedPreset === preset.name }"
                    :aria-selected="selectedPreset === preset.name"
                    role="option"
                    @click="loadPreset(preset)"
                  >
                    <span class="preset-name">{{ preset.name }}</span>
                    <span class="preset-type">{{ preset.fileType }}</span>
                    <span class="preset-desc">{{ preset.description }}</span>
                  </button>
                </template>
              </div>
            </Transition>
          </div>

          <div class="file-type-toggle" role="radiogroup" aria-label="File type">
            <button
              :class="{ active: fileType === '.ts' }"
              :aria-pressed="fileType === '.ts'"
              role="radio"
              :aria-checked="fileType === '.ts'"
              @click="setFileType('.ts')"
              aria-label="TypeScript mode - JSDoc macros only"
            >
              .ts
            </button>
            <button
              :class="{ active: fileType === '.sts' }"
              :aria-pressed="fileType === '.sts'"
              role="radio"
              :aria-checked="fileType === '.sts'"
              @click="setFileType('.sts')"
              aria-label="Sugar TypeScript mode - custom syntax"
            >
              .sts
            </button>
          </div>

          <select v-model="tsVersion" class="ts-version-select" aria-label="TypeScript version">
            <option value="5.8">TypeScript 5.8</option>
            <option value="5.7">TypeScript 5.7</option>
            <option value="5.6">TypeScript 5.6</option>
          </select>
        </div>

        <div class="toolbar-center">
          <div
            class="status"
            :class="statusClass"
            role="status"
            aria-live="polite"
            :aria-busy="isTransforming"
          >
            <span v-if="isTransforming" class="status-spinner" aria-hidden="true"></span>
            {{ statusText }}
          </div>
        </div>

        <div class="toolbar-right">
          <button
            class="run-btn"
            @click="runCode"
            :disabled="isRunning || !lastResult"
            :aria-disabled="isRunning || !lastResult"
            aria-label="Run code, keyboard shortcut Command Enter"
          >
            <span v-if="isRunning" class="spinner" aria-hidden="true"></span>
            <span v-else aria-hidden="true">▶</span>
            Run
          </button>
          <div class="share-buttons">
            <button
              class="share-btn"
              @click="copyShareUrl"
              aria-label="Copy share URL, keyboard shortcut Command S"
            >
              <span aria-hidden="true">🔗</span> Share
            </button>
            <button class="copy-btn" @click="copyCode" aria-label="Copy input code to clipboard">
              <span aria-hidden="true">📋</span> Copy
            </button>
          </div>
        </div>
      </div>

      <!-- Main content area -->
      <main class="main-content">
        <!-- Editors -->
        <div class="editors-container">
          <div class="editor-panel input-panel">
            <div class="panel-header">
              <span class="panel-title" id="input-editor-label">Input</span>
              <span class="panel-filename">{{ fileName }}</span>
            </div>
            <div
              id="input-editor"
              ref="inputContainer"
              class="editor-container"
              role="textbox"
              aria-multiline="true"
              aria-labelledby="input-editor-label"
              @keydown.stop
              @keypress.stop
              tabindex="0"
            />
          </div>

          <div class="editor-panel output-panel">
            <div class="panel-header">
              <div class="output-tabs" role="tablist" aria-label="Output view tabs">
                <button
                  :class="{ active: activeTab === 'js' }"
                  @click="activeTab = 'js'"
                  role="tab"
                  :aria-selected="activeTab === 'js'"
                  aria-controls="output-js-panel"
                  id="output-js-tab"
                >
                  JS Output
                </button>
                <button
                  :class="{ active: activeTab === 'errors' }"
                  @click="activeTab = 'errors'"
                  role="tab"
                  :aria-selected="activeTab === 'errors'"
                  aria-controls="output-errors-panel"
                  id="output-errors-tab"
                >
                  Errors
                  <span v-if="errorCount > 0" class="error-badge" aria-label="error count">{{
                    errorCount
                  }}</span>
                </button>
              </div>
              <span class="panel-filename">{{ fileName.replace(/\.sts$/, ".js") }}</span>
            </div>

            <div
              v-show="activeTab === 'js'"
              ref="outputContainer"
              class="editor-container"
              id="output-js-panel"
              role="tabpanel"
              aria-labelledby="output-js-tab"
              @keydown.stop
              @keypress.stop
            />

            <div
              v-show="activeTab === 'errors'"
              class="errors-container"
              id="output-errors-panel"
              role="tabpanel"
              aria-labelledby="output-errors-tab"
            >
              <div v-if="errorCount === 0" class="no-errors" role="status">No errors</div>
              <div v-else class="error-list" role="list" aria-label="Transformation errors">
                <button
                  v-for="(diag, i) in lastResult?.diagnostics"
                  :key="i"
                  class="error-item"
                  :class="diag.severity"
                  role="listitem"
                  @click="goToErrorLine(diag.line)"
                  :aria-label="`${diag.severity} on line ${diag.line}: ${diag.message}`"
                >
                  <div class="error-location">
                    <span class="error-severity">{{ diag.severity }}</span>
                    <span v-if="diag.line" class="error-line">Line {{ diag.line }}</span>
                  </div>
                  <div class="error-message">{{ diag.message }}</div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Console -->
        <section v-show="showConsole" class="console-panel" aria-label="Console output">
          <div class="console-header">
            <span class="console-title" id="console-title">Console</span>
            <div class="console-actions">
              <button @click="clearConsole" aria-label="Clear console output">Clear</button>
              <button @click="showConsole = false" aria-label="Hide console panel">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
          <div class="console-output" role="log" aria-live="polite" aria-labelledby="console-title">
            <div v-if="consoleMessages.length === 0" class="console-placeholder">
              Press Run (Cmd+Enter) to execute the code
            </div>
            <div
              v-for="(msg, i) in consoleMessages"
              :key="i"
              class="console-message"
              :class="msg.type"
              :role="msg.type === 'error' ? 'alert' : undefined"
            >
              <span class="console-type" aria-hidden="true">[{{ msg.type }}]</span>
              <span class="console-text">{{ msg.args.join(" ") }}</span>
            </div>
          </div>
        </section>

        <!-- Toggle console button when hidden -->
        <button
          v-if="!showConsole"
          class="show-console-btn"
          @click="showConsole = true"
          aria-label="Show console panel"
        >
          Show Console
        </button>
      </main>

      <!-- Hidden sandbox iframe -->
      <iframe
        ref="sandboxIframe"
        class="sandbox-iframe"
        sandbox="allow-scripts"
        title="Code execution sandbox"
        aria-hidden="true"
      />

      <!-- Loading overlay -->
      <div
        v-if="isLoading"
        class="loading-overlay"
        role="progressbar"
        :aria-valuenow="loadingProgress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Loading playground"
      >
        <div class="loading-content">
          <div class="loading-spinner" aria-hidden="true"></div>
          <div class="loading-text">{{ loadingMessage }}</div>
          <div class="loading-progress-bar">
            <div class="loading-progress-fill" :style="{ width: `${loadingProgress}%` }"></div>
          </div>
          <div class="loading-progress-text">{{ loadingProgress }}%</div>
        </div>
      </div>
    </div>
  </ErrorBoundary>
</template>

<style scoped>
/* Skip link for keyboard navigation */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--vp-c-brand-1);
  color: white;
  padding: 8px 16px;
  z-index: 1000;
  border-radius: 0 0 6px 0;
  text-decoration: none;
  font-weight: 500;
  transition: top 0.2s;
}

.skip-link:focus {
  top: 0;
  outline: 2px solid var(--vp-c-brand-2);
  outline-offset: 2px;
}

.playground-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 64px);
  min-height: 600px;
  background: var(--vp-c-bg);
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  flex-shrink: 0;
  gap: 16px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.file-type-toggle {
  display: flex;
  gap: 4px;
}

.file-type-toggle button {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.file-type-toggle button:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.file-type-toggle button.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.ts-version-select {
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.ts-version-select:hover {
  background: var(--vp-c-bg-mute);
}

.status {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  padding: 4px 12px;
  border-radius: 4px;
  background: var(--vp-c-bg);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status.loading {
  color: var(--vp-c-text-2);
}
.status.transforming {
  color: var(--vp-c-brand-1);
}
.status.success {
  color: var(--vp-c-green-1);
}
.status.error {
  color: var(--vp-c-red-1);
}

.status-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--vp-c-divider);
  border-top-color: var(--vp-c-brand-1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.run-btn,
.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.run-btn {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: white;
}

.run-btn:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
}

.run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.share-btn {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.share-btn:hover {
  background: var(--vp-c-bg-mute);
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.editors-container {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--vp-c-divider);
  min-height: 0;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
  min-height: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vp-c-text-2);
}

.panel-filename {
  font-size: 11px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.output-tabs {
  display: flex;
  gap: 4px;
}

.output-tabs button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.output-tabs button:hover {
  background: var(--vp-c-bg-mute);
}

.output-tabs button.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.error-badge {
  background: var(--vp-c-red-1);
  color: white;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}

.editor-container {
  flex: 1;
  min-height: 0;
}

.errors-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.no-errors {
  color: var(--vp-c-text-3);
  font-size: 14px;
  text-align: center;
  padding: 40px;
}

.error-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

button.error-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px;
  background: var(--vp-c-bg-soft);
  border-radius: 6px;
  border: none;
  border-left: 3px solid var(--vp-c-red-1);
  cursor: pointer;
  transition: background 0.2s;
  font-family: inherit;
  font-size: inherit;
}

button.error-item:hover {
  background: var(--vp-c-bg-mute);
}

button.error-item:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

button.error-item.warning {
  border-left-color: var(--vp-c-yellow-1);
}

.error-location {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}

.error-severity {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vp-c-red-1);
}

.error-item.warning .error-severity {
  color: var(--vp-c-yellow-1);
}

.error-line {
  font-size: 11px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.error-message {
  font-size: 13px;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  line-height: 1.5;
}

.console-panel {
  height: 200px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  flex-shrink: 0;
}

.console-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.console-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vp-c-text-2);
}

.console-actions {
  display: flex;
  gap: 8px;
}

.console-actions button {
  padding: 2px 8px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
}

.console-actions button:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.console-output {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}

.console-placeholder {
  color: var(--vp-c-text-3);
  font-style: italic;
}

.console-message {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.console-message:last-child {
  border-bottom: none;
}

.console-type {
  color: var(--vp-c-text-3);
  flex-shrink: 0;
  font-size: 11px;
}

.console-message.log .console-type {
  color: var(--vp-c-text-3);
}
.console-message.info .console-type {
  color: var(--vp-c-blue-1);
}
.console-message.warn .console-type {
  color: var(--vp-c-yellow-1);
}
.console-message.error .console-type {
  color: var(--vp-c-red-1);
}

.console-text {
  color: var(--vp-c-text-1);
  word-break: break-word;
}

.console-message.error .console-text {
  color: var(--vp-c-red-1);
}

.console-message.warn .console-text {
  color: var(--vp-c-yellow-1);
}

.show-console-btn {
  position: absolute;
  bottom: 16px;
  right: 16px;
  padding: 8px 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.show-console-btn:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.sandbox-iframe {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vp-c-bg);
  z-index: 100;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 300px;
  width: 100%;
  padding: 24px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--vp-c-divider);
  border-top-color: var(--vp-c-brand-1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  font-size: 14px;
  color: var(--vp-c-text-1);
  font-weight: 500;
  text-align: center;
}

.loading-progress-bar {
  width: 100%;
  height: 6px;
  background: var(--vp-c-divider);
  border-radius: 3px;
  overflow: hidden;
}

.loading-progress-fill {
  height: 100%;
  background: var(--vp-c-brand-1);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.loading-progress-text {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
}

/* Share tooltip */
.share-tooltip {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--vp-c-brand-1);
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tooltip-enter-active,
.tooltip-leave-active {
  transition: all 0.2s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

/* Presets dropdown */
.presets-dropdown-container {
  position: relative;
}

.presets-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.presets-btn:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.presets-icon {
  font-size: 14px;
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.6;
}

.presets-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 280px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
}

.preset-group-header {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
  border-top: 1px solid var(--vp-c-divider);
  user-select: none;
}

.preset-group-header:first-child {
  border-top: none;
}

.preset-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 16px 8px 24px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
}

.preset-item:hover {
  background: var(--vp-c-bg-soft);
}

.preset-item.active {
  background: var(--vp-c-brand-soft);
}

.preset-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.preset-type {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 1px 6px;
  border-radius: 3px;
}

.preset-desc {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Share buttons group */
.share-buttons {
  display: flex;
  gap: 4px;
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  transition: all 0.2s;
}

.copy-btn:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

/* Mobile responsiveness */
@media (max-width: 768px) {
  .playground-container {
    height: auto;
    min-height: 100vh;
  }

  .editors-container {
    grid-template-columns: 1fr;
    min-height: 400px;
  }

  .editor-panel {
    min-height: 250px;
  }

  .input-panel {
    border-right: none;
    border-bottom: 1px solid var(--vp-c-divider);
  }

  .toolbar {
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
  }

  .toolbar-left {
    flex-wrap: wrap;
    gap: 8px;
  }

  .toolbar-center {
    order: 3;
    width: 100%;
    justify-content: flex-start;
  }

  .toolbar-right {
    width: 100%;
    justify-content: space-between;
  }

  .presets-dropdown {
    min-width: 240px;
    max-width: calc(100vw - 48px);
  }

  .share-buttons {
    flex-wrap: wrap;
  }

  .file-type-toggle button {
    padding: 6px 12px;
    font-size: 12px;
  }

  .run-btn {
    flex: 1;
  }

  .console-panel {
    height: 150px;
  }

  .show-console-btn {
    bottom: 8px;
    right: 8px;
    padding: 6px 12px;
    font-size: 12px;
  }
}

@media (max-width: 480px) {
  .toolbar {
    padding: 8px;
  }

  .presets-btn {
    padding: 6px 8px;
    font-size: 12px;
  }

  .presets-icon {
    display: none;
  }

  .ts-version-select {
    padding: 4px 8px;
    font-size: 12px;
  }

  .share-btn,
  .copy-btn {
    padding: 6px 10px;
    font-size: 12px;
  }

  .status {
    font-size: 11px;
    padding: 2px 8px;
  }
}

/* Focus visible styles for better keyboard navigation */
button:focus-visible,
select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .error-badge {
    border: 1px solid white;
  }

  .file-type-toggle button.active {
    border-width: 2px;
  }

  .status {
    font-weight: 600;
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  .loading-spinner,
  .spinner,
  .status-spinner {
    animation: none;
  }

  .loading-progress-fill {
    transition: none;
  }

  .tooltip-enter-active,
  .tooltip-leave-active,
  .dropdown-enter-active,
  .dropdown-leave-active {
    transition: none;
  }
}
</style>
