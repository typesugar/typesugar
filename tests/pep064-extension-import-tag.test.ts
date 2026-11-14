/**
 * PEP-064: the JSDoc `@extension` tag on an import declaration is the
 * import-site opt-in for extension objects, and it is NOT the `@extension`
 * attribute macro: the JSDoc dispatcher only looks at declarations
 * (`isJSDocMacroTargetNode`), so the tag on an import never expands or
 * warns. Checked on every entry point that transforms a file (PEP-056
 * parity): the Node pipeline's `transformCode`, transformer-core's
 * `transformCode` with a program, and the playground's `transform`.
 */
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";

import "@typesugar/macros";

import { transformCode } from "@typesugar/transformer";
import { transformCode as transformCodeInMemory } from "@typesugar/transformer-core";
import { transform as playgroundTransform, clearCache } from "../packages/playground/src/index.js";

const LOGGER = `export const log = { info(msg: unknown): string { return String(msg); } };\n`;
const TAGGED = `/** @extension */
import { log } from "./logger";
const user = { id: 1 };
export const r = user.info();
`;
const UNTAGGED = TAGGED.replace("/** @extension */\n", "");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function project(main: string): { mainPath: string; program: ts.Program } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-pep064-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "logger.ts"), LOGGER);
  const mainPath = path.join(dir, "main.ts");
  fs.writeFileSync(mainPath, main);
  const program = ts.createProgram([mainPath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
  });
  return { mainPath, program };
}

type Diag = { severity: string; message: string };
const pipelines: [string, (main: string) => { code: string; diagnostics: Diag[] }][] = [
  [
    "@typesugar/transformer transformCode",
    (main) => {
      const { mainPath } = project(main);
      return transformCode(main, { fileName: mainPath });
    },
  ],
  [
    "@typesugar/transformer-core transformCode (with a program)",
    (main) => {
      const { mainPath, program } = project(main);
      return transformCodeInMemory(main, { fileName: mainPath, program });
    },
  ],
];

describe("PEP-064: a tagged import opts its objects in, on every pipeline", () => {
  it.each(pipelines)("%s: tagged rewrites, with no diagnostics", (_name, run) => {
    const r = run(TAGGED);
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("log.info(user)");
    expect(r.code).toContain("/** @extension */\nimport { log }");
  });

  it.each(pipelines)("%s: untagged leaves the call as written", (_name, run) => {
    const r = run(UNTAGGED);
    expect(r.code).toContain("user.info()");
    expect(r.code).not.toContain("log.info(user)");
  });
});

describe("PEP-064: the tag on an import is not the @extension attribute macro", () => {
  // A single file with no resolvable import: only the dispatch question.
  const code = `/** @extension */
import { log } from "some-unresolved-module";
export const n = 1;
`;

  // The only diagnostic is Wave 2's "no effect" warning (nothing uses the
  // import): no attribute-macro expansion, no "Unknown JSDoc macro tag".
  const onlyNoEffect = (diags: Diag[]) =>
    expect(diags.map((d) => d.message)).toEqual([expect.stringMatching(/tag has no effect/)]);

  it("transformer-core: only the no-effect warning, the import kept", () => {
    const r = transformCodeInMemory(code, { fileName: "pep064-dispatch-core.ts" });
    onlyNoEffect(r.diagnostics);
    expect(r.code).toContain(`/** @extension */\nimport { log } from "some-unresolved-module";`);
  });

  it("playground: only the no-effect warning, the import kept", () => {
    clearCache();
    const r = playgroundTransform(code, { fileName: "pep064-dispatch-playground.ts" });
    onlyNoEffect(r.diagnostics);
    expect(r.code).toContain(`import { log } from "some-unresolved-module";`);
  });
});

describe("PEP-064 Wave 2: a tag with no effect warns, on every pipeline", () => {
  // `log` is called directly, never as an extension: the tag enables nothing.
  const NO_EFFECT = `/** @extension */
import { log } from "./logger";
export const r = log.info("direct");
`;

  it.each(pipelines)("%s: one warning, at the tag", (_name, run) => {
    const r = run(NO_EFFECT);
    const warnings = r.diagnostics.filter((d) => /@extension tag has no effect/.test(d.message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
  });

  it.each(pipelines)("%s: no warning when the tag is used", (_name, run) => {
    expect(run(TAGGED).diagnostics).toEqual([]);
  });
});
