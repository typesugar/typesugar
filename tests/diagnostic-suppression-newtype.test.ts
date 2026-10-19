/**
 * Newtypes under the full built-in diagnostic suppression rule set.
 *
 * There is no newtype-specific suppression rule any more: the former
 * NewtypeAssignment rule (PEP-011 Wave 4) only hid the spurious TS2345 that
 * the OLD inferred-base `UnwrapNewtype` produced on `wrap<T>()` /
 * `newtypeCtor<T>()` arguments. @typesugar/type-system's `UnwrapNewtype` now
 * reads a phantom `[__base]` slot, so those calls type-check on their own and
 * the rule was removed (2026-10).
 *
 * These tests use the REAL packages/type-system/src/newtype.ts and register
 * every built-in rule (`registerAllDiagnosticSuppressionRules`), checking that
 * (a) the constructors produce no assignment errors at all, and (b) the errors
 * newtypes exist to produce (implicit `Base → Newtype`, brand mismatches) are
 * still reported — no other rule hides them (docs/guides/type-system.md;
 * deep-review macros-other #9).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import {
  clearDiagnosticSuppressionRules,
  evaluateDiagnosticSuppression,
  filterDiagnostics,
} from "@typesugar/core";
import { registerAllDiagnosticSuppressionRules } from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers: create a real TypeScript program to get actual diagnostics
// ---------------------------------------------------------------------------

const NEWTYPE_MODULE = path.resolve(__dirname, "../packages/type-system/src/newtype.ts");

/** Shared preamble: the real Newtype API plus some branded type aliases. */
const NEWTYPE_PREAMBLE = `
import { wrap, unwrap, newtypeCtor, validatedNewtype, type Newtype, type UnwrapNewtype } from ${JSON.stringify(NEWTYPE_MODULE)};

type UserId = Newtype<number, "UserId">;
type Email = Newtype<string, "Email">;
type Meters = Newtype<number, "Meters">;
type Seconds = Newtype<number, "Seconds">;
`;

function createProgram(
  files: Record<string, string>,
  mainFile = "/test.ts"
): { program: ts.Program; checker: ts.TypeChecker; diagnostics: readonly ts.Diagnostic[] } {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
  };

  const fileMap = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    fileMap.set(name, content);
  }

  const host = ts.createCompilerHost(compilerOptions);
  const origGetSourceFile = host.getSourceFile;
  const origFileExists = host.fileExists;
  const origReadFile = host.readFile;

  host.getSourceFile = (fileName, languageVersion, onError) => {
    const content = fileMap.get(fileName);
    if (content !== undefined) {
      return ts.createSourceFile(fileName, content, languageVersion, true);
    }
    return origGetSourceFile.call(host, fileName, languageVersion, onError);
  };

  host.fileExists = (fileName) => {
    return fileMap.has(fileName) || origFileExists.call(host, fileName);
  };

  host.readFile = (fileName) => {
    return fileMap.get(fileName) ?? origReadFile.call(host, fileName);
  };

  const program = ts.createProgram(Array.from(fileMap.keys()), compilerOptions, host);
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program);

  return { program, checker, diagnostics };
}

function getDiagnosticsForFile(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return diagnostics.filter((d) => d.file?.fileName === fileName);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function fileDiagnostics(code: string) {
  const result = createProgram({ "/test.ts": `${NEWTYPE_PREAMBLE}\n${code}` });
  return { ...result, fileDiags: getDiagnosticsForFile(result.diagnostics, "/test.ts") };
}

/** The first TS2322/TS2345 in `code` exists, and whether any built-in rule suppresses it. */
function firstVerdict(code: string, codes = [2322, 2345]): boolean {
  const { checker, fileDiags } = fileDiagnostics(code);
  const diags = fileDiags.filter((d) => codes.includes(d.code));
  expect(diags.length).toBeGreaterThan(0);
  return evaluateDiagnosticSuppression(diags[0], checker, diags[0].file!);
}

describe("newtypes under the built-in diagnostic suppression rules", () => {
  beforeEach(() => {
    clearDiagnosticSuppressionRules();
    registerAllDiagnosticSuppressionRules();
  });

  describe("wrap() / newtype constructor calls need no suppression", () => {
    it.each([
      ["wrap<UserId>(42)", `const id = wrap<UserId>(42);`],
      ["wrap<Email>('user@test.com')", `const e = wrap<Email>("user@test.com");`],
      ["a newtypeCtor-built constructor", `const mk = newtypeCtor<UserId>();\nconst id = mk(42);`],
      [
        "a validatedNewtype constructor",
        `const mk = validatedNewtype<Email>((s) => s.includes("@"));\nconst e = mk("a@b");`,
      ],
      [
        "wrap() of a multi-constituent base",
        `interface Serializable { serialize(): string; }
interface Identifiable { id: string; }
type Tagged = Newtype<Serializable & Identifiable, "Tagged">;
declare const obj: Serializable & Identifiable;
const tagged = wrap<Tagged>(obj);`,
      ],
    ])("%s type-checks with no diagnostic", (_name, code) => {
      expect(fileDiagnostics(code).fileDiags.map((d) => d.code)).toEqual([]);
    });

    it("filterDiagnostics keeps unrelated diagnostics next to newtype code", () => {
      const { program, checker, fileDiags } = fileDiagnostics(`
const id = wrap<UserId>(42);
const raw = unwrap(id);
const bad = undeclaredVariable;
`);
      expect(fileDiags.map((d) => d.code)).toEqual([2304]);
      const filtered = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      expect(filtered.map((d) => d.code)).toEqual([2304]);
    });
  });

  describe("must still report", () => {
    it("does NOT suppress const id: UserId = 42 (implicit wrap)", () => {
      expect(firstVerdict(`const id: UserId = 42;`)).toBe(false);
    });

    it("does NOT suppress const email: Email = 'user@test.com'", () => {
      expect(firstVerdict(`const email: Email = "user@test.com";`)).toBe(false);
    });

    it("does NOT suppress passing a number literal to a UserId parameter", () => {
      expect(firstVerdict(`function getUser(id: UserId): void {}\ngetUser(42);`)).toBe(false);
    });

    it("does NOT suppress mixing different brands with the same base (Meters → Seconds)", () => {
      expect(firstVerdict(`declare const meters: Meters;\nconst seconds: Seconds = meters;`)).toBe(
        false
      );
    });

    // (Re-wrapping another newtype, `wrap<Meters>(seconds)`, is accepted by the
    // real library's types — `UnwrapNewtype<Meters>` is `number` — so there is
    // no diagnostic to keep; the old local-shape fixture's error came from the
    // inferred-base `UnwrapNewtype`.)

    it("does NOT suppress wrap() of the wrong base type", () => {
      expect(firstVerdict(`const id = wrap<UserId>("not a number");`)).toBe(false);
    });

    it("does NOT suppress wrap() when the source satisfies only one base constituent", () => {
      expect(
        firstVerdict(`
interface Serializable { serialize(): string; }
interface Identifiable { id: string; }
type Tagged = Newtype<Serializable & Identifiable, "Tagged">;
declare const partial: Serializable;
const tagged = wrap<Tagged>(partial);
`)
      ).toBe(false);
    });

    it("reports exactly the Feet argument in area(wrap<Meters>(10), wrap<Feet>(5))", () => {
      const { program, checker, fileDiags } = fileDiagnostics(`
type Feet = Newtype<number, "Feet">;
function area(w: Meters, h: Meters): number { return 0; }
area(wrap<Meters>(10), wrap<Feet>(5));
`);
      expect(fileDiags.map((d) => d.code)).toEqual([2345]);
      const kept = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      expect(kept).toHaveLength(1);
      expect(ts.flattenDiagnosticMessageText(kept[0].messageText, "\n")).toContain('"Feet"');
    });

    it("does NOT suppress unrelated types (string to number)", () => {
      expect(firstVerdict(`const x: number = "hello";`)).toBe(false);
    });

    it("does NOT suppress a hand-rolled string-keyed __brand passed to an UnwrapNewtype parameter", () => {
      expect(
        firstVerdict(`
type Token = string & { readonly __brand: "Token" };
declare function wrapToken(value: UnwrapNewtype<Token>): Token;
const t = wrapToken(42 as unknown as number);
`)
      ).toBe(false);
    });
  });
});
