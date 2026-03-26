/**
 * Bridges the TypeScript worker with Monaco editor.
 *
 * After each transform, the adapter receives the transformed code, source map,
 * and original code. It feeds the transformed code to the worker and registers
 * Monaco language providers that map positions bidirectionally using the
 * source map from the transformer.
 */

import type * as Monaco from "monaco-editor";
import { TSWorkerClient, type WorkerDiagnostic } from "./playground-worker-client";

const INPUT_FILE = "input.ts";

// ---------------------------------------------------------------------------
// Source map position mapper (inlined from @typesugar/transformer-core —
// browser-compatible, no dependencies)
// ---------------------------------------------------------------------------

interface RawSourceMap {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
}

interface DecodedSegment {
  generatedColumn: number;
  sourceIndex?: number;
  sourceLine?: number;
  sourceColumn?: number;
}

type DecodedLine = DecodedSegment[];

const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_MAP = new Map<string, number>();
for (let i = 0; i < VLQ_CHARS.length; i++) VLQ_MAP.set(VLQ_CHARS[i], i);

function decodeVLQ(s: string, idx: number): { value: number; next: number } {
  let val = 0,
    shift = 0,
    i = idx;
  while (i < s.length) {
    const cv = VLQ_MAP.get(s[i])!;
    val += (cv & 31) << shift;
    i++;
    if (!(cv & 32)) break;
    shift += 5;
  }
  return { value: val & 1 ? -(val >> 1) : val >> 1, next: i };
}

function decodeMappings(mappings: string): DecodedLine[] {
  const lines: DecodedLine[] = [];
  let line: DecodedLine = [];
  let gc = 0,
    si = 0,
    sl = 0,
    sc = 0;
  let i = 0;
  while (i < mappings.length) {
    const ch = mappings[i];
    if (ch === ";") {
      lines.push(line);
      line = [];
      gc = 0;
      i++;
      continue;
    }
    if (ch === ",") {
      i++;
      continue;
    }
    const seg: DecodedSegment = { generatedColumn: 0 };
    const c1 = decodeVLQ(mappings, i);
    gc += c1.value;
    seg.generatedColumn = gc;
    i = c1.next;
    if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
      const c2 = decodeVLQ(mappings, i);
      si += c2.value;
      seg.sourceIndex = si;
      i = c2.next;
      const c3 = decodeVLQ(mappings, i);
      sl += c3.value;
      seg.sourceLine = sl;
      i = c3.next;
      const c4 = decodeVLQ(mappings, i);
      sc += c4.value;
      seg.sourceColumn = sc;
      i = c4.next;
      if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
        const c5 = decodeVLQ(mappings, i);
        i = c5.next; // name index (ignored)
      }
    }
    line.push(seg);
  }
  if (line.length > 0 || lines.length > 0) lines.push(line);
  return lines;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function offsetToLC(offset: number, lineStarts: number[]): { line: number; col: number } {
  let line = 0;
  for (let i = 1; i < lineStarts.length; i++) {
    if (lineStarts[i] > offset) break;
    line = i;
  }
  return { line, col: offset - lineStarts[line] };
}

function lcToOffset(line: number, col: number, lineStarts: number[]): number {
  if (line < 0 || line >= lineStarts.length) return -1;
  return lineStarts[line] + col;
}

/**
 * Line-based bidirectional mapper using text matching.
 *
 * With preserveBlankLines mode, unchanged lines are byte-identical between
 * original and transformed. We build a line mapping by matching identical
 * lines, then use the VLQ source map only for lines that differ (macro
 * expansion sites). This gives accurate positions for ALL lines, not just
 * expansion sites.
 */
class SourceMapMapper {
  /** xformLine → origLine (-1 = no mapping) */
  private xformToOrig: number[] = [];
  /** origLine → xformLine (-1 = no mapping) */
  private origToXform: number[] = [];
  private origLS: number[] = [0];
  private xformLS: number[] = [0];

  update(original: string, transformed: string, sourceMap: RawSourceMap | null) {
    this.origLS = computeLineStarts(original);
    this.xformLS = computeLineStarts(transformed);

    const origLines = original.split("\n");
    const xformLines = transformed.split("\n");

    // Build line mapping via LCS-style matching
    this.xformToOrig = new Array(xformLines.length).fill(-1);
    this.origToXform = new Array(origLines.length).fill(-1);

    // Greedy forward match: for each transformed line, find the next matching
    // original line. This works because preserveBlankLines keeps line order.
    let oi = 0;
    for (let xi = 0; xi < xformLines.length; xi++) {
      // Look ahead in original for a match
      for (let scan = oi; scan < origLines.length; scan++) {
        if (xformLines[xi] === origLines[scan]) {
          this.xformToOrig[xi] = scan;
          this.origToXform[scan] = xi;
          oi = scan + 1;
          break;
        }
      }
    }

    // Fill gaps using the VLQ source map for unmapped lines (expansion sites)
    if (sourceMap) {
      const decoded = decodeMappings(sourceMap.mappings);
      for (let xi = 0; xi < xformLines.length; xi++) {
        if (this.xformToOrig[xi] !== -1) continue; // already mapped
        if (xi >= decoded.length) continue;
        const segs = decoded[xi];
        if (segs.length > 0 && segs[0].sourceLine !== undefined) {
          this.xformToOrig[xi] = segs[0].sourceLine;
        }
      }
    }
  }

  /** Map transformed offset → original offset */
  toOriginal(xformOffset: number): number | null {
    const { line: xl, col: xc } = offsetToLC(xformOffset, this.xformLS);
    if (xl >= this.xformToOrig.length) return null;
    const ol = this.xformToOrig[xl];
    if (ol === -1) return null; // no mapping — generated code
    return lcToOffset(ol, xc, this.origLS);
  }

  /** Map original offset → transformed offset */
  toTransformed(origOffset: number): number | null {
    const { line: ol, col: oc } = offsetToLC(origOffset, this.origLS);
    if (ol >= this.origToXform.length) return null;
    const xl = this.origToXform[ol];
    if (xl === -1) return null;
    return lcToOffset(xl, oc, this.xformLS);
  }
}

// ---------------------------------------------------------------------------
// Language Adapter
// ---------------------------------------------------------------------------

export class PlaygroundLanguageAdapter {
  private client: TSWorkerClient;
  private mapper = new SourceMapMapper();
  private monaco: typeof Monaco | null = null;
  private disposables: Monaco.IDisposable[] = [];
  private currentOriginal = "";
  private _ready = false;

  constructor(client: TSWorkerClient) {
    this.client = client;
  }

  /** Call after all ambient declarations are loaded. */
  markReady() {
    this._ready = true;
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
          if (model !== inputModel) return undefined;
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
          if (model !== inputModel) return undefined;
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
          if (model !== inputModel) return undefined;
          const offset = model.getOffsetAt(position);
          const xformOffset = this.mapper.toTransformed(offset);
          if (xformOffset === null) return undefined;
          const defs = await this.client.getDefinition(INPUT_FILE, xformOffset);
          if (!defs || defs.length === 0) return undefined;
          return defs
            .map((d) => {
              const origStart = this.mapper.toOriginal(d.textSpan.start);
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

    // Pull diagnostics from worker and set as markers
    this._inputModel = inputModel;
  }

  private _inputModel: Monaco.editor.ITextModel | null = null;
  private _diagTimer: ReturnType<typeof setTimeout> | null = null;

  async updateTransformedCode(
    original: string,
    transformed: string,
    sourceMap: RawSourceMap | null
  ) {
    this.currentOriginal = original;
    this.mapper.update(original, transformed, sourceMap);
    await this.client.updateFile(INPUT_FILE, transformed);
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
    if (!this.monaco || !this._inputModel || !this._ready) return;
    const diags = await this.client.getDiagnostics(INPUT_FILE);
    const model = this._inputModel;

    const markers = diags
      .map((d) => this._mapDiag(d, model))
      .filter((m): m is Monaco.editor.IMarkerData => m !== null);

    this.monaco.editor.setModelMarkers(model, "typesugar-ls", markers);
  }

  private _mapDiag(
    d: WorkerDiagnostic,
    model: Monaco.editor.ITextModel
  ): Monaco.editor.IMarkerData | null {
    if (!this.monaco) return null;

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
