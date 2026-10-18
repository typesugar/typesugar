/**
 * `eslint --fix` through the typesugar processor must never corrupt a file
 * (deep review tooling #2), and locations must map through the transform
 * exactly (tooling #16).
 *
 * The end-to-end tests run the INSTALLED ESLint (flat config, `verifyAndFix`
 * — what `eslint --fix` does) with the plugin's recommended config, and
 * compare against an oracle: ESLint run WITHOUT the processor on the same
 * file with each macro region replaced by a same-length placeholder comment
 * (so rules see identical surrounding code and offsets), then the macro text
 * restored. For rules whose fixes don't touch macro regions, the two must be
 * identical.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Linter } from "eslint";
import plugin from "../src/index.js";
import { createProcessor } from "../src/processor.js";

const RULES: Linter.RulesRecord = {
  "no-var": "error",
  "prefer-const": "error",
  semi: "error",
  curly: "error",
  "dot-notation": "error",
  "object-shorthand": "error",
  "no-extra-boolean-cast": "error",
};

const LANGUAGE_OPTIONS: Linter.Config["languageOptions"] = {
  ecmaVersion: "latest",
  sourceType: "module",
};

function fixWithPlugin(source: string, filename = "/project/fixture.ts") {
  const linter = new Linter({ configType: "flat", cwd: "/project" });
  return linter.verifyAndFix(
    source,
    [{ files: ["**/*.ts"], ...plugin.configs!.recommended, rules: RULES }] as Linter.Config[],
    { filename }
  );
}

/** ESLint without the processor, macro regions neutralised to placeholder comments. */
function oracleFix(source: string, macroRegions: string[]) {
  let neutral = source;
  const placeholders = macroRegions.map((region, i) => {
    expect(region.length).toBeGreaterThanOrEqual(6);
    // same length, newlines kept (so lines/columns are unchanged), unique tag
    const tag = `M${i}`;
    const body = region.slice(2 + tag.length, -2).replace(/[^\n]/g, "_");
    const placeholder = `/*${tag}${body}*/`;
    expect(placeholder.length).toBe(region.length);
    expect(neutral.split(region)).toHaveLength(2); // region occurs exactly once
    neutral = neutral.replace(region, placeholder);
    return placeholder;
  });

  const linter = new Linter({ configType: "flat", cwd: "/project" });
  const r = linter.verifyAndFix(
    neutral,
    [{ files: ["**/*.ts"], languageOptions: LANGUAGE_OPTIONS, rules: RULES }] as Linter.Config[],
    { filename: "/project/fixture.ts" }
  );
  let output = r.output;
  placeholders.forEach((ph, i) => {
    expect(output.split(ph)).toHaveLength(2);
    output = output.replace(ph, macroRegions[i]);
  });
  return { output, messages: r.messages };
}

const DECORATOR = "@derive(Eq)";
const REQUIRES_BLOCK = `requires: {
    if (n) {
      var inner = n
    }
    n
  }`;

const FIXTURE = `${DECORATOR}
class A {}
var x = 1
let y = 2
console.log(x, y, A)
function f(n) {
  ${REQUIRES_BLOCK}
  let r = n
  if (r) r = !!r
  return r
}
let o = {
  ensures: {
    a: 1
  },
  f: function () { return 1 },
}
console.log(o["ensures"], f(1))
`;

describe("eslint --fix through the recommended config (tooling #2)", () => {
  it("produces exactly the oracle output and never corrupts the file", () => {
    const actual = fixWithPlugin(FIXTURE);
    const expected = oracleFix(FIXTURE, [DECORATOR, REQUIRES_BLOCK]);

    // Something was actually fixed (the test is not vacuous)...
    expect(actual.fixed).toBe(true);
    expect(actual.output).toContain("const x = 1;"); // no-var, then prefer-const
    expect(actual.output).toContain("const y = 2;");
    expect(actual.output).toContain("o.ensures");
    // ...and it is exactly what ESLint would produce on the untransformed file.
    expect(actual.output).toBe(expected.output);

    // Never corrupted: macro text untouched, and the result still parses.
    expect(actual.output).toContain(DECORATOR + "\nclass A {}");
    expect(actual.output).toContain(REQUIRES_BLOCK);
    expect(actual.messages.filter((m) => m.fatal)).toEqual([]);
    const reparsed = fixWithPlugin(actual.output);
    expect(reparsed.messages.filter((m) => m.fatal)).toEqual([]);
    // Fixing is idempotent: a second --fix pass changes nothing.
    expect(reparsed.output).toBe(actual.output);
  });

  it("the original review repro is no longer corrupted", () => {
    const src = `@derive(Eq)\nclass A {}\nvar x = 1\nconsole.log(x)\n`;
    const r = fixWithPlugin(src);
    expect(r.output).toBe(`@derive(Eq)\nclass A {}\nconst x = 1;\nconsole.log(x);\n`);
    expect(r.messages).toEqual([]);
  });

  it("fixes on a line the transform changed are dropped, not misapplied", () => {
    // `var` shares a line with the commented-out decorator: the line differs
    // between transformed and original text, so the fix can't be proven safe.
    const src = `@derive(Eq) class A { m() { var k = 1; return k } }\n`;
    const r = fixWithPlugin(src);
    expect(r.output).toBe(src);
    const noVar = r.messages.find((m) => m.ruleId === "no-var");
    expect(noVar).toBeDefined();
    // ...but the problem is still reported, at the right place (tooling #16).
    expect(noVar!.line).toBe(1);
    expect(noVar!.column).toBe(src.indexOf("var k") + 1);
    expect(noVar!.fix).toBeUndefined();
  });
});

describe("contract blocks and decorators are found by the parser (tooling #16)", () => {
  it("a requires: block with nested braces is fully commented out", () => {
    const src = `function f(x) {\n  requires: {\n    if (x) {\n      x;\n    }\n    x;\n  }\n  return x;\n}\nexport { f };\n`;
    const r = fixWithPlugin(src);
    expect(r.messages).toEqual([]);
    expect(r.output).toBe(src);
  });

  it("an object key named ensures is left alone", () => {
    const src = `const o = {\n  ensures: {\n    a: 1\n  },\n  b: 2,\n};\nconsole.log(o)\n`;
    const r = fixWithPlugin(src);
    expect(r.messages).toEqual([]);
    expect(r.output).toBe(src.replace("console.log(o)", "console.log(o);"));
  });

  it("maps a location after a decorator on the same line to the original column", () => {
    const src = `@derive(Eq) class Foo { m() { debugger; } }\n`;
    const linter = new Linter({ configType: "flat", cwd: "/project" });
    const msgs = linter.verify(
      src,
      [
        { files: ["**/*.ts"], ...plugin.configs!.recommended, rules: { "no-debugger": "error" } },
      ] as Linter.Config[],
      { filename: "/project/a.ts" }
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].column).toBe(src.indexOf("debugger") + 1);
    expect(msgs[0].endColumn).toBe(src.indexOf("debugger") + "debugger;".length + 1);
  });
});

describe("fix remapping through the HKT rewriter's source map", () => {
  // The HKT rewrite changes line lengths AND inserts an import line at the
  // top, so every transformed offset differs from the original one.
  const src = [
    "interface Functor<F> {",
    "  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;",
    "}",
    "var q = 1",
    "",
  ].join("\n");

  it("maps fixes on unchanged lines and drops fixes on rewritten lines", () => {
    const processor = createProcessor();
    const [transformed] = processor.preprocess!(src, "/project/hkt.ts") as string[];
    expect(transformed).not.toBe(src);
    expect(transformed).toContain("Kind<F, A>");

    const varAt = transformed.indexOf("var q");
    const mapAt = transformed.indexOf("map<A, B>");
    const lc = (offset: number) => {
      const before = transformed.slice(0, offset).split("\n");
      return { line: before.length, column: before[before.length - 1].length + 1 };
    };
    const messages: Linter.LintMessage[] = [
      {
        ruleId: "no-var",
        message: "Unexpected var",
        severity: 2,
        ...lc(varAt),
        fix: { range: [varAt, varAt + 3], text: "let" },
      },
      {
        ruleId: "semi",
        message: "Missing semicolon",
        severity: 2,
        ...lc(varAt + "var q = 1".length),
        fix: { range: [varAt + 9, varAt + 9], text: ";" },
      },
      {
        ruleId: "fake/rename-map",
        message: "rename",
        severity: 2,
        ...lc(mapAt),
        fix: { range: [mapAt, mapAt + 3], text: "fmap" },
        suggestions: [{ desc: "rename", fix: { range: [mapAt, mapAt + 3], text: "fmap" } }],
      },
    ];
    const out = processor.postprocess!([messages], "/project/hkt.ts");
    expect(out).toHaveLength(3);

    const origVar = src.indexOf("var q");
    expect(out[0].fix).toEqual({ range: [origVar, origVar + 3], text: "let" });
    expect(out[0].line).toBe(4);
    expect(out[0].column).toBe(1);
    expect(out[1].fix).toEqual({ range: [origVar + 9, origVar + 9], text: ";" });
    // The `map` line was rewritten (F<A> -> Kind<F, A>): no provably-safe mapping.
    expect(out[2].fix).toBeUndefined();
    expect(out[2].suggestions).toBeUndefined();
    expect(out[2].line).toBe(2);
    expect(out[2].column).toBe(3);
  });
});

describe("processor bookkeeping (tooling #27)", () => {
  it("reports the package.json version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(createProcessor().meta?.version).toBe(pkg.version);
    expect(plugin.meta?.version).toBe(pkg.version);
  });

  it("drops per-file state once postprocess has run", () => {
    const processor = createProcessor();
    const src = `import { derive } from "typesugar";\n@derive(Eq) class A {}\n`;
    const unused: Linter.LintMessage = {
      ruleId: "no-unused-vars",
      message: "'derive' is defined but never used",
      severity: 2,
      line: 1,
      column: 10,
    };
    processor.preprocess!(src, "/project/s.ts");
    expect(processor.postprocess!([[unused]], "/project/s.ts")).toEqual([]);
    // State is gone: a stray second postprocess passes messages through as-is.
    expect(processor.postprocess!([[unused]], "/project/s.ts")).toEqual([unused]);
  });
});
