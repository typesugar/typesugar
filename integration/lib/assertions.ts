/**
 * Test assertion helpers for LSP integration tests.
 *
 * Provides high-level assertions for diagnostics, completions,
 * hover, navigation, and other LSP features.
 */

import { expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import {
  LspClient,
  type LspDiagnostic,
  type LspCompletionItem,
  type LspHover,
  type LspLocation,
} from "./lsp-client.js";
import { type PreparedFixture } from "./fixture-manager.js";

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export interface LspSession {
  client: LspClient;
  fixture: PreparedFixture;
  rootUri: string;
}

/**
 * Initialize an LSP session for a prepared fixture.
 */
export async function initSession(fixture: PreparedFixture): Promise<LspSession> {
  const client = new LspClient(fixture.lspServerPath);
  const rootUri = `file://${fixture.dir}`;

  await client.request("initialize", {
    processId: null,
    rootUri,
    capabilities: {
      textDocument: {
        completion: { completionItem: { snippetSupport: false } },
        hover: {},
        definition: {},
        references: {},
        rename: {},
        codeAction: {},
        semanticTokens: { requests: { full: true } },
        inlayHint: {},
        codeLens: {},
        signatureHelp: {},
      },
    },
  });
  await client.notify("initialized", {});

  return { client, fixture, rootUri };
}

/**
 * Open a file in the LSP session and wait for initial diagnostics.
 */
export async function openFile(
  session: LspSession,
  relativePath: string,
  waitForDiagnostics = true
): Promise<{ uri: string; text: string; diagnostics: LspDiagnostic[] }> {
  const filePath = path.join(session.fixture.dir, relativePath);
  const text = fs.readFileSync(filePath, "utf8");
  const uri = `file://${filePath}`;

  // Determine languageId from extension
  const ext = path.extname(relativePath);
  const languageId =
    ext === ".sts"
      ? "sugared-typescript"
      : ext === ".stsx"
        ? "sugared-typescriptreact"
        : relativePath.endsWith(".tsx")
          ? "typescriptreact"
          : "typescript";

  await session.client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId, version: 1, text },
  });

  let diagnostics: LspDiagnostic[] = [];
  if (waitForDiagnostics) {
    const result = await session.client.waitForNotification<{
      uri: string;
      diagnostics: LspDiagnostic[];
    }>("textDocument/publishDiagnostics", (p) => (p as { uri: string }).uri === uri);
    diagnostics = result?.diagnostics ?? [];
  }

  return { uri, text, diagnostics };
}

// ---------------------------------------------------------------------------
// Diagnostic assertions
// ---------------------------------------------------------------------------

/**
 * Assert that a diagnostic exists at the expected line with matching message.
 */
export function assertDiagnosticAt(
  diagnostics: LspDiagnostic[],
  line: number,
  messageContains: string,
  description?: string
) {
  const match = diagnostics.find(
    (d) => d.range.start.line === line && d.message.includes(messageContains)
  );
  const prefix = description ? `${description}: ` : "";
  const diagLines = diagnostics.map(
    (d) => `  line ${d.range.start.line}: ${d.message.slice(0, 60)}`
  );
  expect(
    match,
    `${prefix}Expected diagnostic on line ${line} containing "${messageContains}".\n` +
      `Found ${diagnostics.length} diagnostics:\n${diagLines.join("\n")}`
  ).toBeDefined();
}

/**
 * Assert that no diagnostic exists at the given line.
 */
export function assertNoDiagnosticAt(
  diagnostics: LspDiagnostic[],
  line: number,
  description?: string
) {
  const match = diagnostics.filter((d) => d.range.start.line === line);
  const prefix = description ? `${description}: ` : "";
  expect(
    match.length,
    `${prefix}Expected no diagnostics on line ${line}, but found ${match.length}`
  ).toBe(0);
}

/**
 * Assert that a diagnostic's range spans the expected columns.
 */
export function assertDiagnosticSpan(
  diagnostics: LspDiagnostic[],
  line: number,
  startChar: number,
  endChar: number,
  description?: string
) {
  const match = diagnostics.find((d) => d.range.start.line === line);
  const prefix = description ? `${description}: ` : "";
  expect(match, `${prefix}No diagnostic found on line ${line}`).toBeDefined();
  expect(match!.range.start.character, `${prefix}start character`).toBe(startChar);
  expect(match!.range.end.character, `${prefix}end character`).toBe(endChar);
}

// ---------------------------------------------------------------------------
// Completion assertions
// ---------------------------------------------------------------------------

/**
 * Request completions at a position and return the items.
 */
export async function getCompletions(
  session: LspSession,
  uri: string,
  line: number,
  character: number
): Promise<LspCompletionItem[]> {
  const result = await session.client.request<LspCompletionItem[] | { items: LspCompletionItem[] }>(
    "textDocument/completion",
    { textDocument: { uri }, position: { line, character } }
  );
  if (Array.isArray(result)) return result;
  return result?.items ?? [];
}

/**
 * Assert that completions at a position include the expected label.
 */
export async function assertCompletionContains(
  session: LspSession,
  uri: string,
  line: number,
  character: number,
  expectedLabel: string,
  description?: string
) {
  const items = await getCompletions(session, uri, line, character);
  const match = items.find((i) => i.label === expectedLabel);
  const prefix = description ? `${description}: ` : "";
  expect(
    match,
    `${prefix}Expected completion "${expectedLabel}" at ${line}:${character}. ` +
      `Got: [${items
        .slice(0, 10)
        .map((i) => i.label)
        .join(", ")}...]`
  ).toBeDefined();
}

// ---------------------------------------------------------------------------
// Hover assertions
// ---------------------------------------------------------------------------

/**
 * Request hover at a position.
 */
export async function getHover(
  session: LspSession,
  uri: string,
  line: number,
  character: number
): Promise<LspHover | null> {
  return session.client.request<LspHover | null>("textDocument/hover", {
    textDocument: { uri },
    position: { line, character },
  });
}

/**
 * Assert hover at a position contains expected text.
 */
export async function assertHoverContains(
  session: LspSession,
  uri: string,
  line: number,
  character: number,
  expectedText: string,
  description?: string
) {
  const hover = await getHover(session, uri, line, character);
  const prefix = description ? `${description}: ` : "";
  expect(hover, `${prefix}No hover at ${line}:${character}`).not.toBeNull();
  const value = typeof hover!.contents === "string" ? hover!.contents : hover!.contents.value;
  expect(value, `${prefix}Hover doesn't contain "${expectedText}"`).toContain(expectedText);
}

// ---------------------------------------------------------------------------
// Navigation assertions
// ---------------------------------------------------------------------------

/**
 * Request go-to-definition at a position.
 */
export async function getDefinition(
  session: LspSession,
  uri: string,
  line: number,
  character: number
): Promise<LspLocation | LspLocation[] | null> {
  return session.client.request<LspLocation | LspLocation[] | null>("textDocument/definition", {
    textDocument: { uri },
    position: { line, character },
  });
}

/**
 * Assert go-to-definition at a position jumps to expected line.
 */
export async function assertDefinitionAt(
  session: LspSession,
  uri: string,
  fromLine: number,
  fromChar: number,
  expectedLine: number,
  description?: string
) {
  const def = await getDefinition(session, uri, fromLine, fromChar);
  const prefix = description ? `${description}: ` : "";
  expect(def, `${prefix}No definition found at ${fromLine}:${fromChar}`).not.toBeNull();
  const loc = Array.isArray(def) ? def[0] : def;
  expect(loc!.range.start.line, `${prefix}definition line`).toBe(expectedLine);
}

/**
 * Request find-references at a position.
 */
export async function getReferences(
  session: LspSession,
  uri: string,
  line: number,
  character: number
): Promise<LspLocation[]> {
  return (
    (await session.client.request<LspLocation[]>("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    })) ?? []
  );
}

// ---------------------------------------------------------------------------
// Code action assertions
// ---------------------------------------------------------------------------

export interface LspCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LspDiagnostic[];
}

/**
 * Request code actions at a range.
 */
export async function getCodeActions(
  session: LspSession,
  uri: string,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
): Promise<LspCodeAction[]> {
  return (
    (await session.client.request<LspCodeAction[]>("textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      context: { diagnostics: [] },
    })) ?? []
  );
}

// ---------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------

export interface SemanticTokensResult {
  data: number[];
}

export async function getSemanticTokens(
  session: LspSession,
  uri: string
): Promise<SemanticTokensResult | null> {
  return session.client.request<SemanticTokensResult | null>("textDocument/semanticTokens/full", {
    textDocument: { uri },
  });
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export interface LspWorkspaceEdit {
  changes?: Record<string, Array<{ range: LspLocation["range"]; newText: string }>>;
}

export async function getRename(
  session: LspSession,
  uri: string,
  line: number,
  character: number,
  newName: string
): Promise<LspWorkspaceEdit | null> {
  return session.client.request<LspWorkspaceEdit | null>("textDocument/rename", {
    textDocument: { uri },
    position: { line, character },
    newName,
  });
}
