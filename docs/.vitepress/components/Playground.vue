<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef, computed, nextTick } from "vue";
import type * as Monaco from "monaco-editor";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import ErrorBoundary from "./ErrorBoundary.vue";

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

interface ExamplePreset {
  name: string;
  description: string;
  fileType: ".ts" | ".sts";
  code: string;
}

const DEFAULT_CODE = `// Welcome to the typesugar Playground!
// Try editing the code below and press Run (or Cmd+Enter)

import { staticAssert } from "typesugar";

// Static assertion at compile time
staticAssert(1 + 1 === 2);

// Regular TypeScript
const greet = (name: string) => \`Hello, \${name}!\`;
console.log(greet("World"));

// Try adding more code!
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log("Doubled:", doubled);
`;

const STORAGE_KEYS = {
  code: "typesugar-playground-code",
  fileType: "typesugar-playground-fileType",
  tsVersion: "typesugar-playground-tsVersion",
  showConsole: "typesugar-playground-showConsole",
};

const EXAMPLE_PRESETS: ExamplePreset[] = [
  {
    name: "Welcome",
    description: "Introduction to the playground",
    fileType: ".ts",
    code: DEFAULT_CODE,
  },
  {
    name: "@typeclass Eq",
    description: "Define a typeclass for equality",
    fileType: ".ts",
    code: `import { typeclass, impl } from "typesugar";

/**
 * @typeclass
 * A typeclass for types that can be compared for equality
 */
interface Eq<T> {
  equals(a: T, b: T): boolean;
}

// Instance for number
/** @impl */
const EqNumber: Eq<number> = {
  equals: (a, b) => a === b,
};

// Instance for string
/** @impl */
const EqString: Eq<string> = {
  equals: (a, b) => a === b,
};

// Generic array equality (requires Eq for element type)
/** @impl */
function EqArray<T>(eq: Eq<T>): Eq<T[]> {
  return {
    equals: (a, b) => 
      a.length === b.length && 
      a.every((val, i) => eq.equals(val, b[i])),
  };
}

// Test it out
console.log("1 === 1:", EqNumber.equals(1, 1));
console.log("'hello' === 'world':", EqString.equals("hello", "world"));
console.log("[1,2,3] === [1,2,3]:", EqArray(EqNumber).equals([1,2,3], [1,2,3]));
`,
  },
  {
    name: "@derive",
    description: "Auto-generate trait implementations",
    fileType: ".ts",
    code: `import { derive, Eq, Clone, Debug } from "typesugar";

/**
 * @derive Eq, Clone, Debug
 * A simple 2D point class with auto-generated implementations
 */
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const p1 = new Point(10, 20);
const p2 = new Point(10, 20);
const p3 = new Point(5, 15);

// Derived Eq - structural equality
console.log("p1 equals p2:", p1.equals(p2)); // true
console.log("p1 equals p3:", p1.equals(p3)); // false

// Derived Clone - deep copy
const p1Clone = p1.clone();
console.log("Cloned:", p1Clone);

// Derived Debug - pretty print
console.log("Debug:", p1.debug());
`,
  },
  {
    name: "Pipeline Operator",
    description: "Chain transformations with |>",
    fileType: ".sts",
    code: `// Pipeline operator |> for readable data transformations
// (Sugar TypeScript syntax - .sts file)

const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Without pipeline - hard to read
const result1 = numbers
  .filter(n => n % 2 === 0)
  .map(n => n * 2)
  .reduce((a, b) => a + b, 0);

// With pipeline - clear data flow
const result2 = numbers
  |> (nums => nums.filter(n => n % 2 === 0))
  |> (nums => nums.map(n => n * 2))
  |> (nums => nums.reduce((a, b) => a + b, 0));

console.log("Result:", result2); // 60 (2+4+6+8+10 doubled)

// Works great with custom functions
const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;
const toString = (x: number) => \`Value: \${x}\`;

const transformed = 5
  |> double
  |> addOne
  |> toString;

console.log(transformed); // "Value: 11"
`,
  },
  {
    name: "@extension",
    description: "Add methods to existing types",
    fileType: ".ts",
    code: `import { extension } from "typesugar";

/**
 * @extension Array
 * Add useful methods to arrays
 */
interface ArrayExtensions<T> {
  first(): T | undefined;
  last(): T | undefined;
  isEmpty(): boolean;
  sum(this: number[]): number;
  groupBy<K extends string | number>(fn: (item: T) => K): Record<K, T[]>;
}

// Now use the extensions
const numbers = [1, 2, 3, 4, 5];

console.log("First:", numbers.first()); // 1
console.log("Last:", numbers.last());   // 5
console.log("Empty?:", numbers.isEmpty()); // false
console.log("Sum:", numbers.sum()); // 15

const people = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Charlie", age: 30 },
];

const byAge = people.groupBy(p => p.age);
console.log("Grouped by age:", byAge);
`,
  },
  {
    name: "HKT Syntax",
    description: "Higher-Kinded Types with F<_>",
    fileType: ".sts",
    code: `// Higher-Kinded Types (HKT) with F<_> syntax
// (Sugar TypeScript syntax - .sts file)

// Define a Functor typeclass using HKT
interface Functor<F<_>> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// Array is a Functor
const ArrayFunctor: Functor<Array> = {
  map: (fa, f) => fa.map(f),
};

// Maybe/Option type
type Maybe<A> = { tag: "Some"; value: A } | { tag: "None" };

const some = <A>(value: A): Maybe<A> => ({ tag: "Some", value });
const none: Maybe<never> = { tag: "None" };

// Maybe is also a Functor
const MaybeFunctor: Functor<Maybe> = {
  map: (fa, f) => fa.tag === "Some" 
    ? some(f(fa.value)) 
    : none,
};

// Generic function that works with any Functor
function doubleAll<F<_>>(functor: Functor<F>, fa: F<number>): F<number> {
  return functor.map(fa, n => n * 2);
}

// Works with Array
const doubled = doubleAll(ArrayFunctor, [1, 2, 3]);
console.log("Doubled array:", doubled); // [2, 4, 6]

// Works with Maybe
const maybeDouble = doubleAll(MaybeFunctor, some(21));
console.log("Doubled maybe:", maybeDouble); // { tag: "Some", value: 42 }
`,
  },
];

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
  if (!lastResult.value) return "Ready";
  const changed = lastResult.value.changed ? "transformed" : "unchanged";
  const preprocessed = lastResult.value.preprocessed ? " + preprocessed" : "";
  const time = transformTime.value > 0 ? ` (${transformTime.value}ms)` : "";
  return `✓ ${changed}${preprocessed}${time}`;
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

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function doTransform() {
  if (!playground.value || !inputEditor.value) return;

  const code = inputEditor.value.getValue();
  transformError.value = null;
  isTransforming.value = true;

  try {
    const start = performance.now();
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

    loadingProgress.value = 60;
    loadingMessage.value = "Loading transformer...";
    const playgroundModule = await import("@typesugar/playground");
    playground.value = playgroundModule;
    
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
      // Fallback: simple regex-based stripping
      jsCode = tsCode
        .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, "")
        .replace(/^export\s+/gm, "");
    }
  } catch (e) {
    jsCode = tsCode
      .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, "")
      .replace(/^export\s+/gm, "");
  }

  // Remove import statements that TypeScript transpiler preserves
  jsCode = jsCode.replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, "");
  // Remove export keywords
  jsCode = jsCode.replace(/^export\s+/gm, "");

  const html = createSandboxHtml(jsCode);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  if (sandboxIframe.value) {
    sandboxIframe.value.src = url;
  }

  const messageHandler = (event: MessageEvent) => {
    if (event.data.type === "console") {
      consoleMessages.value.push({
        type: event.data.method,
        args: event.data.args,
        timestamp: Date.now(),
      });
    } else if (event.data.type === "done") {
      isRunning.value = false;
      window.removeEventListener("message", messageHandler);
      URL.revokeObjectURL(url);
    }
  };

  window.addEventListener("message", messageHandler);

  // Fallback timeout
  setTimeout(() => {
    if (isRunning.value) {
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
  <ErrorBoundary fallback-message="The playground encountered an error. Please try refreshing the page.">
  <div class="playground-container" role="application" aria-label="typesugar Interactive Playground">
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
              <button 
                v-for="preset in EXAMPLE_PRESETS" 
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
        
        <select 
          v-model="tsVersion" 
          class="ts-version-select" 
          aria-label="TypeScript version"
        >
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
          <button 
            class="copy-btn" 
            @click="copyCode"
            aria-label="Copy input code to clipboard"
          >
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
                <span v-if="errorCount > 0" class="error-badge" aria-label="error count">{{ errorCount }}</span>
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
          />
          
          <div 
            v-show="activeTab === 'errors'" 
            class="errors-container"
            id="output-errors-panel"
            role="tabpanel"
            aria-labelledby="output-errors-tab"
          >
            <div v-if="errorCount === 0" class="no-errors" role="status">
              No errors
            </div>
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
      <section 
        v-show="showConsole" 
        class="console-panel"
        aria-label="Console output"
      >
        <div class="console-header">
          <span class="console-title" id="console-title">Console</span>
          <div class="console-actions">
            <button 
              @click="clearConsole" 
              aria-label="Clear console output"
            >
              Clear
            </button>
            <button 
              @click="showConsole = false" 
              aria-label="Hide console panel"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
        <div 
          class="console-output"
          role="log"
          aria-live="polite"
          aria-labelledby="console-title"
        >
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
          <div 
            class="loading-progress-fill" 
            :style="{ width: `${loadingProgress}%` }"
          ></div>
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

.status.loading { color: var(--vp-c-text-2); }
.status.transforming { color: var(--vp-c-brand-1); }
.status.success { color: var(--vp-c-green-1); }
.status.error { color: var(--vp-c-red-1); }

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
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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

.console-message.log .console-type { color: var(--vp-c-text-3); }
.console-message.info .console-type { color: var(--vp-c-blue-1); }
.console-message.warn .console-type { color: var(--vp-c-yellow-1); }
.console-message.error .console-type { color: var(--vp-c-red-1); }

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
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
}

.preset-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
  border-bottom: 1px solid var(--vp-c-divider);
}

.preset-item:last-child {
  border-bottom: none;
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
