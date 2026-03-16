<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef, computed, nextTick } from "vue";
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

const props = withDefaults(
  defineProps<{
    initialCode?: string;
    initialFileType?: ".ts" | ".sts";
  }>(),
  {
    initialCode: `// Welcome to the typesugar Playground!
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
`,
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
const transformError = ref<string | null>(null);
const lastResult = ref<TransformResult | null>(null);
const transformTime = ref<number>(0);

const activeTab = ref<"js" | "errors">("js");
const consoleMessages = ref<ConsoleMessage[]>([]);
const showConsole = ref(true);

const fileName = computed(() => `input${fileType.value}`);

const errorCount = computed(() => lastResult.value?.diagnostics?.length ?? 0);

const statusText = computed(() => {
  if (isLoading.value) return "Loading...";
  if (transformError.value) return `Error`;
  if (!lastResult.value) return "Ready";
  const changed = lastResult.value.changed ? "transformed" : "unchanged";
  const preprocessed = lastResult.value.preprocessed ? " + preprocessed" : "";
  const time = transformTime.value > 0 ? ` (${transformTime.value}ms)` : "";
  return `✓ ${changed}${preprocessed}${time}`;
});

const statusClass = computed(() => {
  if (isLoading.value) return "loading";
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

function copyShareUrl() {
  const code = inputEditor.value?.getValue() ?? "";
  const params = new URLSearchParams({
    code: btoa(encodeURIComponent(code)),
    mode: fileType.value,
    ts: tsVersion.value,
  });
  const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
  navigator.clipboard.writeText(url);
  
  // Brief visual feedback could be added here
}

function loadFromUrl() {
  if (typeof window === "undefined") return;
  
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  try {
    const params = new URLSearchParams(hash);
    const encodedCode = params.get("code");
    const mode = params.get("mode") as ".ts" | ".sts" | null;
    const ts = params.get("ts");

    if (encodedCode) {
      const code = decodeURIComponent(atob(encodedCode));
      inputEditor.value?.setValue(code);
    }
    if (mode === ".ts" || mode === ".sts") {
      fileType.value = mode;
    }
    if (ts) {
      tsVersion.value = ts;
    }
  } catch (e) {
    console.error("Failed to load from URL:", e);
  }
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
        padding: { top: 12, bottom: 12 },
      });

      inputEditor.value.onDidChangeModelContent(() => {
        scheduleTransform();
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

    isLoading.value = false;
    doTransform();
    loadFromUrl();

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
</script>

<template>
  <div class="playground-container">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
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
        
        <select v-model="tsVersion" class="ts-version-select" title="TypeScript version">
          <option value="5.8">TypeScript 5.8</option>
          <option value="5.7">TypeScript 5.7</option>
          <option value="5.6">TypeScript 5.6</option>
        </select>
      </div>

      <div class="toolbar-center">
        <div class="status" :class="statusClass">
          {{ statusText }}
        </div>
      </div>

      <div class="toolbar-right">
        <button 
          class="run-btn" 
          @click="runCode" 
          :disabled="isRunning || !lastResult"
          title="Run code (Cmd+Enter)"
        >
          <span v-if="isRunning" class="spinner"></span>
          <span v-else>▶</span>
          Run
        </button>
        <button 
          class="share-btn" 
          @click="copyShareUrl"
          title="Copy share URL (Cmd+S)"
        >
          Share
        </button>
      </div>
    </div>

    <!-- Main content area -->
    <div class="main-content">
      <!-- Editors -->
      <div class="editors-container">
        <div class="editor-panel input-panel">
          <div class="panel-header">
            <span class="panel-title">Input</span>
            <span class="panel-filename">{{ fileName }}</span>
          </div>
          <div ref="inputContainer" class="editor-container" />
        </div>

        <div class="editor-panel output-panel">
          <div class="panel-header">
            <div class="output-tabs">
              <button 
                :class="{ active: activeTab === 'js' }" 
                @click="activeTab = 'js'"
              >
                JS Output
              </button>
              <button 
                :class="{ active: activeTab === 'errors' }" 
                @click="activeTab = 'errors'"
              >
                Errors
                <span v-if="errorCount > 0" class="error-badge">{{ errorCount }}</span>
              </button>
            </div>
            <span class="panel-filename">{{ fileName.replace(/\.sts$/, ".js") }}</span>
          </div>
          
          <div v-show="activeTab === 'js'" ref="outputContainer" class="editor-container" />
          
          <div v-show="activeTab === 'errors'" class="errors-container">
            <div v-if="errorCount === 0" class="no-errors">
              No errors
            </div>
            <div v-else class="error-list">
              <div 
                v-for="(diag, i) in lastResult?.diagnostics" 
                :key="i" 
                class="error-item"
                :class="diag.severity"
                @click="goToErrorLine(diag.line)"
              >
                <div class="error-location">
                  <span class="error-severity">{{ diag.severity }}</span>
                  <span v-if="diag.line" class="error-line">Line {{ diag.line }}</span>
                </div>
                <div class="error-message">{{ diag.message }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Console -->
      <div v-show="showConsole" class="console-panel">
        <div class="console-header">
          <span class="console-title">Console</span>
          <div class="console-actions">
            <button @click="clearConsole" title="Clear console">Clear</button>
            <button @click="showConsole = false" title="Hide console">×</button>
          </div>
        </div>
        <div class="console-output">
          <div v-if="consoleMessages.length === 0" class="console-placeholder">
            Press Run (Cmd+Enter) to execute the code
          </div>
          <div 
            v-for="(msg, i) in consoleMessages" 
            :key="i" 
            class="console-message"
            :class="msg.type"
          >
            <span class="console-type">[{{ msg.type }}]</span>
            <span class="console-text">{{ msg.args.join(" ") }}</span>
          </div>
        </div>
      </div>

      <!-- Toggle console button when hidden -->
      <button 
        v-if="!showConsole" 
        class="show-console-btn"
        @click="showConsole = true"
      >
        Show Console
      </button>
    </div>

    <!-- Hidden sandbox iframe -->
    <iframe 
      ref="sandboxIframe" 
      class="sandbox-iframe"
      sandbox="allow-scripts"
      title="Code execution sandbox"
    />

    <!-- Loading overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <div class="loading-text">Loading playground...</div>
    </div>
  </div>
</template>

<style scoped>
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

.status.loading { color: var(--vp-c-text-2); }
.status.success { color: var(--vp-c-green-1); }
.status.error { color: var(--vp-c-red-1); }

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

.error-item {
  padding: 12px;
  background: var(--vp-c-bg-soft);
  border-radius: 6px;
  border-left: 3px solid var(--vp-c-red-1);
  cursor: pointer;
  transition: background 0.2s;
}

.error-item:hover {
  background: var(--vp-c-bg-mute);
}

.error-item.warning {
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--vp-c-bg);
  z-index: 100;
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
  color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
  .editors-container {
    grid-template-columns: 1fr;
  }
  
  .toolbar {
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .toolbar-center {
    order: 3;
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
