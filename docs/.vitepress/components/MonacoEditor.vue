<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef, computed } from "vue";
import type * as Monaco from "monaco-editor";

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
  }>;
  preprocessed?: boolean;
}

const props = withDefaults(
  defineProps<{
    initialCode?: string;
    initialFileType?: ".ts" | ".sts";
    height?: string;
    readonly?: boolean;
  }>(),
  {
    initialCode: `// Try typesugar macros!
import { staticAssert } from "typesugar";

// Static assertion at compile time
staticAssert(1 + 1 === 2);

// Regular TypeScript
const greet = (name: string) => \`Hello, \${name}!\`;
console.log(greet("World"));
`,
    initialFileType: ".ts",
    height: "400px",
    readonly: false,
  }
);

const emit = defineEmits<{
  (e: "transform", result: TransformResult): void;
  (e: "error", error: Error): void;
}>();

const inputContainer = ref<HTMLElement | null>(null);
const outputContainer = ref<HTMLElement | null>(null);
const inputEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const outputEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const monaco = shallowRef<typeof Monaco | null>(null);
const playground = shallowRef<{
  transform: (code: string, options: { fileName: string; verbose?: boolean }) => TransformResult;
  preprocessCode: (
    code: string,
    options: { fileName: string }
  ) => { code: string; changed: boolean };
} | null>(null);

const fileType = ref<".ts" | ".sts">(props.initialFileType);
const isLoading = ref(true);
const transformError = ref<string | null>(null);
const lastResult = ref<TransformResult | null>(null);
const transformTime = ref<number>(0);

const fileName = computed(() => `input${fileType.value}`);

const statusText = computed(() => {
  if (isLoading.value) return "Loading...";
  if (transformError.value) return `Error: ${transformError.value}`;
  if (!lastResult.value) return "Ready";
  const changed = lastResult.value.changed ? "transformed" : "unchanged";
  const preprocessed = lastResult.value.preprocessed ? ", preprocessed" : "";
  const time = transformTime.value > 0 ? ` (${transformTime.value}ms)` : "";
  return `✓ ${changed}${preprocessed}${time}`;
});

const statusClass = computed(() => {
  if (isLoading.value) return "loading";
  if (transformError.value || (lastResult.value?.diagnostics?.length ?? 0) > 0) return "error";
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
      "abstract",
      "any",
      "as",
      "asserts",
      "async",
      "await",
      "boolean",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "constructor",
      "continue",
      "debugger",
      "declare",
      "default",
      "delete",
      "do",
      "else",
      "enum",
      "export",
      "extends",
      "false",
      "finally",
      "for",
      "from",
      "function",
      "get",
      "if",
      "implements",
      "import",
      "in",
      "infer",
      "instanceof",
      "interface",
      "is",
      "keyof",
      "let",
      "module",
      "namespace",
      "never",
      "new",
      "null",
      "number",
      "object",
      "of",
      "package",
      "private",
      "protected",
      "public",
      "readonly",
      "require",
      "return",
      "satisfies",
      "set",
      "static",
      "string",
      "super",
      "switch",
      "symbol",
      "this",
      "throw",
      "true",
      "try",
      "type",
      "typeof",
      "undefined",
      "unique",
      "unknown",
      "var",
      "void",
      "while",
      "with",
      "yield",
    ],

    typeKeywords: ["F", "HKT", "Kind", "Type", "Functor", "Monad", "Apply", "Applicative"],

    operators: [
      "<=",
      ">=",
      "==",
      "!=",
      "===",
      "!==",
      "=>",
      "+",
      "-",
      "**",
      "*",
      "/",
      "%",
      "++",
      "--",
      "<<",
      "</",
      ">>",
      ">>>",
      "&",
      "|",
      "^",
      "!",
      "~",
      "&&",
      "||",
      "??",
      "?",
      ":",
      "=",
      "+=",
      "-=",
      "*=",
      "**=",
      "/=",
      "%=",
      "<<=",
      ">>=",
      ">>>=",
      "&=",
      "|=",
      "^=",
      "@",
      "|>",
      "<|",
      "::",
      "~>",
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
        // typesugar-specific: HKT syntax F<_>
        [/F<_>/, "type.identifier.hkt"],
        [/\b_\b/, "type.identifier.placeholder"],

        // Decorators/macros - match specific typesugar annotations
        [/@@typeclass\b/, "annotation.typeclass"],
        [/@@impl\b/, "annotation.impl"],
        [/@@deriving\b/, "annotation.deriving"],
        [/@@derive\b/, "annotation.derive"],
        [/@@extension\b/, "annotation.extension"],
        [/@@comptime\b/, "annotation.comptime"],
        [/@@macro\b/, "annotation.macro"],
        [/@@[a-zA-Z_$][\w$]*/, "annotation"],

        // Pipeline operator
        [/\|>/, "operator.pipeline"],
        [/<\|/, "operator.pipeline"],

        // Cons operator
        [/::/, "operator.cons"],

        // Kind projection
        [/~>/, "operator.kind"],

        // Identifiers and keywords
        [
          /[a-z_$][\w$]*/,
          {
            cases: {
              "@typeKeywords": "type.identifier",
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
        [/[A-Z][\w\$]*/, "type.identifier"],

        // Whitespace
        { include: "@whitespace" },

        // Regular expression
        [
          /\/(?=([^\\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/,
          { token: "regexp", bracket: "@open", next: "@regexp" },
        ],

        // Delimiters and operators
        [/[()\[\]]/, "@brackets"],
        [/[<>](?!@symbols)/, "@brackets"],
        [/!(?=([^=]|$))/, "delimiter"],
        [
          /@symbols/,
          {
            cases: {
              "@operators": "operator",
              "@default": "",
            },
          },
        ],

        // Numbers
        [/(@digits)[eE]([\-+]?(@digits))?/, "number.float"],
        [/(@digits)\.(@digits)([eE][\-+]?(@digits))?/, "number.float"],
        [/0[xX](@hexdigits)n?/, "number.hex"],
        [/0[oO]?(@octaldigits)n?/, "number.octal"],
        [/0[bB](@binarydigits)n?/, "number.binary"],
        [/(@digits)n?/, "number"],

        // Delimiter: after number
        [/[;,.]/, "delimiter"],

        // Strings
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

      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],

      jsdoc: [
        [/[^\/*]+/, "comment.doc"],
        [/\*\//, "comment.doc", "@pop"],
        [/[\/*]/, "comment.doc"],
      ],

      regexp: [
        [
          /(\{)(\d+(?:,\d*)?)(\})/,
          ["regexp.escape.control", "regexp.escape.control", "regexp.escape.control"],
        ],
        [
          /(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/,
          ["regexp.escape.control", { token: "regexp.escape.control", next: "@regexrange" }],
        ],
        [/(\()(\?:|\?=|\?!)/, ["regexp.escape.control", "regexp.escape.control"]],
        [/[()]/, "regexp.escape.control"],
        [/@regexpctl/, "regexp.escape.control"],
        [/[^\\\/]/, "regexp"],
        [/@regexpesc/, "regexp.escape"],
        [/\\\./, "regexp.invalid"],
        [
          /(\/)([dgimsuy]*)/,
          [{ token: "regexp", bracket: "@close", next: "@pop" }, "keyword.other"],
        ],
      ],

      regexrange: [
        [/-/, "regexp.escape.control"],
        [/\^/, "regexp.invalid"],
        [/@regexpesc/, "regexp.escape"],
        [/[^\]]/, "regexp"],
        [
          /\]/,
          {
            token: "regexp.escape.control",
            next: "@pop",
            bracket: "@close",
          },
        ],
      ],

      string_double: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],

      string_single: [
        [/[^\\']+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string", "@pop"],
      ],

      string_backtick: [
        [/\$\{/, { token: "delimiter.bracket", next: "@bracketCounting" }],
        [/[^\\`$]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/`/, "string", "@pop"],
      ],

      bracketCounting: [
        [/\{/, "delimiter.bracket", "@bracketCounting"],
        [/\}/, "delimiter.bracket", "@pop"],
        { include: "common" },
      ],
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

  try {
    const start = performance.now();
    const result = playground.value.transform(code, {
      fileName: fileName.value,
      verbose: false,
    });
    transformTime.value = Math.round(performance.now() - start);

    lastResult.value = result;
    outputEditor.value?.setValue(result.code);

    if (result.diagnostics.length > 0) {
      transformError.value = result.diagnostics.map((d) => d.message).join("; ");
    }

    emit("transform", result);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    transformError.value = err.message;
    emit("error", err);
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
    const ts = await import("typescript");
    (window as Record<string, unknown>).ts = ts;

    const playgroundModule = await import("@typesugar/playground");
    playground.value = playgroundModule;
  } catch (e) {
    console.error("Failed to load playground:", e);
    transformError.value = `Failed to load playground: ${e}`;
  }
}

async function initMonaco() {
  if (typeof window === "undefined") return;

  try {
    const loader = await import("@monaco-editor/loader");
    const monacoInstance = await loader.default.init();
    monaco.value = monacoInstance;

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
        readOnly: props.readonly,
        padding: { top: 12, bottom: 12 },
      });

      inputEditor.value.onDidChangeModelContent(() => {
        scheduleTransform();
      });
    }

    if (outputContainer.value) {
      outputEditor.value = monacoInstance.editor.create(outputContainer.value, {
        value: "",
        language: "typescript",
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

    isLoading.value = false;

    doTransform();

    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      const newTheme = isDark ? "typesugar-dark" : "typesugar-light";
      monacoInstance.editor.setTheme(newTheme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  } catch (e) {
    console.error("Failed to initialize Monaco:", e);
    transformError.value = `Failed to load editor: ${e}`;
    isLoading.value = false;
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
});

onMounted(() => {
  initMonaco();
});

onUnmounted(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  inputEditor.value?.dispose();
  outputEditor.value?.dispose();
});

defineExpose({
  getInputCode: () => inputEditor.value?.getValue() ?? "",
  setInputCode: (code: string) => inputEditor.value?.setValue(code),
  getOutputCode: () => outputEditor.value?.getValue() ?? "",
  setFileType,
  transform: doTransform,
});
</script>

<template>
  <div class="monaco-editor-playground">
    <div class="toolbar">
      <div class="file-type-toggle">
        <button
          :class="{ active: fileType === '.ts' }"
          @click="setFileType('.ts')"
          title="TypeScript mode - JSDoc macros only"
        >
          .ts
        </button>
        <button
          :class="{ active: fileType === '.sts' }"
          @click="setFileType('.sts')"
          title="Sugar TypeScript mode - custom syntax"
        >
          .sts
        </button>
      </div>
      <div class="status" :class="statusClass">
        {{ statusText }}
      </div>
    </div>

    <div class="editors" :style="{ height }">
      <div class="editor-panel">
        <div class="panel-header">
          <span class="panel-title">Input</span>
          <span class="panel-filename">{{ fileName }}</span>
        </div>
        <div ref="inputContainer" class="editor-container" />
      </div>

      <div class="editor-panel">
        <div class="panel-header">
          <span class="panel-title">Output</span>
          <span class="panel-filename">{{ fileName.replace(/\.sts$/, ".ts") }}</span>
        </div>
        <div ref="outputContainer" class="editor-container" />
      </div>
    </div>

    <div v-if="lastResult?.diagnostics?.length" class="diagnostics">
      <div
        v-for="(diag, i) in lastResult.diagnostics"
        :key="i"
        class="diagnostic"
        :class="diag.severity"
      >
        <span class="diagnostic-severity">{{ diag.severity }}</span>
        <span class="diagnostic-message">{{ diag.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monaco-editor-playground {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--vp-c-bg);
  border-bottom: 1px solid var(--vp-c-divider);
}

.file-type-toggle {
  display: flex;
  gap: 4px;
}

.file-type-toggle button {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
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

.status {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  padding: 4px 8px;
  border-radius: 4px;
}

.status.loading {
  color: var(--vp-c-text-2);
}

.status.success {
  color: var(--vp-c-green-1);
}

.status.error {
  color: var(--vp-c-red-1);
}

.editors {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--vp-c-divider);
}

.editor-panel {
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.panel-title {
  font-size: 11px;
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

.editor-container {
  flex: 1;
  min-height: 0;
}

.diagnostics {
  padding: 8px 12px;
  background: var(--vp-c-bg);
  border-top: 1px solid var(--vp-c-divider);
}

.diagnostic {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
}

.diagnostic-severity {
  font-weight: 600;
  text-transform: uppercase;
}

.diagnostic.error .diagnostic-severity {
  color: var(--vp-c-red-1);
}

.diagnostic.warning .diagnostic-severity {
  color: var(--vp-c-yellow-1);
}

.diagnostic-message {
  color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
  .editors {
    grid-template-columns: 1fr;
  }
}
</style>
