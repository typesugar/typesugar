/**
 * Session and assertion helpers for the editor integration tests.
 *
 * Each test file starts one tsserver on a fresh copy of a fixture project.
 * The fixture's tsconfig.json lists `@typesugar/transformer/language-service`,
 * so tsserver loads the plugin the way a user's editor does.
 *
 * Positions: tsserver uses 1-based lines and 1-based offsets. Tests find
 * positions by searching the fixture text (`locate`) rather than hard-coding
 * numbers, so editing a fixture's comments doesn't silently move a probe.
 */

import { expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { TsServerClient } from "./tsserver-client.js";
import { type PreparedFixture } from "./fixture-manager.js";

/** The plugin name the fixture's tsconfig.json lists (as users configure it). */
export const PLUGIN_NAME = "@typesugar/transformer/language-service";

export interface Location {
  line: number;
  offset: number;
}

export interface TsDiagnostic {
  start: Location;
  end: Location;
  text: string;
  code: number;
  category: string;
  source?: string;
}

export interface TsSession {
  client: TsServerClient;
  fixture: PreparedFixture;
}

/** Start tsserver for a prepared fixture. */
export async function initSession(fixture: PreparedFixture): Promise<TsSession> {
  const client = new TsServerClient({
    tsserverPath: fixture.tsserverPath,
    cwd: fixture.dir,
    // Where tsserver looks for tsconfig.json plugins. An editor running the
    // project's own node_modules/typescript gets this directory by default;
    // here tsserver runs from the monorepo, so name it explicitly.
    pluginProbeLocations: [fixture.dir],
    // Set TYPESUGAR_TSSERVER_LOG=/some/file to keep a verbose tsserver log
    // (it includes the plugin's "[typesugar]" lines).
    logFile: process.env.TYPESUGAR_TSSERVER_LOG,
  });
  await client.request("configure", {
    hostInfo: "typesugar-integration-tests",
    preferences: { includeCompletionsForModuleExports: false },
  });
  return { client, fixture };
}

export function fixturePath(session: TsSession, relativePath: string): string {
  return path.join(session.fixture.dir, relativePath);
}

/** Open a fixture file in tsserver (as an editor does when a tab opens). */
export function openFile(session: TsSession, relativePath: string): { file: string; text: string } {
  const file = fixturePath(session, relativePath);
  const text = fs.readFileSync(file, "utf8");
  session.client.notify("open", {
    file,
    fileContent: text,
    scriptKindName: "TS",
    projectRootPath: session.fixture.dir,
  });
  return { file, text };
}

/**
 * The 0-based character position of `needle` in `text` (plus `delta`
 * characters into it). `occurrence` picks the n-th match (0-based).
 */
export function positionOf(
  text: string,
  needle: string,
  options: { delta?: number; occurrence?: number } = {}
): number {
  let pos = -1;
  for (let i = 0; i <= (options.occurrence ?? 0); i++) {
    pos = text.indexOf(needle, pos + 1);
    if (pos === -1) throw new Error(`"${needle}" (occurrence ${i}) not found in fixture text`);
  }
  return pos + (options.delta ?? 0);
}

/** The 1-based line/offset of `needle` in `text`; options as for `positionOf`. */
export function locate(
  text: string,
  needle: string,
  options: { delta?: number; occurrence?: number } = {}
): Location {
  const pos = positionOf(text, needle, options);
  const before = text.slice(0, pos);
  return { line: before.split("\n").length, offset: pos - (before.lastIndexOf("\n") + 1) + 1 };
}

/** 1-based offset in `text` → 0-based character position. */
export function toPos(text: string, loc: Location): number {
  const lines = text.split("\n");
  let pos = 0;
  for (let i = 0; i < loc.line - 1; i++) pos += lines[i].length + 1;
  return pos + loc.offset - 1;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Syntactic + semantic diagnostics, as an editor shows them. */
export async function getDiagnostics(session: TsSession, file: string): Promise<TsDiagnostic[]> {
  const syntactic = await session.client.request<TsDiagnostic[]>("syntacticDiagnosticsSync", {
    file,
  });
  const semantic = await session.client.request<TsDiagnostic[]>("semanticDiagnosticsSync", {
    file,
  });
  return [...syntactic, ...semantic];
}

/** Assert a diagnostic starts at `at` and its message contains `messageContains`. */
export function assertDiagnosticAt(
  diagnostics: TsDiagnostic[],
  at: Location,
  messageContains: string,
  description?: string
): TsDiagnostic {
  const match = diagnostics.find(
    (d) =>
      d.start.line === at.line && d.start.offset === at.offset && d.text.includes(messageContains)
  );
  const prefix = description ? `${description}: ` : "";
  const found = diagnostics.map(
    (d) => `  ${d.start.line}:${d.start.offset} TS${d.code} ${d.text.slice(0, 70)}`
  );
  expect(
    match,
    `${prefix}expected a diagnostic at ${at.line}:${at.offset} containing "${messageContains}".\n` +
      `Found ${diagnostics.length}:\n${found.join("\n")}`
  ).toBeDefined();
  return match!;
}

// ---------------------------------------------------------------------------
// Language features
// ---------------------------------------------------------------------------

export interface FileSpan {
  file: string;
  start: Location;
  end: Location;
}

export async function getCompletionNames(
  session: TsSession,
  file: string,
  at: Location
): Promise<string[]> {
  const info = await session.client.request<{ entries: Array<{ name: string }> } | undefined>(
    "completionInfo",
    { file, ...at }
  );
  return (info?.entries ?? []).map((e) => e.name);
}

export async function getQuickInfo(
  session: TsSession,
  file: string,
  at: Location
): Promise<{ displayString: string; start: Location; end: Location } | undefined> {
  return session.client.request("quickinfo", { file, ...at });
}

export async function getDefinition(
  session: TsSession,
  file: string,
  at: Location
): Promise<FileSpan[]> {
  return (
    (await session.client.request<FileSpan[] | undefined>("definition", { file, ...at })) ?? []
  );
}

export async function getReferences(
  session: TsSession,
  file: string,
  at: Location
): Promise<Array<FileSpan & { isDefinition?: boolean }>> {
  const body = await session.client.request<{ refs: Array<FileSpan & { isDefinition?: boolean }> }>(
    "references",
    { file, ...at }
  );
  return body?.refs ?? [];
}

export async function getRenameLocations(
  session: TsSession,
  file: string,
  at: Location
): Promise<{ canRename: boolean; spans: FileSpan[] }> {
  const body = await session.client.request<{
    info: { canRename: boolean };
    locs: Array<{ file: string; locs: Array<{ start: Location; end: Location }> }>;
  }>("rename", { file, ...at });
  return {
    canRename: body.info.canRename,
    spans: body.locs.flatMap((group) => group.locs.map((l) => ({ file: group.file, ...l }))),
  };
}

/** The text a span covers. */
export function spanText(text: string, span: { start: Location; end: Location }): string {
  return text.slice(toPos(text, span.start), toPos(text, span.end));
}
