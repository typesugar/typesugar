/**
 * A fluent `match()` on a value TypeScript has narrowed reads it from a const
 * asserted to the value's declared type (`const _circle = circle as Shape;`),
 * so the expansion type-checks as the code was written (std's
 * match-scrutinee-typing.test.ts). The assertion is for the checker only: the
 * JavaScript must be byte-for-byte what it would be without it.
 *
 * Each file below (std's showcase and the docs playground examples that use
 * `match()`) is expanded once. Its type assertions (`e as T`, and the
 * parentheses the conditional chain puts around one, `(t as T) === "a"`) are
 * then cut out of the expanded text, which is what the expansion is without
 * the scrutinee assertion, and both texts are transpiled and compared. The
 * expanded text must have an assertion somewhere (the showcase matches on a
 * narrowed `circle`), or the comparison proves nothing.
 *
 * (This used to expand each file a second time with the assertion turned off
 * by an environment variable that std's match macro read: a behaviour switch
 * in the shipped package that existed only for this test.)
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { TransformationPipeline } from "@typesugar/transformer";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function matchExamples(): string[] {
  const out = [path.join(repoRoot, "packages/std/examples/showcase.ts")];
  const walk = (dir: string): void => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(".ts") && /\bmatch\(/.test(fs.readFileSync(p, "utf-8"))) out.push(p);
    }
  };
  walk(path.join(repoRoot, "docs/examples"));
  return out;
}

function expand(file: string): string {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    experimentalDecorators: true,
  };
  const pipeline = new TransformationPipeline(options, [file], { cacheDir: false });
  return pipeline.transform(file).code;
}

function toJs(code: string, file: string): string {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: file,
  }).outputText;
}

/** A read the conditional chain parenthesizes when it asserts it. */
function isPlainRead(e: ts.Expression): boolean {
  return (
    ts.isIdentifier(e) ||
    e.kind === ts.SyntaxKind.ThisKeyword ||
    ts.isPropertyAccessExpression(e) ||
    ts.isElementAccessExpression(e) ||
    ts.isCallExpression(e)
  );
}

/**
 * `code` with every type assertion cut out of the text (`as const` kept):
 * ` as T` after the expression, and the parentheses directly around an
 * assertion of a plain read. Edits are by position, so the rest of the text,
 * comments and layout included, is untouched.
 */
function withoutAssertions(code: string, file: string): { text: string; cut: number } {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);
  const cuts: [number, number][] = [];
  const isAssertion = (n: ts.Node): n is ts.AsExpression =>
    ts.isAsExpression(n) &&
    !(ts.isTypeReferenceNode(n.type) && n.type.typeName.getText(sf) === "const");
  const visit = (n: ts.Node): void => {
    if (isAssertion(n)) cuts.push([n.expression.end, n.end]);
    if (
      ts.isParenthesizedExpression(n) &&
      isAssertion(n.expression) &&
      isPlainRead(n.expression.expression)
    ) {
      const open = n.getStart(sf);
      cuts.push([open, open + 1], [n.end - 1, n.end]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  cuts.sort((a, b) => b[0] - a[0]);
  let text = code;
  for (const [from, to] of cuts) text = text.slice(0, from) + text.slice(to);
  return { text, cut: cuts.length };
}

describe("the scrutinee's type assertion leaves the JavaScript unchanged", () => {
  const files = matchExamples();
  let asserted = 0;

  for (const file of files) {
    it(path.relative(repoRoot, file), () => {
      const code = expand(file);
      if (/const _\w+ = \w+ as \w+/.test(code)) asserted++;
      const stripped = withoutAssertions(code, file);
      expect(toJs(stripped.text, file)).toBe(toJs(code, file));
    });
  }

  it("the assertion was added somewhere (the comparison is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(1);
    expect(asserted).toBeGreaterThan(0);
  });
});
