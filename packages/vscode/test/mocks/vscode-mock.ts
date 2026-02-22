/**
 * Mock VS Code API for unit testing.
 *
 * Provides lightweight implementations of the VS Code API surface used by
 * the typesugar extension providers. These are not full-fidelity mocks —
 * they support the specific patterns used in our codebase.
 */

// --- Core Types ---

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
  translate(lineDelta?: number, characterDelta?: number): Position {
    return new Position(this.line + (lineDelta ?? 0), this.character + (characterDelta ?? 0));
  }
  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(start: Position, end: Position);
  constructor(
    startOrLine: Position | number,
    endOrChar: Position | number,
    endLine?: number,
    endChar?: number
  ) {
    if (typeof startOrLine === "number") {
      this.start = new Position(startOrLine, endOrChar as number);
      this.end = new Position(endLine!, endChar!);
    } else {
      this.start = startOrLine;
      this.end = endOrChar as Position;
    }
  }
  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }
  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      return positionOrRange.line >= this.start.line && positionOrRange.line <= this.end.line;
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;
  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
}

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly fsPath: string;
  readonly query: string;
  readonly fragment: string;

  private constructor(scheme: string, path: string, query = "", fragment = "") {
    this.scheme = scheme;
    this.authority = "";
    this.path = path;
    this.fsPath = path;
    this.query = query;
    this.fragment = fragment;
  }

  static file(path: string): Uri {
    return new Uri("file", path);
  }

  static parse(value: string): Uri {
    const [scheme, rest] = value.split(":", 2);
    const [path, query] = (rest || "").split("?", 2);
    return new Uri(scheme, path, query || "");
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const joined = [base.path, ...pathSegments].join("/");
    return new Uri(base.scheme, joined);
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

// --- Events ---

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    });
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Disposable {
  constructor(private callOnDispose: () => void) {}
  dispose(): void {
    this.callOnDispose();
  }
  static from(...disposables: { dispose: () => void }[]): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }
}

// --- Cancellation ---

export class CancellationTokenSource {
  token: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => new Disposable(() => {}),
  };
  cancel(): void {
    (this.token as any).isCancellationRequested = true;
  }
  dispose(): void {}
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => Disposable;
}

// --- Semantic Tokens ---

export class SemanticTokensLegend {
  constructor(
    public readonly tokenTypes: string[],
    public readonly tokenModifiers: string[] = []
  ) {}
}

export class SemanticTokensBuilder {
  private _tokens: Array<{
    line: number;
    char: number;
    length: number;
    tokenType: number;
    tokenModifiers: number;
  }> = [];

  constructor(private readonly legend?: SemanticTokensLegend) {}

  push(range: Range, tokenType: string, tokenModifiers?: string[]): void;
  push(
    line: number,
    char: number,
    length: number,
    tokenType: number,
    tokenModifiers?: number
  ): void;
  push(
    rangeOrLine: Range | number,
    tokenTypeOrChar: string | number,
    tokenModifiersOrLength?: string[] | number,
    tokenType?: number,
    tokenModifiers?: number
  ): void {
    if (rangeOrLine instanceof Range) {
      const typeIndex = this.legend ? this.legend.tokenTypes.indexOf(tokenTypeOrChar as string) : 0;
      let modBits = 0;
      if (Array.isArray(tokenModifiersOrLength) && this.legend) {
        for (const mod of tokenModifiersOrLength) {
          const idx = this.legend.tokenModifiers.indexOf(mod);
          if (idx >= 0) modBits |= 1 << idx;
        }
      }
      this._tokens.push({
        line: rangeOrLine.start.line,
        char: rangeOrLine.start.character,
        length: rangeOrLine.end.character - rangeOrLine.start.character,
        tokenType: typeIndex,
        tokenModifiers: modBits,
      });
    } else {
      this._tokens.push({
        line: rangeOrLine,
        char: tokenTypeOrChar as number,
        length: tokenModifiersOrLength as number,
        tokenType: tokenType ?? 0,
        tokenModifiers: tokenModifiers ?? 0,
      });
    }
  }

  build(): SemanticTokens {
    // Sort tokens by position
    this._tokens.sort((a, b) => a.line - b.line || a.char - b.char);

    // Encode as delta array
    const data: number[] = [];
    let prevLine = 0;
    let prevChar = 0;
    for (const token of this._tokens) {
      const deltaLine = token.line - prevLine;
      const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
      data.push(deltaLine, deltaChar, token.length, token.tokenType, token.tokenModifiers);
      prevLine = token.line;
      prevChar = token.char;
    }

    return { resultId: undefined, data: new Uint32Array(data) };
  }

  /** For testing: get raw token list */
  get tokens() {
    return [...this._tokens];
  }
}

export interface SemanticTokens {
  readonly resultId: string | undefined;
  readonly data: Uint32Array;
}

// --- CodeLens ---

export class CodeLens {
  range: Range;
  command?: Command;
  readonly isResolved: boolean;

  constructor(range: Range, command?: Command) {
    this.range = range;
    this.command = command;
    this.isResolved = command !== undefined;
  }
}

export interface Command {
  title: string;
  command: string;
  tooltip?: string;
  arguments?: unknown[];
}

// --- Inlay Hints ---

export enum InlayHintKind {
  Type = 1,
  Parameter = 2,
}

export class InlayHint {
  position: Position;
  label: string;
  kind?: InlayHintKind;
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: string | MarkdownString;

  constructor(position: Position, label: string, kind?: InlayHintKind) {
    this.position = position;
    this.label = label;
    this.kind = kind;
  }
}

// --- Code Actions ---

export class CodeAction {
  title: string;
  kind?: CodeActionKind;
  command?: Command;
  edit?: WorkspaceEdit;

  constructor(title: string, kind?: CodeActionKind) {
    this.title = title;
    this.kind = kind;
  }
}

export class CodeActionKind {
  static readonly QuickFix = new CodeActionKind("quickfix");
  static readonly Refactor = new CodeActionKind("refactor");
  static readonly Source = new CodeActionKind("source");
  static readonly Empty = new CodeActionKind("");

  constructor(public readonly value: string) {}

  append(parts: string): CodeActionKind {
    return new CodeActionKind(`${this.value}.${parts}`);
  }

  contains(other: CodeActionKind): boolean {
    return other.value.startsWith(this.value);
  }
}

// --- Diagnostics ---

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: number | string;
  relatedInformation?: DiagnosticRelatedInformation[];

  constructor(range: Range, message: string, severity?: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity ?? DiagnosticSeverity.Error;
  }
}

export class DiagnosticRelatedInformation {
  constructor(
    public readonly location: Location,
    public readonly message: string
  ) {}
}

export class Location {
  constructor(
    public readonly uri: Uri,
    public readonly range: Range
  ) {}
}

// --- Workspace Edit ---

export class WorkspaceEdit {
  private _edits: Array<{ uri: Uri; range: Range; newText: string }> = [];

  replace(uri: Uri, range: Range, newText: string): void {
    this._edits.push({ uri, range, newText });
  }

  insert(uri: Uri, position: Position, newText: string): void {
    this._edits.push({ uri, range: new Range(position, position), newText });
  }

  get size(): number {
    return this._edits.length;
  }

  entries(): Array<[Uri, Array<{ range: Range; newText: string }>]> {
    const map = new Map<string, Array<{ range: Range; newText: string }>>();
    for (const edit of this._edits) {
      const key = edit.uri.toString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ range: edit.range, newText: edit.newText });
    }
    return Array.from(map.entries()).map(([key, edits]) => {
      // Find the original URI for this key
      const uri = this._edits.find((e) => e.uri.toString() === key)!.uri;
      return [uri, edits] as [Uri, Array<{ range: Range; newText: string }>];
    });
  }
}

// --- Markdown ---

export class MarkdownString {
  value: string;
  isTrusted?: boolean;

  constructor(value?: string) {
    this.value = value ?? "";
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendText(value: string): MarkdownString {
    this.value += value;
    return this;
  }
}

// --- Configuration ---

class MockConfiguration {
  private data: Record<string, unknown>;

  constructor(data: Record<string, unknown> = {}) {
    this.data = data;
  }

  get<T>(key: string, defaultValue?: T): T {
    return (this.data[key] as T) ?? (defaultValue as T);
  }

  has(key: string): boolean {
    return key in this.data;
  }

  update(): Promise<void> {
    return Promise.resolve();
  }
}

// --- File System Watcher ---

class MockFileSystemWatcher {
  private _onDidChange = new EventEmitter<Uri>();
  private _onDidCreate = new EventEmitter<Uri>();
  private _onDidDelete = new EventEmitter<Uri>();

  readonly onDidChange = this._onDidChange.event;
  readonly onDidCreate = this._onDidCreate.event;
  readonly onDidDelete = this._onDidDelete.event;

  /** Test helper: simulate file change */
  _simulateChange(uri: Uri): void {
    this._onDidChange.fire(uri);
  }

  /** Test helper: simulate file create */
  _simulateCreate(uri: Uri): void {
    this._onDidCreate.fire(uri);
  }

  /** Test helper: simulate file delete */
  _simulateDelete(uri: Uri): void {
    this._onDidDelete.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidCreate.dispose();
    this._onDidDelete.dispose();
  }
}

// --- Diagnostic Collection ---

class MockDiagnosticCollection {
  name: string;
  private _entries = new Map<string, Diagnostic[]>();

  constructor(name: string) {
    this.name = name;
  }

  set(uri: Uri, diagnostics: Diagnostic[]): void {
    this._entries.set(uri.toString(), diagnostics);
  }

  delete(uri: Uri): void {
    this._entries.delete(uri.toString());
  }

  clear(): void {
    this._entries.clear();
  }

  get(uri: Uri): Diagnostic[] | undefined {
    return this._entries.get(uri.toString());
  }

  forEach(callback: (uri: Uri, diagnostics: Diagnostic[]) => void): void {
    for (const [key, diags] of this._entries) {
      callback(Uri.parse(key), diags);
    }
  }

  dispose(): void {
    this._entries.clear();
  }

  /** Test helper: get all entries */
  get entries() {
    return this._entries;
  }
}

// --- Output Channel ---

class MockOutputChannel {
  name: string;
  private _lines: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  appendLine(line: string): void {
    this._lines.push(line);
  }

  append(text: string): void {
    this._lines.push(text);
  }

  show(): void {}
  hide(): void {}
  clear(): void {
    this._lines = [];
  }
  dispose(): void {}

  /** Test helper: get all output */
  get lines() {
    return [...this._lines];
  }
}

// --- Status Bar ---

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

class MockStatusBarItem {
  text = "";
  tooltip = "";
  command = "";
  alignment: StatusBarAlignment;
  priority: number;

  constructor(alignment: StatusBarAlignment, priority: number) {
    this.alignment = alignment;
    this.priority = priority;
  }

  show(): void {}
  hide(): void {}
  dispose(): void {}
}

// --- Relative Pattern ---

export class RelativePattern {
  constructor(
    public readonly base: any,
    public readonly pattern: string
  ) {}
}

// --- Document Selector ---

export type DocumentSelector = Array<{ language: string; scheme?: string }>;

// --- Global namespace mocks ---

const _saveListeners: Array<(doc: any) => void> = [];
const _closeListeners: Array<(doc: any) => void> = [];
const _configData: Record<string, Record<string, unknown>> = {
  typesugar: {
    enableCodeLens: true,
    enableInlayHints: true,
    enableDiagnostics: true,
    manifestPath: "typesugar.manifest.json",
  },
};

let _fsReadFileHandler: ((uri: Uri) => Promise<Uint8Array>) | undefined;
let _fileSystemWatcher: MockFileSystemWatcher | undefined;
let _workspaceFolders: Array<{ uri: Uri; name: string; index: number }> | undefined;

export const workspace = {
  getConfiguration(section?: string): MockConfiguration {
    return new MockConfiguration(section ? (_configData[section] ?? {}) : {});
  },

  createFileSystemWatcher(_pattern: any): MockFileSystemWatcher {
    _fileSystemWatcher = new MockFileSystemWatcher();
    return _fileSystemWatcher;
  },

  onDidSaveTextDocument(listener: (doc: any) => void): Disposable {
    _saveListeners.push(listener);
    return new Disposable(() => {
      const idx = _saveListeners.indexOf(listener);
      if (idx >= 0) _saveListeners.splice(idx, 1);
    });
  },

  onDidCloseTextDocument(listener: (doc: any) => void): Disposable {
    _closeListeners.push(listener);
    return new Disposable(() => {
      const idx = _closeListeners.indexOf(listener);
      if (idx >= 0) _closeListeners.splice(idx, 1);
    });
  },

  get textDocuments(): any[] {
    return [];
  },

  get workspaceFolders() {
    return _workspaceFolders;
  },

  getWorkspaceFolder(uri: Uri) {
    return _workspaceFolders?.[0];
  },

  openTextDocument(uri: Uri): Promise<any> {
    return Promise.resolve(createMockTextDocument("", "test.ts"));
  },

  registerTextDocumentContentProvider(_scheme: string, _provider: any): Disposable {
    return new Disposable(() => {});
  },

  fs: {
    readFile(uri: Uri): Promise<Uint8Array> {
      if (_fsReadFileHandler) return _fsReadFileHandler(uri);
      return Promise.reject(new Error("File not found"));
    },
  },

  /** Test helper: set file read handler */
  _setFsReadFile(handler: (uri: Uri) => Promise<Uint8Array>): void {
    _fsReadFileHandler = handler;
  },

  /** Test helper: set workspace folders */
  _setWorkspaceFolders(folders: Array<{ uri: Uri; name: string; index: number }>): void {
    _workspaceFolders = folders;
  },

  /** Test helper: fire save event */
  _fireSave(doc: any): void {
    for (const listener of _saveListeners) listener(doc);
  },

  /** Test helper: fire close event */
  _fireClose(doc: any): void {
    for (const listener of _closeListeners) listener(doc);
  },

  /** Test helper: get file system watcher */
  get _fileSystemWatcher() {
    return _fileSystemWatcher;
  },

  /** Test helper: set config */
  _setConfig(section: string, data: Record<string, unknown>): void {
    _configData[section] = data;
  },
};

export const languages = {
  registerDocumentSemanticTokensProvider(_selector: any, _provider: any, _legend: any): Disposable {
    return new Disposable(() => {});
  },

  registerCodeLensProvider(_selector: any, _provider: any): Disposable {
    return new Disposable(() => {});
  },

  registerInlayHintsProvider(_selector: any, _provider: any): Disposable {
    return new Disposable(() => {});
  },

  registerCodeActionsProvider(_selector: any, _provider: any, _metadata?: any): Disposable {
    return new Disposable(() => {});
  },

  createDiagnosticCollection(name: string): MockDiagnosticCollection {
    return new MockDiagnosticCollection(name);
  },

  setTextDocumentLanguage(_doc: any, _language: string): Promise<any> {
    return Promise.resolve(_doc);
  },
};

export const window = {
  createOutputChannel(name: string): MockOutputChannel {
    return new MockOutputChannel(name);
  },

  createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): MockStatusBarItem {
    return new MockStatusBarItem(alignment ?? StatusBarAlignment.Left, priority ?? 0);
  },

  showWarningMessage(..._args: any[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },

  showInformationMessage(..._args: any[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },

  showErrorMessage(..._args: any[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },

  showQuickPick(..._args: any[]): Promise<any> {
    return Promise.resolve(undefined);
  },

  get activeTextEditor(): any {
    return undefined;
  },

  showTextDocument(_doc: any, _options?: any): Promise<any> {
    return Promise.resolve(undefined);
  },

  createTerminal(_options: any): any {
    return { show() {}, sendText() {}, dispose() {} };
  },
};

export const commands = {
  registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
    return new Disposable(() => {});
  },

  executeCommand(command: string, ...args: any[]): Promise<any> {
    return Promise.resolve(undefined);
  },

  getCommands(filterInternal?: boolean): Promise<string[]> {
    return Promise.resolve([]);
  },
};

export const extensions = {
  getExtension(_id: string): any {
    return undefined;
  },
};

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

// --- Test Helpers ---

export function createMockTextDocument(
  content: string,
  fileName: string,
  languageId = "typescript"
): any {
  const lines = content.split("\n");
  return {
    uri: Uri.file(fileName),
    fileName,
    languageId,
    version: 1,
    lineCount: lines.length,
    getText(range?: Range): string {
      if (!range) return content;
      const startOffset =
        lines.slice(0, range.start.line).reduce((acc, l) => acc + l.length + 1, 0) +
        range.start.character;
      const endOffset =
        lines.slice(0, range.end.line).reduce((acc, l) => acc + l.length + 1, 0) +
        range.end.character;
      return content.slice(startOffset, endOffset);
    },
    positionAt(offset: number): Position {
      let line = 0;
      let char = offset;
      for (const l of lines) {
        if (char <= l.length) return new Position(line, char);
        char -= l.length + 1;
        line++;
      }
      return new Position(lines.length - 1, lines[lines.length - 1]?.length ?? 0);
    },
    offsetAt(position: Position): number {
      let offset = 0;
      for (let i = 0; i < position.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
      }
      return offset + position.character;
    },
    lineAt(line: number): { text: string; range: Range } {
      const text = lines[line] ?? "";
      return {
        text,
        range: new Range(line, 0, line, text.length),
      };
    },
  };
}

/** Reset all mock state between tests */
export function resetMockState(): void {
  _saveListeners.length = 0;
  _closeListeners.length = 0;
  _fsReadFileHandler = undefined;
  _fileSystemWatcher = undefined;
  _workspaceFolders = undefined;
  Object.assign(_configData, {
    typesugar: {
      enableCodeLens: true,
      enableInlayHints: true,
      enableDiagnostics: true,
      manifestPath: "typesugar.manifest.json",
    },
  });
}
