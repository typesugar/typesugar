/**
 * Tests for PEP-052 syntax-activation marker discovery in scanImportsForScope.
 *
 * A marker module is a tiny file whose first statement carries a module-level
 * JSDoc tag (`@syntax-operators <TC>` / `@syntax-methods <TC>`). Importing it as
 * a side-effect import activates that typeclass's operator/method syntax in the
 * importing file. Operators imply methods.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ResolutionScopeTracker, scanImportsForScope } from "./resolution-scope.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups.length = 0;
});

/**
 * Write a set of files to a temp dir and build a program over the entry file.
 * Re-parses every fixture with setParentNodes=true so JSDoc tags are visible.
 */
function createProject(files: Record<string, string>, entry: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-test-"));
  const paths: Record<string, string> = {};
  for (const [name, source] of Object.entries(files)) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, source);
    paths[name] = filePath;
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fn, languageVersion, onError, shouldCreate);
    if (sf && Object.values(paths).includes(fn)) {
      return ts.createSourceFile(fn, sf.text, languageVersion, true);
    }
    return sf;
  };

  const program = ts.createProgram(Object.values(paths), options, host);
  cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return { program, entryFile: program.getSourceFile(paths[entry])!, paths };
}

const EQ_OPS_MARKER = `/** @syntax-operators Eq */\nexport {};\n`;
const EQ_METHODS_MARKER = `/** @syntax-methods Eq */\nexport {};\n`;

describe("scanImportsForScope — PEP-052 activation markers", () => {
  it("activates operator syntax (and methods, since operators imply methods) from a /ops marker", () => {
    const { program, entryFile } = createProject(
      {
        "eq-ops.ts": EQ_OPS_MARKER,
        "consumer.ts": `import "./eq-ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker, program);

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(true);
    // operators imply methods
    expect(tracker.isMethodSyntaxActivated(entryFile.fileName, "Eq")).toBe(true);
  });

  it("activates only method syntax from a methods-only marker", () => {
    const { program, entryFile } = createProject(
      {
        "eq.ts": EQ_METHODS_MARKER,
        "consumer.ts": `import "./eq";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker, program);

    expect(tracker.isMethodSyntaxActivated(entryFile.fileName, "Eq")).toBe(true);
    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
  });

  it("activates nothing when no marker is imported", () => {
    const { program, entryFile } = createProject(
      {
        "eq-ops.ts": EQ_OPS_MARKER,
        "consumer.ts": `export const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker, program);

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
    expect(tracker.isMethodSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
  });

  it("does not discover markers without a program (registry-only callers)", () => {
    const { entryFile } = createProject(
      {
        "eq-ops.ts": EQ_OPS_MARKER,
        "consumer.ts": `import "./eq-ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker); // no program

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
  });

  it("respects file-level opt-out", () => {
    const { program, entryFile } = createProject(
      {
        "eq-ops.ts": EQ_OPS_MARKER,
        "consumer.ts": `"use no typesugar";\nimport "./eq-ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker, program);

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
    expect(tracker.isMethodSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
  });
});
