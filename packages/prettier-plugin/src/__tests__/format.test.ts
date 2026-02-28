import { describe, it, expect } from "vitest";
import { preFormat } from "../pre-format.js";
import { postFormat } from "../post-format.js";
import { format } from "../format.js";

describe("preFormat", () => {
  it("converts pipeline operators to __binop__", () => {
    const source = `const x = a |> f |> g;`;
    const result = preFormat(source);

    expect(result.changed).toBe(true);
    expect(result.code).toContain("__binop__");
    expect(result.code).toContain('"|>"');
    // The raw |> operator should not appear (only inside string literals)
    expect(result.code.replace(/"\|>"/g, "")).not.toContain("|>");
  });

  it("converts cons operators to __binop__", () => {
    const source = `const list = 1 :: 2 :: [];`;
    const result = preFormat(source);

    expect(result.changed).toBe(true);
    expect(result.code).toContain("__binop__");
    expect(result.code).toContain('"::"');
  });

  it("converts HKT declarations with markers", () => {
    const source = `interface Functor<F<_>> { map: <A>(fa: F<A>) => F<A>; }`;
    const result = preFormat(source);

    expect(result.changed).toBe(true);
    expect(result.code).toContain("/*@ts:hkt*/");
    expect(result.code).not.toContain("<_>");
    expect(result.code).toContain("Kind<F,");
  });

  it("passes through plain TypeScript unchanged", () => {
    const source = `const x = 42;\nconst y = x + 1;`;
    const result = preFormat(source);

    expect(result.changed).toBe(false);
    expect(result.code).toBe(source);
  });

  it("extracts HKT param metadata", () => {
    const source = `interface Functor<F<_>> { map: (fa: F<number>) => F<string>; }`;
    const result = preFormat(source);

    expect(result.metadata.hktParams.length).toBeGreaterThan(0);
    expect(result.metadata.hktParams[0].name).toBe("F");
  });
});

describe("postFormat", () => {
  it("reverses __binop__ to pipeline operators", () => {
    const formatted = `const x = __binop__(__binop__(a, "|>", f), "|>", g);`;
    const metadata = { changed: true, hktParams: [] };
    const result = postFormat(formatted, metadata);

    expect(result).toContain("|>");
    expect(result).not.toContain("__binop__");
  });

  it("reverses __binop__ to cons operators", () => {
    const formatted = `const list = __binop__(1, "::", __binop__(2, "::", []));`;
    const metadata = { changed: true, hktParams: [] };
    const result = postFormat(formatted, metadata);

    expect(result).toContain("::");
    expect(result).not.toContain("__binop__");
  });

  it("reverses HKT declaration markers", () => {
    const formatted = `interface Functor<F /*@ts:hkt*/> {}`;
    const metadata = { changed: true, hktParams: [] };
    const result = postFormat(formatted, metadata);

    expect(result).toContain("F<_>");
    expect(result).not.toContain("/*@ts:hkt*/");
  });

  it("reverses HKT usages (Kind<F, A> to F<A>)", () => {
    const formatted = `interface Functor<F /*@ts:hkt*/> { map: (fa: Kind<F, number>) => Kind<F, string>; }`;
    const metadata = {
      changed: true,
      hktParams: [{ name: "F", scope: { start: 0, end: 100 } }],
    };
    const result = postFormat(formatted, metadata);

    expect(result).toContain("F<number>");
    expect(result).toContain("F<string>");
    expect(result).not.toContain("Kind<F,");
  });

  it("passes through unchanged code", () => {
    const source = `const x = 42;`;
    const metadata = { changed: false, hktParams: [] };
    const result = postFormat(source, metadata);

    expect(result).toBe(source);
  });
});

describe("format (round-trip)", () => {
  it("formats and preserves pipeline operators", async () => {
    const source = `const x=a|>f|>g;`;
    const result = await format(source, { filepath: "test.ts" });

    expect(result).toContain("|>");
    expect(result).not.toContain("__binop__");
  });

  it("formats and preserves cons operators", async () => {
    const source = `const list=1::2::[];`;
    const result = await format(source, { filepath: "test.ts" });

    expect(result).toContain("::");
    expect(result).not.toContain("__binop__");
  });

  it("formats and preserves HKT syntax", async () => {
    const source = `interface Functor<F<_>> {map:(fa:F<A>)=>F<B>;}`;
    const result = await format(source, { filepath: "test.ts" });

    expect(result).toContain("F<_>");
    expect(result).not.toContain("/*@ts:hkt*/");
    expect(result).not.toContain("Kind<F,");
  });

  it("is idempotent (format(format(x)) === format(x))", async () => {
    const source = `const x = a |> f |> g;`;

    const once = await format(source, { filepath: "test.ts" });
    const twice = await format(once, { filepath: "test.ts" });

    expect(twice).toBe(once);
  });

  it("handles plain TypeScript unchanged", async () => {
    const source = `const x = 42;\nconst y = x + 1;\n`;
    const result = await format(source, { filepath: "test.ts" });

    // Should just be formatted, no custom syntax
    expect(result).not.toContain("__binop__");
    expect(result).not.toContain("/*@ts:hkt*/");
  });
});
