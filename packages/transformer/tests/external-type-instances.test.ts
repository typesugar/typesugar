/**
 * Instances for a type you don't own (Turf case study, Stage 1 follow-up):
 * `Feature` from `@types/geojson`, which can't carry `@derive`. The intended
 * model is "write the instances in your own file, import it, and use them",
 * so each test is a small program of an instances file and a file that uses
 * them, transformed as one program, type-checked, and run.
 *
 * `Feature` is `interface Feature<G = Geometry, P = GeoJsonProperties>`: a
 * generic whose type parameters all have defaults, so the bare name means
 * `Feature<Geometry, GeoJsonProperties>`. Before the fixes these tests came
 * with, an `@impl Clone<Feature>` matched `summon<Clone<Feature>>()` but not
 * a value typed `Feature` (implicit(), `f.clone()` with a bare import), and
 * `@impl ... = summon<Clone<Feature>>()` resolved to itself (`const x = x`).
 *
 * Deriving an instance for such a type is `derived<Clone<Feature>>()`
 * (derived-instances.test.ts). `summon` still derives when nothing is in
 * scope, with a TS9009 warning; the tests that pin that fallback are here.
 */
import { describe, it, expect } from "vitest";
import {
  transformAll,
  transformErrors,
  typecheck,
  run,
  type Files,
} from "./external-types-harness.js";

/** A Feature whose every nested object can be checked for sharing. */
const SAMPLE = `export const sample: Feature = {
  type: "Feature",
  bbox: [0, 0, 1, 1],
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
  properties: { name: "p" },
};`;

const HAND_WRITTEN = `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
/** @impl Clone<Feature> */
export const cloneFeature: Clone<Feature> = {
  clone: (f) => ({ ...f, properties: f.properties && { ...f.properties }, label: "hand" } as Feature),
};
`;

/** use.ts: summon, implicit() and method syntax for a value typed `Feature`. */
const use = (importLine: string) => `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon, implicit } from "typesugar";
import "@typesugar/std/syntax/clone";
${importLine}
${SAMPLE}
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
export const viaSummon = summon<Clone<Feature>>().clone(sample);
export const viaImplicit = dup(sample);
export const viaMethod = sample.clone();
`;

function check(files: Files, entry = "use.ts") {
  const t = transformAll(files);
  expect(transformErrors(t)).toEqual({});
  expect(typecheck(t.code)).toEqual([]);
  return { t, m: run(t.code, entry) };
}

/** The TS9009 warnings ("derived one here") in a file. */
function derivedHere(t: ReturnType<typeof transformAll>, file: string) {
  return t.located[file].filter((d) => d.message.includes("[TS9009]"));
}

/** No object or array is shared between `copy` and `original`. */
function expectIndependent(copy: any, original: any) {
  expect(copy).not.toBe(original);
  for (const k of Object.keys(original)) {
    const v = original[k];
    if (v !== null && typeof v === "object") expectIndependent(copy[k], v);
  }
}

describe("a hand-written @impl Clone<Feature> in instances.ts", () => {
  it("imported by name: summon, implicit() and f.clone() all use it", () => {
    const { t, m } = check({
      "instances.ts": HAND_WRITTEN,
      "use.ts": use(`import { cloneFeature } from "./instances";`),
    });
    const out = t.code["use.ts"];
    expect(out).not.toContain("summon<");
    // implicit() auto-specialization inlines the instance into a copy of
    // `dup`, whose parameter keeps a type (it used to be a bare `a =>`, which
    // failed noImplicitAny in the expanded TypeScript).
    expect(out).toMatch(/__typesugar___dup_\w+ = \/\*#__PURE__\*\/ \(a: Feature\): Feature =>/);
    expect(out).toContain("export const viaSummon = cloneFeature.clone(sample)");
    expect(out).toContain("export const viaMethod = cloneFeature.clone(sample)");
    for (const k of ["viaSummon", "viaImplicit", "viaMethod"]) expect(m[k].label).toBe("hand");
  });

  it("imported for its side effects only: the instance is still found, and imported", () => {
    const { t, m } = check({
      "instances.ts": HAND_WRITTEN,
      "use.ts": use(`import "./instances";`),
    });
    expect(t.code["use.ts"]).toContain(`import { cloneFeature } from "./instances";`);
    for (const k of ["viaSummon", "viaImplicit", "viaMethod"]) expect(m[k].label).toBe("hand");
  });
});

describe("a derived instance for Feature, exported from instances.ts", () => {
  const derived = (decl: string) => `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { derived, summon } from "typesugar";
${decl}
`;

  for (const [name, decl] of [
    ["derived<Clone<Feature>>()", `export const cloneFeature = derived<Clone<Feature>>();`],
    [
      "@impl Clone<Feature> = derived<Clone<Feature>>()",
      `/** @impl Clone<Feature> */\nexport const cloneFeature = derived<Clone<Feature>>();`,
    ],
    [
      ": Clone<Feature> = derived<Clone<Feature>>()",
      `export const cloneFeature: Clone<Feature> = derived<Clone<Feature>>();`,
    ],
  ] as const) {
    it(`${name}: derived once, structurally, and used everywhere`, () => {
      const { t, m } = check({
        "instances.ts": derived(decl),
        "use.ts": use(`import { cloneFeature } from "./instances";`),
      });
      expect(derivedHere(t, "instances.ts")).toEqual([]);
      const inst = t.code["instances.ts"];
      expect(inst).not.toMatch(/cloneFeature\s*(:\s*Clone<Feature>\s*)?=\s*cloneFeature/);
      expect(inst).toContain("coordinates: a.coordinates.map(");
      // The using file references it; nothing is derived again there.
      const out = t.code["use.ts"];
      expect(out).not.toContain("cloneGeometry");
      expect(out).toContain("export const viaSummon = cloneFeature.clone(sample)");
      expect(out).toContain("export const viaImplicit = dup(sample, cloneFeature)");
      expect(out).toContain("export const viaMethod = cloneFeature.clone(sample)");
      const sample = m.sample;
      for (const k of ["viaSummon", "viaImplicit", "viaMethod"]) {
        expect(m[k]).toEqual(sample);
        expectIndependent(m[k].geometry, sample.geometry);
        expect(m[k].bbox).not.toBe(sample.bbox);
      }
    });
  }

  it("@impl Clone<Feature> = summon<Clone<Feature>>() still derives, and warns to use derived", () => {
    const { t, m } = check({
      "instances.ts": derived(
        `/** @impl Clone<Feature> */\nexport const cloneFeature = summon<Clone<Feature>>();`
      ),
      "use.ts": use(`import { cloneFeature } from "./instances";`),
    });
    expect(t.code["instances.ts"]).toContain("coordinates: a.coordinates.map(");
    const [w] = derivedHere(t, "instances.ts");
    expect(w.severity).toBe("warning");
    expect(w.text).toBe("summon<Clone<Feature>>()");
    expect(w.message).toContain("No instance for `Clone<Feature>` in scope; derived one here");
    expect(w.message).toContain("Write `derived<Clone<Feature>>()` here instead of summon");
    expect(m.viaSummon).toEqual(m.sample);
  });
});

describe("@derive(Clone) on a local alias of Feature", () => {
  it("MyFeature.Clone exists and clones a value typed Feature", () => {
    const { t, m } = check({
      "instances.ts": `import type { Feature } from "geojson";
/** @derive(Clone) */
export type MyFeature = Feature;
`,
      "use.ts": `import type { Feature } from "geojson";
import { MyFeature } from "./instances";
${SAMPLE}
export const copy = MyFeature.Clone.clone(sample);
`,
    });
    expect(t.code["instances.ts"]).toContain("export namespace MyFeature");
    expect(m.copy).toEqual(m.sample);
    expectIndependent(m.copy.geometry, m.sample.geometry);
  });
});

describe("no instance anywhere (F10: summon derives from the type's structure)", () => {
  it("summon derives in place at each call site, and warns once per type per file", () => {
    const { t, m } = check({
      "use.ts": `import type { Feature, Point } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon } from "typesugar";
${SAMPLE}
export const copy = summon<Clone<Feature>>().clone(sample);
export const again = summon<Clone<Feature>>().clone(sample);
export const clonePoint = summon<Clone<Point>>();
`,
    });
    // Each summon gets its own copy of the derived instance.
    expect(t.code["use.ts"].match(/const cloneGeometry = /g)).toHaveLength(2);
    expectIndependent(m.copy.geometry, m.sample.geometry);
    // One warning for Clone<Feature> (at the first summon), one for Clone<Point>.
    const ws = derivedHere(t, "use.ts");
    expect(ws.map((w) => [w.severity, w.line, w.text])).toEqual([
      ["warning", 10, "summon<Clone<Feature>>()"],
      ["warning", 12, "summon<Clone<Point>>()"],
    ]);
    expect(ws[0].message).toContain("No instance for `Clone<Feature>` in scope; derived one here");
    expect(ws[0].message).toContain(
      "Declare it once with `export const cloneFeature = derived<Clone<Feature>>();`"
    );
    // A summon that initializes a top-level const declares an instance: write derived there.
    expect(ws[1].message).toContain("Write `derived<Clone<Point>>()` here instead of summon");
  });

  it("implicit() derives the same way, with the same warning", () => {
    const { t, m } = check({
      "use.ts": `import type { Clone } from "@typesugar/std";
import { implicit } from "typesugar";
interface Pt { x: number; ys: number[] }
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
const p: Pt = { x: 1, ys: [2] };
export const copy = dup(p);
export const again = dup(p);
export const shared = copy.ys === p.ys;
`,
    });
    const ws = derivedHere(t, "use.ts");
    expect(ws.map((w) => [w.line, w.text])).toEqual([[8, "dup(p)"]]);
    expect(ws[0].message).toContain("`export const clonePt = derived<Clone<Pt>>();`");
    expect(m.copy).toEqual({ x: 1, ys: [2] });
    expect(m.shared).toBe(false);
  });

  it("TS9001 for a type from a library suggests derived<...>()", () => {
    const t = transformAll({
      "use.ts": `import type { Feature } from "geojson";
import type { Eq } from "@typesugar/std";
import { summon } from "typesugar";
export const e = summon<Eq<Feature>>();
`,
    });
    const [err] = transformErrors(t)["use.ts"];
    expect(err).toMatch(/\[TS9001\] No instance found for `Eq<Feature>`/);
    expect(err).toContain("`Feature` is declared outside this project");
    expect(err).toContain("export const eqFeature = derived<Eq<Feature>>();");
  });
});

describe("what the resolver must not do", () => {
  it("an @impl Clone<Feature> is not used for Feature<Point> (not the default arguments)", () => {
    const t = transformAll({
      "instances.ts": HAND_WRITTEN,
      "use.ts": `import type { Feature, Point } from "geojson";
import type { Clone } from "@typesugar/std";
import { implicit } from "typesugar";
import { cloneFeature } from "./instances";
declare const p: Feature<Point>;
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
export const copy = dup(p);
export const keep = cloneFeature;
`,
    });
    expect(t.code["use.ts"]).not.toContain("dup(p, cloneFeature)");
    expect(transformErrors(t)["use.ts"]?.[0]).toMatch(/No instance found for `Clone<Feature<Point/);
  });

  it("a summon inside a function of its own instance still resolves to that instance", () => {
    const tree = `import type { Clone } from "@typesugar/std";
import { summon, implicit } from "typesugar";
export interface Tree { value: number; children: Tree[] }
/** @impl Clone<Tree> */
export const cloneTree: Clone<Tree> = {
  clone: (t) => ({ ...t, children: t.children.map((c) => summon<Clone<Tree>>().clone(c)) }),
};
export function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
const original: Tree = { value: 1, children: [{ value: 2, children: [] }] };
export const direct = cloneTree.clone(original);
export const viaImplicit = dup(original);
`;
    const { t, m } = check(
      {
        "tree.ts": tree,
        "use.ts": `import { cloneTree, dup, type Tree } from "./tree";
const original: Tree = { value: 1, children: [{ value: 2, children: [] }] };
export const direct = cloneTree.clone(original);
export const viaImplicit = dup(original);
`,
      },
      "tree.ts"
    );
    expect(t.code["tree.ts"]).toContain("t.children.map((c) => cloneTree.clone(c))");
    // A call of the instance is not inlined from its unexpanded SOURCE, which
    // would leave the raw summon in the output ("summon is not a function").
    for (const f of ["tree.ts", "use.ts"]) expect(t.code[f]).not.toContain("summon<");
    const u = run(t.code, "use.ts");
    for (const r of [m, u]) {
      for (const k of ["direct", "viaImplicit"]) {
        expect(r[k]).toEqual({ value: 1, children: [{ value: 2, children: [] }] });
      }
    }
    const original = { value: 1, children: [{ value: 2, children: [] }] };
    const copy = m.cloneTree.clone(original);
    expect(copy).toEqual(original);
    expect(copy.children[0]).not.toBe(original.children[0]);
  });

  it("implicit() specialization keeps a type for every parameter it keeps", () => {
    const { t, m } = check({
      "instances.ts": HAND_WRITTEN,
      "use.ts": `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { implicit } from "typesugar";
import "./instances";
${SAMPLE}
function tag<A, B>(a: A, b: B, C: Clone<A> = implicit()): [A, B] {
  return [C.clone(a), b];
}
export const t1 = tag(sample, 1);
export const t2 = tag(sample, "x");
export const t3 = tag(sample, 2);
`,
    });
    const out = t.code["use.ts"].replace(/\s+/g, " ");
    // One copy per instantiation (tag(sample, 1) and tag(sample, 2) share one).
    expect(out).toContain("= /*#__PURE__*/ (a: Feature, b: number): [ Feature, number ] =>");
    expect(out).toContain("= /*#__PURE__*/ (a: Feature, b: string): [ Feature, string ] =>");
    expect(out.match(/const __typesugar___tag_\w+ = /g)).toHaveLength(2);
    expect([m.t1[1], m.t2[1], m.t3[1]]).toEqual([1, "x", 2]);
    expect(m.t1[0].label).toBe("hand");
  });
});

describe("docs/guides/typeclasses.md: Instances for Types You Don't Own", () => {
  it("the guide's two files: derived Clone, hand-written Eq, a side-effect import", () => {
    const { t, m } = check({
      "geo-instances.ts": `import type { Feature } from "geojson";
import type { Clone, Eq } from "@typesugar/std";
import { derived } from "typesugar";

// Derived from Feature's structure, as @derive(Clone) would derive it:
export const cloneFeature = derived<Clone<Feature>>();

// Or written by hand (a typed const is an instance):
export const eqFeature: Eq<Feature> = {
  equals: (a, b) => a.id === b.id,
  notEquals: (a, b) => a.id !== b.id,
};
`,
      "use.ts": `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon, implicit } from "typesugar";
import "@typesugar/std/syntax/clone";
import "./geo-instances";

${SAMPLE}
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
export const s = summon<Clone<Feature>>();
export const viaImplicit = dup(sample);
export const viaMethod = sample.clone();
`,
    });
    expect(t.diagnostics).toEqual({ "geo-instances.ts": [], "use.ts": [] });
    const out = t.code["use.ts"];
    expect(out).toContain(`import { cloneFeature } from "./geo-instances";`);
    expect(out).toContain("export const s = cloneFeature;");
    expect(out).toContain("export const viaImplicit = dup(sample, cloneFeature);");
    expect(out).toContain("export const viaMethod = cloneFeature.clone(sample);");
    for (const k of ["viaImplicit", "viaMethod"]) {
      expect(m[k]).toEqual(m.sample);
      expectIndependent(m[k].geometry, m.sample.geometry);
    }
  });
});
