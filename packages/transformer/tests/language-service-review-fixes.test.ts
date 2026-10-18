/**
 * Regression tests for the 2026-10 deep-review findings against the
 * language-service plugin (findings-transformer.md #17, #20; macros-a's
 * comptime-in-editor gate).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import init from "../src/language-service.js";
import "@typesugar/macros";

const VDIR = path.resolve(__dirname, "__virtual_review__");

function createProject(files: Map<string, string>, config: Record<string, unknown> = {}) {
  const versions = new Map<string, number>();
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    }),
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: (f) => String(versions.get(f) ?? 1),
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
      getProjectName: () => "/review-project/tsconfig.json",
      getCompilerOptions: () => host.getCompilationSettings(),
      getFileNames: () => Array.from(files.keys()),
      getCurrentDirectory: () => VDIR,
      projectService: { logger },
    },
    serverHost: {},
    config,
  } as unknown as ts.server.PluginCreateInfo;
  const proxy = init({ typescript: ts }).create(info);
  const edit = (f: string, content: string) => {
    files.set(f, content);
    versions.set(f, (versions.get(f) ?? 1) + 1);
  };
  const served = (f: string) => {
    const snap = host.getScriptSnapshot(f)!;
    return snap.getText(0, snap.getLength());
  };
  return { proxy, host, edit, served, logger };
}

afterEach(() => {
  delete process.env.TYPESUGAR_COMPTIME_IN_EDITOR;
});

describe("finding #17: LS re-transforms a file when a dependency changes", () => {
  it("fieldNames<T>() output follows an edit to T in another file", () => {
    const lib = path.join(VDIR, "ls-dep-lib.ts");
    const main = path.join(VDIR, "ls-dep-main.ts");
    const files = new Map([
      [lib, `export interface User { id: number }\n`],
      [
        main,
        `import { fieldNames } from "@typesugar/macros";\nimport type { User } from "./ls-dep-lib";\nexport const f = fieldNames<User>();\n`,
      ],
    ]);
    const { host, edit, served } = createProject(files);
    expect(served(main)).toContain(`["id"]`);
    const v1 = host.getScriptVersion(main);

    edit(lib, `export interface User { id: number; name: string }\n`);
    expect(served(main)).toContain(`["id", "name"]`);
    expect(host.getScriptVersion(main)).not.toBe(v1);
  });
});

describe("finding #20: LS verbose logging is opt-in", () => {
  it("does not log pipeline internals by default", () => {
    const main = path.join(VDIR, "ls-quiet.ts");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { served } = createProject(
        new Map([
          [
            main,
            `import { comptime } from "@typesugar/macros";\nexport const a = comptime(() => 1);\n`,
          ],
        ])
      );
      served(main);
      const pipelineLogs = log.mock.calls.filter((c) =>
        String(c[0]).startsWith("[typesugar] Processing:")
      );
      expect(pipelineLogs).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});

describe("comptime in the editor is opt-in (TYPESUGAR_COMPTIME_IN_EDITOR)", () => {
  it("leaves comptime() unexpanded by default", () => {
    const main = path.join(VDIR, "ls-comptime-off.ts");
    const { served } = createProject(
      new Map([
        [
          main,
          `import { comptime } from "@typesugar/macros";\nexport const a = comptime(() => 40 + 2);\n`,
        ],
      ])
    );
    expect(served(main)).toContain("comptime(");
  });

  it("evaluates comptime() when the user opts in", () => {
    process.env.TYPESUGAR_COMPTIME_IN_EDITOR = "1";
    const main = path.join(VDIR, "ls-comptime-on.ts");
    const { served } = createProject(
      new Map([
        [
          main,
          `import { comptime } from "@typesugar/macros";\nexport const a = comptime(() => 40 + 2);\n`,
        ],
      ])
    );
    expect(served(main)).toContain("a = 42");
  });
});
