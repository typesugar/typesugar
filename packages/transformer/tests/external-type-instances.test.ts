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

/**
 * implicit() auto-specialization inlines an instance whose methods are an
 * object literal into a `__typesugar___dup_Feature_0__ = a => ...` copy of
 * the function, and that parameter has no type annotation, so the expanded
 * TypeScript fails noImplicitAny (a separate, pre-existing gap: reported, not
 * fixed here). Tests that hit it say so.
 */
const SPECIALIZED_ANY = "use.ts: Parameter 'a' implicitly has an 'any' type.";

function check(files: Files, entry = "use.ts", expectedTypeErrors: string[] = []) {
  const t = transformAll(files);
  expect(transformErrors(t)).toEqual({});
  expect(typecheck(t.code)).toEqual(expectedTypeErrors);
  return { t, m: run(t.code, entry) };
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
    const { t, m } = check(
      {
        "instances.ts": HAND_WRITTEN,
        "use.ts": use(`import { cloneFeature } from "./instances";`),
      },
      "use.ts",
      [SPECIALIZED_ANY]
    );
    const out = t.code["use.ts"];
    expect(out).not.toContain("summon<");
    expect(out).toContain("export const viaSummon = cloneFeature.clone(sample)");
    expect(out).toContain("export const viaMethod = cloneFeature.clone(sample)");
    for (const k of ["viaSummon", "viaImplicit", "viaMethod"]) expect(m[k].label).toBe("hand");
  });

  it("imported for its side effects only: the instance is still found, and imported", () => {
    const { t, m } = check(
      {
        "instances.ts": HAND_WRITTEN,
        "use.ts": use(`import "./instances";`),
      },
      "use.ts",
      [SPECIALIZED_ANY]
    );
    expect(t.code["use.ts"]).toContain(`import { cloneFeature } from "./instances";`);
    for (const k of ["viaSummon", "viaImplicit", "viaMethod"]) expect(m[k].label).toBe("hand");
  });
});

describe("a derived instance for Feature, exported from instances.ts", () => {
  const derived = (decl: string) => `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon } from "typesugar";
${decl}
`;

  for (const [name, decl] of [
    [
      "@impl Clone<Feature> = summon<Clone<Feature>>()",
      `/** @impl Clone<Feature> */\nexport const cloneFeature = summon<Clone<Feature>>();`,
    ],
    [
      ": Clone<Feature> = summon<Clone<Feature>>()",
      `export const cloneFeature: Clone<Feature> = summon<Clone<Feature>>();`,
    ],
  ] as const) {
    it(`${name}: derived once, structurally, and used everywhere`, () => {
      const { t, m } = check({
        "instances.ts": derived(decl),
        "use.ts": use(`import { cloneFeature } from "./instances";`),
      });
      // Derived in place of the summon, not resolved to itself.
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
  it("summon derives in place at each call site", () => {
    const { t, m } = check({
      "use.ts": `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon } from "typesugar";
${SAMPLE}
export const a = summon<Clone<Feature>>();
export const b = summon<Clone<Feature>>();
export const copy = a.clone(sample);
`,
    });
    // Each summon gets its own copy of the derived instance.
    expect(t.code["use.ts"].match(/const cloneGeometry = /g)).toHaveLength(2);
    expectIndependent(m.copy.geometry, m.sample.geometry);
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
    const { t, m } = check(
      {
        "tree.ts": `import type { Clone } from "@typesugar/std";
import { summon } from "typesugar";
export interface Tree { value: number; children: Tree[] }
/** @impl Clone<Tree> */
export const cloneTree: Clone<Tree> = {
  clone: (t) => ({ ...t, children: t.children.map((c) => summon<Clone<Tree>>().clone(c)) }),
};
`,
      },
      "tree.ts"
    );
    expect(t.code["tree.ts"]).toContain("t.children.map((c) => cloneTree.clone(c))");
    // Called from here, not from the program: a `cloneTree.clone(x)` call in
    // the program is inlined from the instance's SOURCE, which still holds
    // the unexpanded summon (a separate, pre-existing bug: reported).
    const original = { value: 1, children: [{ value: 2, children: [] }] };
    const copy = m.cloneTree.clone(original);
    expect(copy).toEqual(original);
    expect(copy.children[0]).not.toBe(original.children[0]);
  });
});

describe("docs/guides/typeclasses.md: Instances for Types You Don't Own", () => {
  it("the guide's two files: derived Clone, hand-written Eq, a side-effect import", () => {
    const { t, m } = check({
      "geo-instances.ts": `import type { Feature } from "geojson";
import type { Clone, Eq } from "@typesugar/std";
import { summon } from "typesugar";

/** @impl Clone<Feature> */
export const cloneFeature = summon<Clone<Feature>>();

/** @impl Eq<Feature> */
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
