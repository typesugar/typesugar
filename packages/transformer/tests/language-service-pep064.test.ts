/**
 * PEP-064 in the language service: an imported object supplies extension
 * methods only when its import carries a JSDoc `@extension` tag. The editor
 * reports the TS2339 the CLI reports for an untagged import, hides it for a
 * tagged one, and the tag on the import raises no typesugar warning.
 */

import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import init from "../src/language-service.js";
import "@typesugar/macros";

const VDIR = path.resolve(__dirname, "__virtual_pep064__");

function createProject(files: Map<string, string>) {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    }),
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const c = files.get(f) ?? ts.sys.readFile(f);
      return c === undefined ? undefined : ts.ScriptSnapshot.fromString(c);
    },
    getCurrentDirectory: () => VDIR,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };
  const logger = { info: vi.fn(), msg: vi.fn() };
  const info = {
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project: {
      // NOT under packages/transformer/: the plugin skips typesugar's own infra projects.
      getProjectName: () => "/pep064-project/tsconfig.json",
      getCompilerOptions: () => host.getCompilationSettings(),
      getFileNames: () => Array.from(files.keys()),
      getCurrentDirectory: () => VDIR,
      projectService: { logger },
    },
    serverHost: {},
    config: {},
  } as unknown as ts.server.PluginCreateInfo;
  return init({ typescript: ts }).create(info);
}

const LOGGER = `export const log = { info(msg: unknown): string { return String(msg); } };\n`;

function diagnosticsOf(main: string): ts.Diagnostic[] {
  const mainPath = path.join(VDIR, "main.ts");
  const proxy = createProject(
    new Map([
      [path.join(VDIR, "logger.ts"), LOGGER],
      [mainPath, main],
    ])
  );
  return [...proxy.getSyntacticDiagnostics(mainPath), ...proxy.getSemanticDiagnostics(mainPath)];
}

describe("PEP-064 in the language service", () => {
  it("a tagged import: no TS2339, and no warning about the tag", () => {
    const diags = diagnosticsOf(`/** @extension */
import { log } from "./logger";
const user = { id: 1 };
export const r: string = user.info();
`);
    expect(
      diags.map((d) => `${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    ).toEqual([]);
  });

  it("a tag with no effect: a typesugar warning at the tag", () => {
    const diags = diagnosticsOf(`/** @extension */
import { log } from "./logger";
export const r: string = log.info("direct");
`);
    const warnings = diags.filter((d) =>
      /@extension tag has no effect/.test(ts.flattenDiagnosticMessageText(d.messageText, " "))
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].category).toBe(ts.DiagnosticCategory.Warning);
  });

  it("an untagged import: TS2339 on the call", () => {
    const diags = diagnosticsOf(`import { log } from "./logger";
const user = { id: 1 };
export const r: string = user.info();
`);
    expect(diags.map((d) => d.code)).toContain(2339);
  });
});
