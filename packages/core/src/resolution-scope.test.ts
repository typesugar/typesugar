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
import {
  registerSyntaxMarkerFallback,
  clearSyntaxMarkerFallbackRegistry,
} from "./syntax-marker-fallback.js";

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

describe("scanImportsForScope — PEP-052 Wave 6 operator/method marker fallback", () => {
  afterEach(() => {
    clearSyntaxMarkerFallbackRegistry();
  });

  it("activates operator (and, by implication, method) syntax with NO program at all — the in-memory-host case the fallback exists for", () => {
    registerSyntaxMarkerFallback("@typesugar/std/syntax/eq/ops", { operators: ["Eq"] });

    const { entryFile } = createProject(
      {
        "consumer.ts": `import "@typesugar/std/syntax/eq/ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker); // no program — checker path can't run at all

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(true);
    expect(tracker.isMethodSyntaxActivated(entryFile.fileName, "Eq")).toBe(true);
  });

  it("activates method-only syntax with no program when only registered as a method fallback", () => {
    registerSyntaxMarkerFallback("@typesugar/std/syntax/eq", { methods: ["Eq"] });

    const { entryFile } = createProject(
      {
        "consumer.ts": `import "@typesugar/std/syntax/eq";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker);

    expect(tracker.isMethodSyntaxActivated(entryFile.fileName, "Eq")).toBe(true);
    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
  });

  it("activates nothing for an unregistered specifier (no false positives)", () => {
    registerSyntaxMarkerFallback("@typesugar/std/syntax/eq/ops", { operators: ["Eq"] });

    const { entryFile } = createProject(
      {
        "consumer.ts": `import "@typesugar/std/syntax/ord/ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker);

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Ord")).toBe(false);
  });

  it("is purely additive: coexists with, and never overrides, checker-based discovery in the same scan", () => {
    // The fallback registers a DIFFERENT typeclass (Ord) than the real marker
    // file (Eq) — proving the checker-based result for Eq survives untouched
    // alongside the fallback-only activation for Ord.
    registerSyntaxMarkerFallback("@typesugar/std/syntax/ord/ops", { operators: ["Ord"] });

    const { program, entryFile } = createProject(
      {
        "eq-ops.ts": EQ_OPS_MARKER,
        "consumer.ts": `import "./eq-ops";\nimport "@typesugar/std/syntax/ord/ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker, program);

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(true); // checker-found
    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Ord")).toBe(true); // fallback-found
  });

  it("respects file-level opt-out even when only the fallback would have activated", () => {
    registerSyntaxMarkerFallback("@typesugar/std/syntax/eq/ops", { operators: ["Eq"] });

    const { entryFile } = createProject(
      {
        "consumer.ts": `"use no typesugar";\nimport "@typesugar/std/syntax/eq/ops";\nexport const x = 1;\n`,
      },
      "consumer.ts"
    );

    const tracker = new ResolutionScopeTracker();
    scanImportsForScope(entryFile, tracker);

    expect(tracker.isOperatorSyntaxActivated(entryFile.fileName, "Eq")).toBe(false);
  });
});
