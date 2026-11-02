/**
 * @typesugar/codec — end-to-end tests through the REAL transformer: expand
 * `@codec` sources, then execute the emitted schema with the real runtime.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../src/macros.js";
import * as runtime from "../src/index.js";
// @ts-ignore -- load the transformer's built pipeline directly
import { transformCode } from "../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../__codec_e2e_input.ts");

function expand(body: string) {
  const src = `import { defineSchema, codec, since, removed, renamed, defaultValue } from "@typesugar/codec";\n${body}`;
  const r = transformCode(src, { fileName: FILE });
  const diags: any[] = r.diagnostics ?? [];
  const msg = (d: any) => String(d.message ?? d.messageText);
  return {
    code: r.code as string,
    errors: diags.filter((d) => d.severity === "error").map(msg),
    warnings: diags.filter((d) => d.severity === "warning").map(msg),
  };
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/codec") return runtime;
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

describe("#20 field decorators are consumed, not re-expanded", () => {
  it("class with @since/@removed/@renamed/@defaultValue expands once and runs", () => {
    const e = expand(`
@codec(3)
export class User {
  name: string = "";
  @since(2) @defaultValue(0) age?: number;
  @removed(3) legacy?: string;
  @renamed(3, "mail") @since(2) @defaultValue("") email: string = "";
}
export { UserSchema };
`);
    expect(e.errors).toEqual([]);
    expect(e.code).not.toMatch(/@\d/);
    expect(e.code).not.toMatch(/@(since|removed|renamed|defaultValue)\b/);
    const m = run(e.code);
    const s = m.UserSchema;
    expect(s.version).toBe(3);
    const age = s.fields.find((f: any) => f.name === "age");
    expect(age).toMatchObject({ since: 2, defaultValue: 0, optional: true });
    const c = runtime.createJsonCodec<any>(s);
    expect(c.decodeAny('{"__v":1,"name":"a","legacy":"x"}')).toEqual({
      name: "a",
      age: 0,
      email: "",
    });
  });
});

// TypeScript cannot parse decorators on interface members (the interface body
// ends at the first one), so the documented form uses a class.
describe("#20 docs/guides/codec.md example (class form)", () => {
  it("expands a class with member decorators", () => {
    const e = expand(`
@codec({ version: 3 })
class UserProfile {
  name!: string;
  @since(2) @defaultValue("") email!: string;
  @since(3) @defaultValue({}) preferences!: object;
  @removed(3) legacyField?: string;
  @since(2) @defaultValue(new Date(0)) joined!: Date;
}
export { UserProfileSchema };
`);
    expect(e.errors).toEqual([]);
    expect(e.code).not.toMatch(/@(since|removed|defaultValue|codec)\b/);
    const s = run(e.code).UserProfileSchema;
    expect(s.fields.map((f: any) => [f.name, f.type])).toEqual([
      ["name", "string"],
      ["email", "string"],
      ["preferences", "object"],
      ["legacyField", "string"],
      ["joined", "date"],
    ]);
    const c = runtime.createJsonCodec<any>(s);
    const out = c.decodeAny('{"__v":1,"name":"n","legacyField":"x"}');
    expect(out).toMatchObject({ name: "n", email: "", preferences: {} });
    expect(out.joined).toBeInstanceOf(Date);
    expect("legacyField" in out).toBe(false);
  });
});

describe("#23 non-literal @defaultValue is not silently dropped", () => {
  it("emits the default expression itself", () => {
    const e = expand(`
const DEFAULT_TAGS = ["a"];
@codec(2)
export class Post {
  title: string = "";
  @since(2) @defaultValue(DEFAULT_TAGS.length) count: number = 0;
}
export { PostSchema };
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    const f = m.PostSchema.fields.find((x: any) => x.name === "count");
    expect(f.defaultValue).toBe(1);
  });
});

describe("#29 @codec({ version: N }) and optional props", () => {
  it("object-form version is honoured", () => {
    const e = expand(`
@codec({ version: 4 })
export class A { x: number = 0; y?: string; }
export { ASchema };
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(m.ASchema.version).toBe(4);
    expect(m.ASchema.fields.find((f: any) => f.name === "y").optional).toBe(true);
    expect(m.ASchema.fields.find((f: any) => f.name === "x").optional).toBeUndefined();
  });
  it("an unrecognised version argument is an error", () => {
    const e = expand(`
@codec("three")
export class B { x: number = 0; }
`);
    expect(e.errors.length).toBeGreaterThan(0);
  });
});
