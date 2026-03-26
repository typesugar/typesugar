/**
 * Bridges the TypeScript worker with Monaco editor.
 *
 * After each transform, the adapter receives the transformed code, source map,
 * and original code. It feeds the transformed code to the worker and registers
 * Monaco language providers that map positions bidirectionally using
 * PositionMapperCore from @typesugar/transformer-core.
 */

import type * as Monaco from "monaco-editor";
import { TSWorkerClient, type WorkerDiagnostic } from "./playground-worker-client";
// Import from the source file directly to avoid @typesugar/core barrel
// which has side-effect code referencing process.env (not in browser).
import {
  createPositionMapperCore,
  type PositionMapperCore,
} from "../../../packages/transformer-core/src/position-mapping-core.js";

interface RawSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
}

const INPUT_FILE = "input.ts";

// ---------------------------------------------------------------------------
// Language Adapter
// ---------------------------------------------------------------------------

export class PlaygroundLanguageAdapter {
  private client: TSWorkerClient;
  private mapper: PositionMapperCore | null = null;
  private monaco: typeof Monaco | null = null;
  private disposables: Monaco.IDisposable[] = [];
  private currentOriginal = "";
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;
  /** Incremented on each updateTransformedCode to discard stale responses */
  private _version = 0;

  constructor(client: TSWorkerClient) {
    this.client = client;
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  /** Call after all ambient declarations are loaded. */
  markReady() {
    this._resolveReady();
  }

  register(monacoInstance: typeof Monaco, inputModel: Monaco.editor.ITextModel) {
    this.monaco = monacoInstance;

    // Disable Monaco's built-in TS diagnostics — we provide our own
    monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntacticValidation: true,
    });

    // Completion provider
    this.disposables.push(
      monacoInstance.languages.registerCompletionItemProvider("typescript", {
        triggerCharacters: [".", '"', "'", "/", "<"],
        provideCompletionItems: async (model, position) => {
          if (model !== inputModel || !this.mapper) return undefined;
          const offset = model.getOffsetAt(position);
          const xformOffset = this.mapper.toTransformed(offset);
          if (xformOffset === null) return undefined;
          const result = await this.client.getCompletions(INPUT_FILE, xformOffset);
          if (!result) return undefined;
          return {
            suggestions: result.entries.map((e) => ({
              label: e.name,
              kind: mapCompletionKind(monacoInstance, e.kind),
              insertText: e.insertText ?? e.name,
              sortText: e.sortText,
              preselect: e.isRecommended,
              range: undefined as unknown as Monaco.IRange,
            })),
          };
        },
      })
    );

    // Hover provider
    this.disposables.push(
      monacoInstance.languages.registerHoverProvider("typescript", {
        provideHover: async (model, position) => {
          if (model !== inputModel || !this.mapper) return undefined;
          const offset = model.getOffsetAt(position);
          const xformOffset = this.mapper.toTransformed(offset);
          if (xformOffset === null) return undefined;
          const info = await this.client.getQuickInfo(INPUT_FILE, xformOffset);
          if (!info || !info.displayParts) return undefined;

          const origStart = this.mapper.toOriginal(info.textSpan.start);
          const origEnd = this.mapper.toOriginal(info.textSpan.start + info.textSpan.length);
          if (origStart === null || origEnd === null) return undefined;

          const startPos = model.getPositionAt(origStart);
          const endPos = model.getPositionAt(origEnd);

          return {
            range: {
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            },
            contents: [
              { value: "```typescript\n" + info.displayParts + "\n```" },
              ...(info.documentation ? [{ value: info.documentation }] : []),
            ],
          };
        },
      })
    );

    // Definition provider
    this.disposables.push(
      monacoInstance.languages.registerDefinitionProvider("typescript", {
        provideDefinition: async (model, position) => {
          if (model !== inputModel || !this.mapper) return undefined;
          const offset = model.getOffsetAt(position);
          const xformOffset = this.mapper.toTransformed(offset);
          if (xformOffset === null) return undefined;
          const defs = await this.client.getDefinition(INPUT_FILE, xformOffset);
          if (!defs || defs.length === 0) return undefined;
          return defs
            .map((d) => {
              const origStart = this.mapper!.toOriginal(d.textSpan.start);
              if (origStart === null) return null;
              const startPos = model.getPositionAt(origStart);
              return {
                uri: model.uri,
                range: {
                  startLineNumber: startPos.lineNumber,
                  startColumn: startPos.column,
                  endLineNumber: startPos.lineNumber,
                  endColumn: startPos.column,
                },
              };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null);
        },
      })
    );

    this._inputModel = inputModel;
  }

  private _inputModel: Monaco.editor.ITextModel | null = null;
  private _diagTimer: ReturnType<typeof setTimeout> | null = null;

  async updateTransformedCode(
    original: string,
    transformed: string,
    sourceMap: RawSourceMap | null
  ) {
    this._version++;
    this.currentOriginal = original;
    this.mapper = createPositionMapperCore(sourceMap, original, transformed);
    await this.client.updateFile(INPUT_FILE, transformed);
    // Send source map to worker for diagnostic filtering (MacroGenerated rule)
    await this.client.setSourceMap(sourceMap, original, transformed);
    this._scheduleDiags();
  }

  async addLib(fileName: string, content: string) {
    await this.client.addLib(fileName, content);
  }

  private _scheduleDiags() {
    if (this._diagTimer) clearTimeout(this._diagTimer);
    this._diagTimer = setTimeout(() => this._refreshDiags(), 100);
  }

  private async _refreshDiags() {
    if (!this.monaco || !this._inputModel) return;
    // Wait until ambient declarations are loaded
    await this._readyPromise;
    const version = this._version;
    const diags = await this.client.getDiagnostics(INPUT_FILE);
    // Discard stale results if a newer transform arrived while we were waiting
    if (version !== this._version) return;
    const model = this._inputModel;
    if (!model) return;

    const markers = diags
      .map((d) => this._mapDiag(d, model))
      .filter((m): m is Monaco.editor.IMarkerData => m !== null);

    this.monaco!.editor.setModelMarkers(model, "typesugar-ls", markers);
  }

  private _mapDiag(
    d: WorkerDiagnostic,
    model: Monaco.editor.ITextModel
  ): Monaco.editor.IMarkerData | null {
    if (!this.monaco || !this.mapper) return null;

    const origStart = this.mapper.toOriginal(d.start);
    const origEnd = this.mapper.toOriginal(d.start + d.length);
    if (origStart === null || origEnd === null) return null;
    if (origStart >= this.currentOriginal.length) return null;

    const startPos = model.getPositionAt(origStart);
    const endPos = model.getPositionAt(Math.min(origEnd, this.currentOriginal.length));

    return {
      severity:
        d.category === 1
          ? this.monaco.MarkerSeverity.Error
          : d.category === 0
            ? this.monaco.MarkerSeverity.Warning
            : this.monaco.MarkerSeverity.Info,
      message: d.messageText,
      startLineNumber: startPos.lineNumber,
      startColumn: startPos.column,
      endLineNumber: endPos.lineNumber,
      endColumn: endPos.column,
      source: "TypeScript",
    };
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this._diagTimer) clearTimeout(this._diagTimer);
    this.client.dispose();
  }
}

function mapCompletionKind(m: typeof Monaco, tsKind: string): Monaco.languages.CompletionItemKind {
  const map: Record<string, Monaco.languages.CompletionItemKind> = {
    method: m.languages.CompletionItemKind.Method,
    function: m.languages.CompletionItemKind.Function,
    constructor: m.languages.CompletionItemKind.Constructor,
    field: m.languages.CompletionItemKind.Field,
    variable: m.languages.CompletionItemKind.Variable,
    class: m.languages.CompletionItemKind.Class,
    interface: m.languages.CompletionItemKind.Interface,
    module: m.languages.CompletionItemKind.Module,
    property: m.languages.CompletionItemKind.Property,
    enum: m.languages.CompletionItemKind.Enum,
    keyword: m.languages.CompletionItemKind.Keyword,
    type: m.languages.CompletionItemKind.Interface,
  };
  return map[tsKind] ?? m.languages.CompletionItemKind.Property;
}
