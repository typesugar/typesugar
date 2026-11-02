/**
 * A SourceFile that is NOT the program's own copy (packages/transformer's
 * pipeline makes a detached copy when the preprocessed text differs) has no
 * binder data, so `checker.getSymbolAtLocation` on its nodes throws
 * ("Cannot read properties of undefined (reading 'members')") — seen as a
 * warning for `class IOCancelledError extends Error` in packages/fp/src/io/io.ts.
 * Macro resolution must not hand such nodes to the checker at all.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, HygieneContext } from "@typesugar/core";
import { MacroTransformer } from "../src/transformer.js";

const SRC = [
  "export class IOCancelledError extends Error {",
  "  constructor() {",
  '    super("IO fiber was cancelled");',
  "  }",
  "}",
  "type Either<E, A> = { left: E } | { right: A };",
  "export interface Async<A> {",
  "  readonly register: (cb: (result: Either<Error, A>) => void) => void;",
  "}",
  "export const IO = {",
  "  handleError<A>(fa: A, handler: (e: Error) => A): A { return fa ?? handler(new Error()); },",
  "};",
].join("\n");

function program(): ts.Program {
  const files: Record<string, string> = { "/p/io.ts": SRC };
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, skipLibCheck: true };
  // Real lib files, so `Error` resolves exactly as in packages/fp.
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lv, ...rest) =>
    name in files ? ts.createSourceFile(name, files[name], lv, true) : orig(name, lv, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => f in files || origExists(f);
  return ts.createProgram(["/p/io.ts"], options, host);
}

afterEach(() => vi.restoreAllMocks());

describe("macro resolution on a detached (unbound) SourceFile", () => {
  it("does not call the checker on its nodes (no 'symbol lookup failed' warning)", () => {
    const prog = program();
    const detached = ts.createSourceFile("/p/io.ts", SRC, ts.ScriptTarget.ES2022, true);
    expect(prog.getSourceFile("/p/io.ts")).not.toBe(detached);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const factory: ts.TransformerFactory<ts.SourceFile> = (context) => (sf) => {
      const ctx = new MacroContextImpl(
        prog,
        prog.getTypeChecker(),
        sf,
        context.factory,
        context,
        new HygieneContext()
      );
      const transformer = new MacroTransformer(ctx, false);
      return ts.visitNode(sf, transformer.visit.bind(transformer)) as ts.SourceFile;
    };
    const result = ts.transform(detached, [factory]);
    const out = ts.createPrinter().printFile(result.transformed[0]);
    result.dispose();
    expect(out).toContain("extends Error");
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.filter((m) => m.includes("symbol lookup"))).toEqual([]);
  });
});
