/**
 * Lightweight TypeScript Language Service harness for testing the ts-plugin.
 *
 * Creates an in-memory TS project with the plugin loaded, allowing us to
 * test diagnostics, completions, and definitions without a real tsserver.
 */
import * as ts from "typescript";
import * as path from "path";

export interface HarnessFile {
  name: string;
  content: string;
}

export interface HarnessOptions {
  files?: HarnessFile[];
  compilerOptions?: ts.CompilerOptions;
}

export class LanguageServiceHarness {
  private files = new Map<string, { content: string; version: number }>();
  private service: ts.LanguageService;
  private decoratedService: ts.LanguageService | undefined;

  constructor(options: HarnessOptions = {}) {
    const defaultCompilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      ...options.compilerOptions,
    };

    for (const file of options.files ?? []) {
      this.files.set(this.normalizePath(file.name), {
        content: file.content,
        version: 1,
      });
    }

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => Array.from(this.files.keys()),
      getScriptVersion: (fileName) =>
        String(this.files.get(this.normalizePath(fileName))?.version ?? 0),
      getScriptSnapshot: (fileName) => {
        const file = this.files.get(this.normalizePath(fileName));
        if (!file) return undefined;
        return ts.ScriptSnapshot.fromString(file.content);
      },
      getCurrentDirectory: () => "/test-project",
      getCompilationSettings: () => defaultCompilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName) => {
        return this.files.has(this.normalizePath(fileName)) || ts.sys.fileExists(fileName);
      },
      readFile: (fileName) => {
        const file = this.files.get(this.normalizePath(fileName));
        if (file) return file.content;
        return ts.sys.readFile(fileName);
      },
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    this.service = ts.createLanguageService(host);
  }

  private normalizePath(fileName: string): string {
    if (path.isAbsolute(fileName)) return fileName;
    return path.join("/test-project", fileName);
  }

  /**
   * Try to load and apply the ts-plugin decorator.
   * Returns true if the plugin loaded successfully, false otherwise.
   */
  async loadPlugin(): Promise<boolean> {
    try {
      const pluginInit = require(path.resolve(__dirname, "../dist/index.js"));
      const initFn = typeof pluginInit === "function" ? pluginInit : pluginInit.default;

      if (!initFn) return false;

      const pluginModule = initFn({ typescript: ts });
      if (!pluginModule?.create) return false;

      this.decoratedService = pluginModule.create({
        languageService: this.service,
        languageServiceHost: {} as any,
        project: {} as any,
        serverHost: {} as any,
        config: {},
      });

      return true;
    } catch {
      return false;
    }
  }

  /** Get the active language service (decorated if plugin loaded, raw otherwise) */
  getService(): ts.LanguageService {
    return this.decoratedService ?? this.service;
  }

  /** Add or update a file */
  updateFile(name: string, content: string): void {
    const normalized = this.normalizePath(name);
    const existing = this.files.get(normalized);
    this.files.set(normalized, {
      content,
      version: (existing?.version ?? 0) + 1,
    });
  }

  /** Get semantic diagnostics for a file */
  getSemanticDiagnostics(fileName: string): ts.Diagnostic[] {
    return this.getService().getSemanticDiagnostics(this.normalizePath(fileName));
  }

  /** Get syntactic diagnostics for a file */
  getSyntacticDiagnostics(fileName: string): ts.DiagnosticWithLocation[] {
    return this.getService().getSyntacticDiagnostics(this.normalizePath(fileName));
  }

  /** Get completions at position */
  getCompletions(fileName: string, position: number): ts.CompletionInfo | undefined {
    return this.getService().getCompletionsAtPosition(
      this.normalizePath(fileName),
      position,
      undefined
    );
  }

  /** Get quick info at position */
  getQuickInfo(fileName: string, position: number): ts.QuickInfo | undefined {
    return this.getService().getQuickInfoAtPosition(this.normalizePath(fileName), position);
  }

  /** Get definition at position */
  getDefinition(fileName: string, position: number): readonly ts.DefinitionInfo[] | undefined {
    return this.getService().getDefinitionAtPosition(this.normalizePath(fileName), position);
  }

  dispose(): void {
    this.service.dispose();
  }
}

/**
 * Create a simple harness with a single test file.
 */
export function createSimpleHarness(content: string, fileName = "test.ts"): LanguageServiceHarness {
  return new LanguageServiceHarness({
    files: [{ name: fileName, content }],
  });
}
