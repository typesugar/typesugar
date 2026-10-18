/**
 * Tests for NewtypeAssignment diagnostic suppression rule (PEP-011 Wave 4)
 *
 * The rule only suppresses the spurious TS2345 on the argument of a
 * `wrap<T>()` / `newtypeCtor<T>()` / `validatedNewtype<T>()` constructor
 * (a parameter typed `UnwrapNewtype<T>`), which the transformer erases.
 * Implicit `Base → Newtype` assignments and brand mismatches stay errors —
 * that is what newtypes are for (docs/guides/type-system.md; deep-review
 * macros-other #9).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  registerDiagnosticSuppressionRule,
  clearDiagnosticSuppressionRules,
  evaluateDiagnosticSuppression,
  filterDiagnostics,
} from "@typesugar/core";
import { createNewtypeAssignmentRule } from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers: create a real TypeScript program to get actual diagnostics
// ---------------------------------------------------------------------------

/** Shared preamble that defines Newtype and branded type aliases. */
const NEWTYPE_PREAMBLE = `
declare const __brand: unique symbol;
type Newtype<Base, Brand extends string> = Base & {
  readonly [__brand]: Brand;
};

type UserId = Newtype<number, "UserId">;
type Email = Newtype<string, "Email">;
type Meters = Newtype<number, "Meters">;
type Seconds = Newtype<number, "Seconds">;

type UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T;
function wrap<T>(value: UnwrapNewtype<T>): T { return value as T; }
function unwrap<T>(value: T): UnwrapNewtype<T> { return value as UnwrapNewtype<T>; }
function newtypeCtor<T>(): (value: UnwrapNewtype<T>) => T { return (v) => v as T; }
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

function getAssignmentDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return getDiagnosticsForFile(diagnostics, fileName).filter(
    (d) => d.code === 2322 || d.code === 2345
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function firstVerdict(code: string, codes = [2322, 2345]): boolean | undefined {
  const { checker, diagnostics } = createProgram({ "/test.ts": `${NEWTYPE_PREAMBLE}\n${code}` });
  const diags = getDiagnosticsForFile(diagnostics, "/test.ts").filter((d) =>
    codes.includes(d.code)
  );
  expect(diags.length).toBeGreaterThan(0);
  return evaluateDiagnosticSuppression(diags[0], checker, diags[0].file!);
}

describe("NewtypeAssignment diagnostic suppression rule", () => {
  beforeEach(() => {
    clearDiagnosticSuppressionRules();
    registerDiagnosticSuppressionRule(createNewtypeAssignmentRule());
  });

  describe("rule creation", () => {
    it("creates a rule with correct metadata", () => {
      const rule = createNewtypeAssignmentRule();
      expect(rule.name).toBe("NewtypeAssignment");
      expect(rule.errorCodes).toEqual([2345]);
    });
  });

  describe("wrap() / newtype constructor arguments are suppressed", () => {
    it("suppresses the TS2345 from wrap<UserId>(42)", () => {
      expect(firstVerdict(`const id = wrap<UserId>(42);`)).toBe(true);
    });

    it("suppresses the TS2345 from wrap<Email>('user@test.com')", () => {
      expect(firstVerdict(`const e = wrap<Email>("user@test.com");`)).toBe(true);
    });

    it("suppresses a newtypeCtor-built constructor call", () => {
      expect(firstVerdict(`const mk = newtypeCtor<UserId>();\nconst id = mk(42);`)).toBe(true);
    });

    it("suppresses wrap() of a multi-constituent base", () => {
      expect(
        firstVerdict(`
interface Serializable { serialize(): string; }
interface Identifiable { id: string; }
type Tagged = Newtype<Serializable & Identifiable, "Tagged">;
declare const obj: Serializable & Identifiable;
const tagged = wrap<Tagged>(obj);
`)
      ).toBe(true);
    });

    it("filterDiagnostics removes wrap()'s TS2345 and keeps other diagnostics", () => {
      const { program, checker, diagnostics } = createProgram({
        "/test.ts": `${NEWTYPE_PREAMBLE}
const id = wrap<UserId>(42);
const raw = unwrap(id);
const bad = undeclaredVariable;
`,
      });
      const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
      expect(fileDiags.some((d) => d.code === 2345)).toBe(true);
      const filtered = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      expect(filtered.some((d) => d.code === 2345)).toBe(false);
      expect(filtered.some((d) => d.code === 2304)).toBe(true);
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

    it("does NOT suppress re-wrapping another newtype: wrap<Meters>(seconds)", () => {
      expect(firstVerdict(`declare const s: Seconds;\nconst m = wrap<Meters>(s);`)).toBe(false);
    });

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

    it("does NOT suppress unrelated types (string to number)", () => {
      expect(firstVerdict(`const x: number = "hello";`)).toBe(false);
    });

    it("does NOT treat a hand-rolled string-keyed __brand as a Newtype", () => {
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
