<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef, computed } from "vue";
import type * as Monaco from "monaco-editor";
import { compressToEncodedURIComponent } from "lz-string";

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

const props = withDefaults(
  defineProps<{
    code: string;
    mode?: ".ts" | ".sts";
    readonly?: boolean;
    height?: string;
    hideOutput?: boolean;
    title?: string;
  }>(),
  {
    mode: ".ts",
    readonly: false,
    height: "300px",
    hideOutput: false,
    title: "",
  }
);

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

const isLoading = ref(true);
const transformError = ref<string | null>(null);
const lastResult = ref<TransformResult | null>(null);
const showOutput = ref(!props.hideOutput);

const fileName = computed(() => `input${props.mode}`);

const errorCount = computed(() => lastResult.value?.diagnostics?.length ?? 0);

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
        { include: "@whitespace" },
        [
          /\/(?=([^\\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/,
          { token: "regexp", bracket: "@open", next: "@regexp" },
        ],
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
        [/\]/, { token: "regexp.escape.control", next: "@pop", bracket: "@close" }],
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
    const result = playground.value.transform(code, {
      fileName: fileName.value,
      verbose: false,
    });

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
  }
}

function scheduleTransform() {
  if (props.readonly) return;
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

function openInPlayground() {
  const code = inputEditor.value?.getValue() ?? props.code;
  const compressed = compressToEncodedURIComponent(code);
  const params = new URLSearchParams({
    code: compressed,
    mode: props.mode,
    ts: "5.8",
  });
  const url = `/playground#${params.toString()}`;
  window.open(url, "_blank");
}

function toggleOutput() {
  showOutput.value = !showOutput.value;
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
        value: props.code,
        language: props.mode === ".sts" ? "sts" : "typescript",
        theme,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        padding: { top: 8, bottom: 8 },
        readOnly: props.readonly,
        scrollbar: {
          vertical: "auto",
          horizontal: "auto",
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        folding: false,
        renderLineHighlight: props.readonly ? "none" : "line",
        contextmenu: !props.readonly,
      });

      if (!props.readonly) {
        inputEditor.value.onDidChangeModelContent(() => {
          scheduleTransform();
        });
      }
    }

    if (outputContainer.value && !props.hideOutput) {
      outputEditor.value = monacoInstance.editor.create(outputContainer.value, {
        value: "",
        language: "javascript",
        theme,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        readOnly: true,
        padding: { top: 8, bottom: 8 },
        scrollbar: {
          vertical: "auto",
          horizontal: "auto",
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        folding: false,
        renderLineHighlight: "none",
        contextmenu: false,
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

watch(
  () => props.code,
  (newCode) => {
    if (inputEditor.value && newCode !== inputEditor.value.getValue()) {
      inputEditor.value.setValue(newCode);
    }
  }
);

watch(
  () => props.mode,
  (newMode) => {
    if (inputEditor.value && monaco.value) {
      const model = inputEditor.value.getModel();
      if (model) {
        monaco.value.editor.setModelLanguage(model, newMode === ".sts" ? "sts" : "typescript");
      }
      doTransform();
    }
  }
);

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
</script>

<template>
  <div class="playground-embed" :style="{ '--embed-height': height }">
    <!-- Header -->
    <div class="embed-header">
      <div class="embed-header-left">
        <span v-if="title" class="embed-title">{{ title }}</span>
        <span class="embed-file-type">{{ mode }}</span>
        <span v-if="readonly" class="embed-readonly-badge">Read-only</span>
        <span v-if="errorCount > 0" class="embed-error-badge"
          >{{ errorCount }} error{{ errorCount > 1 ? "s" : "" }}</span
        >
      </div>
      <div class="embed-header-right">
        <button
          v-if="!hideOutput"
          class="embed-toggle-btn"
          @click="toggleOutput"
          :title="showOutput ? 'Hide output' : 'Show output'"
        >
          {{ showOutput ? "◀ Hide Output" : "▶ Show Output" }}
        </button>
        <button class="embed-open-btn" @click="openInPlayground" title="Open in full playground">
          ↗ Open in Playground
        </button>
      </div>
    </div>

    <!-- Editor panels -->
    <div class="embed-content" :class="{ 'hide-output': !showOutput || hideOutput }">
      <div class="embed-panel input-panel">
        <div class="panel-label">
          <span>Input</span>
          <span class="file-name">{{ fileName }}</span>
        </div>
        <div ref="inputContainer" class="embed-editor" />
      </div>

      <div v-if="!hideOutput && showOutput" class="embed-panel output-panel">
        <div class="panel-label">
          <span>Output</span>
          <span class="file-name">.js</span>
        </div>
        <div ref="outputContainer" class="embed-editor" />
      </div>
    </div>

    <!-- Loading overlay -->
    <div v-if="isLoading" class="embed-loading">
      <div class="embed-spinner"></div>
      <span>Loading...</span>
    </div>
  </div>
</template>

<style scoped>
.playground-embed {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg);
  margin: 16px 0;
  position: relative;
}

.embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  gap: 8px;
  flex-wrap: wrap;
}

.embed-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.embed-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.embed-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.embed-file-type {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 2px 6px;
  border-radius: 4px;
}

.embed-readonly-badge {
  font-size: 10px;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-mute);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.embed-error-badge {
  font-size: 10px;
  color: white;
  background: var(--vp-c-red-1);
  padding: 2px 6px;
  border-radius: 4px;
}

.embed-toggle-btn,
.embed-open-btn {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.embed-toggle-btn:hover,
.embed-open-btn:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

.embed-open-btn {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.embed-open-btn:hover {
  background: var(--vp-c-brand-1);
  color: white;
}

.embed-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: var(--embed-height);
  min-height: 150px;
}

.embed-content.hide-output {
  grid-template-columns: 1fr;
}

.embed-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.input-panel {
  border-right: 1px solid var(--vp-c-divider);
}

.embed-content.hide-output .input-panel {
  border-right: none;
}

.panel-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vp-c-text-3);
}

.file-name {
  font-family: var(--vp-font-family-mono);
  text-transform: none;
  letter-spacing: normal;
}

.embed-editor {
  flex: 1;
  min-height: 0;
}

.embed-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--vp-c-bg);
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.embed-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--vp-c-divider);
  border-top-color: var(--vp-c-brand-1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .embed-content {
    grid-template-columns: 1fr;
  }

  .input-panel {
    border-right: none;
    border-bottom: 1px solid var(--vp-c-divider);
  }

  .embed-content:not(.hide-output) {
    height: calc(var(--embed-height) * 2);
  }

  .embed-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .embed-header-right {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
