/**
 * `derived<TC<T>>()`: derive one instance, once, in your own file, for a type
 * you don't own (Turf case study, F10 "option B"). Each test is a small
 * program — an instances file and the files that use it — transformed as one
 * program, type-checked, and run, as a build does.
 *
 *   // geo-instances.ts
 *   export const cloneFeature = derived<Clone<Feature>>();
 *
 * - The initializer becomes the field-wise derivation, emitted once: the same
 *   code `@derive(Clone)` generates for a type you own. Field instances come
 *   from scope.
 * - The const IS the instance: other files find it by import (summon,
 *   implicit(), method syntax) like a hand-written `@impl` const, with or
 *   without an `@impl` tag.
 * - Its `.d.ts` says `cloneFeature: Clone<Feature>`.
 */
import { describe, it, expect } from "vitest";
import {
  transformAll,
  transformErrors,
  typecheck,
  run,
  emitDeclarations,
  type Files,
} from "./external-types-harness.js";

const SAMPLE = `export const sample: Feature = {
  type: "Feature",
  bbox: [0, 0, 1, 1],
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
  properties: { name: "p", tags: ["a", "b"] },
};`;

/** The instances file: a derived Clone<Feature> and Eq<Point>, and a hand-written field instance. */
const INSTANCES = `import type { Feature, GeoJsonProperties, Point } from "geojson";
import type { Clone, Eq } from "@typesugar/std";
import { derived } from "typesugar";

/** Like Turf's cloneProperties: nested objects and arrays are copied too. */
export const cloneProperties: Clone<GeoJsonProperties> = {
  clone: (p) => (p === null ? null : JSON.parse(JSON.stringify(p))),
};

export const cloneFeature = derived<Clone<Feature>>();
export const eqPoint = derived<Eq<Point>>();
`;

/** The same, with `cloneFeature` typed by its annotation: `: Clone<Feature> = derived()`. */
const ANNOTATED = INSTANCES.replace(
  "export const cloneFeature = derived<Clone<Feature>>();",
  "export const cloneFeature: Clone<Feature> = derived();"
);

const use = (importLine: string) => `import type { Feature, Point } from "geojson";
import type { Clone, Eq } from "@typesugar/std";
import { summon, implicit } from "typesugar";
import "@typesugar/std/syntax/clone";
import "@typesugar/std/syntax/eq";
${importLine}

${SAMPLE}
const p1: Point = { type: "Point", coordinates: [1, 2] };
const p2: Point = { type: "Point", coordinates: [1, 2] };
const p3: Point = { type: "Point", coordinates: [1, 2], bbox: [1, 2, 1, 2] };
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
function same<A>(a: A, b: A, E: Eq<A> = implicit()): boolean {
  return E.equals(a, b);
}
export const viaSummon = summon<Clone<Feature>>().clone(sample);
export const viaImplicit = dup(sample);
export const viaMethod = sample.clone();
export const eqViaSummon = [summon<Eq<Point>>().equals(p1, p2), summon<Eq<Point>>().equals(p1, p3)];
export const eqViaImplicit = [same(p1, p2), same(p1, p3)];
export const eqViaMethod = [p1.equals(p2), p1.equals(p3)];
`;

/** No object or array is shared between `copy` and `original`. */
function expectIndependent(copy: any, original: any) {
  expect(copy).not.toBe(original);
  for (const k of Object.keys(original)) {
    const v = original[k];
    if (v !== null && typeof v === "object") expectIndependent(copy[k], v);
  }
}

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

describe("derived<TC<T>>() in an instances file, used from another file", () => {
  for (const [how, instances, importLine] of [
    ["a side-effect import", INSTANCES, `import "./geo-instances";`],
    ["a named import", INSTANCES, `import { cloneFeature, eqPoint } from "./geo-instances";`],
    ["an annotated const, `: Clone<Feature> = derived()`", ANNOTATED, `import "./geo-instances";`],
  ] as const) {
    it(`${how}: summon, implicit() and method syntax all use the one definition`, () => {
      const files: Files = { "geo-instances.ts": instances, "use.ts": use(importLine) };
      const t = transformAll(files);
      expect(t.diagnostics).toEqual({ "geo-instances.ts": [], "use.ts": [] });
      expect(typecheck(t.code)).toEqual([]);

      // The instances file: each derivation once, in place of the call.
      const inst = t.code["geo-instances.ts"];
      expect(inst).not.toMatch(/\bderived\b/);
      expect(inst).not.toContain(`from "typesugar"`);
      expect(inst).toMatch(
        /export const cloneFeature: Clone<Feature> = \(\(\) => \{ const cloneGeometry = /
      );
      expect(count(inst, /const cloneGeometry = /g)).toBe(1);
      // The supplied Clone<GeoJsonProperties> composes in.
      expect(inst).toContain("properties: cloneProperties.clone(a.properties)");
      // Eq on Point (F12): Position (number[]) and BBox compare element by element.
      // The declaration keeps the instance type (`: Eq<Point>`), as written or
      // from the type argument.
      expect(inst).toContain(
        "export const eqPoint: Eq<Point> = { equals: (a: Point, b: Point): boolean =>"
      );
      expect(inst).toContain(
        "a.coordinates.length === b.coordinates.length && a.coordinates.every("
      );

      // The using file references the instances; nothing is derived there.
      const out = t.code["use.ts"];
      expect(out).not.toContain("cloneGeometry");
      expect(out).not.toContain(".every(");
      expect(out).toMatch(/import \{[^}]*\bcloneFeature\b[^}]*\} from "\.\/geo-instances"/);
      expect(out).toContain("export const viaSummon = cloneFeature.clone(sample);");
      expect(out).toContain("export const viaImplicit = dup(sample, cloneFeature);");
      expect(out).toContain("export const viaMethod = cloneFeature.clone(sample);");
      expect(out).toContain("eqPoint.equals(p1, p2)");
      expect(out).toContain("same(p1, p2, eqPoint)");

      const m = run(t.code, "use.ts");
      for (const k of ["viaSummon", "viaImplicit", "viaMethod"]) {
        expect(m[k]).toEqual(m.sample);
        expectIndependent(m[k].geometry, m.sample.geometry);
        expect(m[k].bbox).not.toBe(m.sample.bbox);
        // Through cloneProperties: the nested array is a copy, not shared.
        expect(m[k].properties.tags).toEqual(["a", "b"]);
        expect(m[k].properties.tags).not.toBe(m.sample.properties.tags);
      }
      for (const k of ["eqViaSummon", "eqViaImplicit", "eqViaMethod"]) {
        expect(m[k]).toEqual([true, false]);
      }
    });
  }

  it("an @impl tag is optional, and when present it must agree", () => {
    const tagged = INSTANCES.replace(
      "export const cloneFeature = derived",
      "/** @impl Clone<Feature> */\nexport const cloneFeature = derived"
    );
    const t = transformAll({
      "geo-instances.ts": tagged,
      "use.ts": use(`import "./geo-instances";`),
    });
    expect(transformErrors(t)).toEqual({});
    expect(typecheck(t.code)).toEqual([]);
    expect(t.code["use.ts"]).toContain("export const viaSummon = cloneFeature.clone(sample);");

    const wrong = transformAll({
      "geo-instances.ts": INSTANCES.replace(
        "export const cloneFeature = derived",
        "/** @impl Clone<Point> */\nexport const cloneFeature = derived"
      ),
    });
    expect(transformErrors(wrong)["geo-instances.ts"]?.[0]).toMatch(
      /@impl Clone<Point>.*derived<Clone<Feature>>\(\)/
    );
  });

  it("the .d.ts types each const as its instance type, with no typesugar import", () => {
    for (const src of [INSTANCES, ANNOTATED]) {
      const d = emitDeclarations({ "geo-instances.ts": src })["geo-instances.d.ts"];
      expect(d).toContain("export declare const eqPoint: Eq<Point>;");
      expect(d).not.toContain("derived");
      expect(d).not.toMatch(/from "typesugar"/);
    }
    // Annotated, the declaration is the annotation as written.
    expect(emitDeclarations({ "geo-instances.ts": ANNOTATED })["geo-instances.d.ts"]).toContain(
      "export declare const cloneFeature: Clone<Feature>;"
    );
    // Inferred from the type argument, TypeScript writes the type out in full:
    // the bare name of a generic with defaults (Feature) is its defaults.
    expect(emitDeclarations({ "geo-instances.ts": INSTANCES })["geo-instances.d.ts"]).toContain(
      `export declare const cloneFeature: Clone<Feature<import("geojson").Geometry, GeoJsonProperties>>;`
    );
    // Emitted from the EXPANDED program (PEP-060 item 3), it is the type argument as written:
    // the expansion annotates the declaration with it.
    const t = transformAll({ "geo-instances.ts": INSTANCES });
    const expanded = emitDeclarations(t.code)["geo-instances.d.ts"];
    expect(expanded).toContain("export declare const cloneFeature: Clone<Feature>;");
    expect(expanded).toContain("export declare const eqPoint: Eq<Point>;");
    expect(expanded).not.toMatch(/from "typesugar"/);
  });

  it("a consumer of the published .d.ts finds the instance by its declared type", () => {
    const d = emitDeclarations({ "geo-instances.ts": INSTANCES })["geo-instances.d.ts"];
    const files: Files = { "geo-instances.d.ts": d, "use.ts": use(`import "./geo-instances";`) };
    const t = transformAll(files, ["use.ts"]);
    expect(transformErrors(t)).toEqual({});
    expect(typecheck({ ...files, ...t.code })).toEqual([]);
    const out = t.code["use.ts"];
    expect(out).toContain("export const viaSummon = cloneFeature.clone(sample);");
    expect(out).toContain("export const viaImplicit = dup(sample, cloneFeature);");
    expect(out).toContain("eqPoint.equals(p1, p2)");
  });

  it("two derived<Clone<Feature>>() in scope: the existing ambiguity error at the use site", () => {
    const one = (name: string) => `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";
export const ${name} = derived<Clone<Feature>>();
`;
    const t = transformAll({
      "a.ts": one("cloneFeatureA"),
      "b.ts": one("cloneFeatureB"),
      "use.ts": `import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon, implicit } from "typesugar";
import "./a";
import "./b";
${SAMPLE}
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
export const s = summon<Clone<Feature>>();
export const d = dup(sample);
`,
    });
    expect(transformErrors(t)).toEqual({
      "use.ts": [
        expect.stringMatching(
          /Ambiguous Clone instance for 'Feature': cloneFeatureA, cloneFeatureB are all in scope/
        ),
        expect.stringMatching(
          /Ambiguous Clone instance for 'Feature.*' \(implicit parameter C\): cloneFeatureA, cloneFeatureB/
        ),
      ],
    });
  });
});

describe("derived<TC<T>>() for one instantiation of a generic", () => {
  it("derived<Clone<Feature<Point>>>() is the instance for Feature<Point>, and only for it", () => {
    const t = transformAll({
      "instances.ts": `import type { Feature, Point } from "geojson";
import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";
export const clonePointFeature = derived<Clone<Feature<Point>>>();
`,
      "use.ts": `import type { Feature, Point } from "geojson";
import type { Clone } from "@typesugar/std";
import { summon, implicit } from "typesugar";
import "./instances";
export const pf: Feature<Point> = { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: null };
function dup<A>(a: A, C: Clone<A> = implicit()): A {
  return C.clone(a);
}
export const viaSummon = summon<Clone<Feature<Point>>>().clone(pf);
export const viaImplicit = dup(pf);
`,
    });
    expect(t.diagnostics).toEqual({ "instances.ts": [], "use.ts": [] });
    expect(typecheck(t.code)).toEqual([]);
    const inst = t.code["instances.ts"];
    // The Point geometry is cloned as a Point: no switch over every geometry.
    expect(inst).toContain(
      "geometry: { ...a.geometry, coordinates: a.geometry.coordinates.slice()"
    );
    expect(inst).not.toContain("switch");
    const out = t.code["use.ts"];
    expect(out).toContain("export const viaSummon = clonePointFeature.clone(pf);");
    expect(out).toContain("export const viaImplicit = dup(pf, clonePointFeature);");
    const m = run(t.code, "use.ts");
    expect(m.viaSummon).toEqual(m.pf);
    expect(m.viaSummon.geometry.coordinates).not.toBe(m.pf.geometry.coordinates);
  });
});

describe("derived<TC<T>>() for one instantiation of a generic class", () => {
  it("derived<Eq<Box<number>>>() (docs/guides/derive.md, Generic Types)", () => {
    const t = transformAll({
      "box.ts": `import type { Eq } from "@typesugar/std";
import { derived, summon } from "typesugar";
export class Box<T> {
  constructor(public value: T) {}
}
export const eqBoxNumber = derived<Eq<Box<number>>>();
export const results = [
  summon<Eq<Box<number>>>().equals(new Box(1), new Box(1)),
  summon<Eq<Box<number>>>().equals(new Box(1), new Box(2)),
];
`,
    });
    expect(t.diagnostics["box.ts"]).toEqual([]);
    expect(typecheck(t.code)).toEqual([]);
    expect(t.code["box.ts"]).toContain("eqBoxNumber.equals(new Box(1), new Box(1))");
    expect(run(t.code, "box.ts").results).toEqual([true, false]);
  });
});

describe("derived<TC<T>>() for a type that contains itself", () => {
  it("recurses through the instance being declared", () => {
    const t = transformAll({
      "tree.ts": `import type { Clone, Eq } from "@typesugar/std";
import { derived } from "typesugar";
export interface Tree { value: number; children: Tree[] }
export const cloneTree = derived<Clone<Tree>>();
export const eqTree = derived<Eq<Tree>>();
const t: Tree = { value: 1, children: [{ value: 2, children: [] }] };
export const copy = cloneTree.clone(t);
export const shared = Object.is(copy.children[0], t.children[0]);
export const same = eqTree.equals(copy, t);
export const differs = eqTree.equals(t, { value: 1, children: [{ value: 3, children: [] }] });
`,
    });
    expect(t.diagnostics["tree.ts"]).toEqual([]);
    expect(typecheck(t.code)).toEqual([]);
    expect(t.code["tree.ts"]).toContain("eqTree.equals(");
    const m = run(t.code, "tree.ts");
    expect([m.shared, m.same, m.differs]).toEqual([false, true, false]);
  });
});

describe("F12: Eq compares array- and tuple-typed fields element by element", () => {
  it("@derive(Eq) on a type of your own with Position and BBox fields", () => {
    const t = transformAll({
      "pin.ts": `import type { BBox, Position } from "geojson";
import { summon } from "typesugar";
import type { Eq } from "@typesugar/std";
/** @derive(Eq) */
export interface Pin { at: Position; bbox?: BBox; path: Position[] }
const pin = (x: number, bbox?: BBox): Pin => ({ at: [x, 0], path: [[x, 1]], ...(bbox && { bbox }) });
const eq = summon<Eq<Pin>>();
export const results = [
  eq.equals(pin(1), pin(1)),
  eq.equals(pin(1), pin(2)),
  eq.equals(pin(1, [0, 0, 1, 1]), pin(1, [0, 0, 1, 1])),
  eq.equals(pin(1, [0, 0, 1, 1]), pin(1)),
  eq.equals(pin(1, [0, 0, 1, 1]), pin(1, [0, 0, 1, 2])),
];
`,
    });
    expect(t.diagnostics["pin.ts"]).toEqual([]);
    expect(typecheck(t.code)).toEqual([]);
    expect(run(t.code, "pin.ts").results).toEqual([true, false, true, false, false]);
  });
});

describe("derived<TC<T>>(): what it rejects", () => {
  const header = `import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import type { Clone, Eq } from "@typesugar/std";
import { derived } from "typesugar";
`;

  it("a field with no instance that can't be derived: an error at the derived line, naming the field and its type", () => {
    const src = `${header}
export const eqGeometry = derived<Eq<Geometry>>();
export const eqFeature = derived<Eq<Feature>>();
`;
    const t = transformAll({ "geo.ts": src });
    const errors = t.located["geo.ts"].filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(6);
    expect(errors[0].text).toBe("derived<Eq<Feature>>()");
    expect(errors[0].message).toMatch(/\[TS9107\]/);
    expect(errors[0].message).toMatch(/field `properties`/);
    expect(errors[0].message).toMatch(/GeoJsonProperties/);
  });

  it("the same Eq<Feature> derives once the field's instance is supplied, and compares field by field", () => {
    const src = `${header}
export const eqProperties: Eq<GeoJsonProperties> = {
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  notEquals: (a, b) => JSON.stringify(a) !== JSON.stringify(b),
};
export const eqGeometry = derived<Eq<Geometry>>();
export const eqFeature = derived<Eq<Feature>>();
const f = (n: number): Feature => ({
  type: "Feature",
  geometry: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [n, 0] }] },
  properties: { n },
});
export const same = eqFeature.equals(f(1), f(1));
export const differentGeometry = eqFeature.equals(f(1), { ...f(1), geometry: f(2).geometry });
export const differentProperties = eqFeature.equals(f(1), { ...f(1), properties: { n: 2 } });
`;
    const t = transformAll({ "geo.ts": src });
    expect(t.diagnostics["geo.ts"]).toEqual([]);
    expect(typecheck(t.code)).toEqual([]);
    const out = t.code["geo.ts"];
    expect(out).toContain("eqProperties.equals(a.properties, b.properties)");
    expect(out).toContain("eqGeometry.equals(a.geometry, b.geometry)");
    const m = run(t.code, "geo.ts");
    expect([m.same, m.differentGeometry, m.differentProperties]).toEqual([true, false, false]);
  });

  it("a generic type with free type parameters: not supported yet", () => {
    const t = transformAll({
      "geo.ts": `${header}
export function cloneOf<G extends Geometry>() {
  return derived<Clone<Feature<G>>>();
}
`,
    });
    const [err] = transformErrors(t)["geo.ts"];
    expect(err).toMatch(/\[TS9011\]/);
    expect(err).toContain("`G` is a type parameter");
    expect(err).toMatch(/not supported yet/);
  });

  it("anything but the initializer of a top-level const", () => {
    const t = transformAll({
      "geo.ts": `${header}
export const pair = [derived<Clone<Feature>>()];
export let cloneFeature = derived<Clone<Feature>>();
`,
    });
    const errs = transformErrors(t)["geo.ts"];
    expect(errs).toHaveLength(2);
    for (const e of errs) expect(e).toMatch(/\[TS9010\]/);
  });

  it("a typeclass with no derivation strategy", () => {
    const t = transformAll({
      "geo.ts": `import type { Feature } from "geojson";
import { derived } from "typesugar";
interface Frob<A> { frob(a: A): A }
export const frobFeature = derived<Frob<Feature>>();
`,
    });
    expect(transformErrors(t)["geo.ts"]?.[0]).toMatch(/Cannot derive Frob for 'Feature'/);
  });

  it("Destructure: its derive needs the type's declaration (and makes a value per extractor)", () => {
    // derived<...>() makes ONE value from a type's structure; @derive(Destructure)
    // makes a constructor function per extractor plus an instance whose
    // @destructure descriptor sits on its declaration, which an expression macro
    // can't write. For a type you don't own, write the instance by hand
    // (docs/guides/pattern-matching.md, Custom Extractors).
    const t = transformAll({
      "geo.ts": `import type { Point } from "geojson";
import type { Destructure } from "@typesugar/std";
import { derived } from "typesugar";
export const destructurePoint = derived<Destructure<Point>>();
`,
    });
    expect(transformErrors(t)["geo.ts"]?.[0]).toMatch(/Cannot derive Destructure for 'Point'/);
  });
});

describe("every typeclass @derive supports, through the same derivation", () => {
  const TCS = [
    "Eq",
    "Ord",
    "Clone",
    "Debug",
    "Hash",
    "Default",
    "Json",
    "TypeGuard",
    "Show",
    "Semigroup",
    "Monoid",
  ];
  const TC_FILE = `export interface Eq<A> { equals(a: A, b: A): boolean; notEquals(a: A, b: A): boolean }
export interface Ord<A> extends Eq<A> { compare(a: A, b: A): number }
export interface Clone<A> { clone(a: A): A }
export interface Debug<A> { debug(a: A): string }
export interface Hash<A> { hash(a: A): number }
export interface Default<A> { default(): A }
export interface Json<A> { toJson(a: A): unknown; fromJson(json: unknown): A }
export interface TypeGuard<A> { is(value: unknown): boolean }
export interface Show<A> { show(a: A): string }
export interface Semigroup<A> { combine(a: A, b: A): A }
export interface Monoid<A> extends Semigroup<A> { empty(): A }
`;
  const MONEY = `{ amount: number; currency: string }`;
  const uncap = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

  it("derived<TC<Money>>() emits exactly what @derive(TC) emits, and summon finds it", () => {
    const files: Files = {
      "tc.ts": TC_FILE,
      "money.ts": `export interface Money ${MONEY}\n`,
      "owned.ts": `/** @derive(${TCS.join(", ")}) */\nexport interface Money ${MONEY}\n`,
      "instances.ts": `import type { ${TCS.join(", ")} } from "./tc";
import type { Money } from "./money";
import { derived } from "typesugar";
${TCS.map((tc) => `export const ${uncap(tc)}Money = derived<${tc}<Money>>();`).join("\n")}
`,
      "use.ts": `import type { ${TCS.join(", ")} } from "./tc";
import type { Money } from "./money";
import { summon } from "typesugar";
import "./instances";
${TCS.map((tc) => `export const s${tc} = summon<${tc}<Money>>();`).join("\n")}
`,
    };
    const t = transformAll(files);
    expect(t.diagnostics["instances.ts"]).toEqual([]);
    expect(t.diagnostics["use.ts"]).toEqual([]);
    expect(transformErrors(t)).toEqual({});
    expect(typecheck(t.code)).toEqual([]);
    const flat = (s: string) => s.replace(/\s+/g, " ");
    const owned = flat(t.code["owned.ts"]);
    const inst = flat(t.code["instances.ts"]);
    for (const tc of TCS) {
      const viaDerive = new RegExp(
        `export const ${tc} = (.*?); (?:\\} )?(?:export namespace|$)`
      ).exec(owned.slice(owned.indexOf(`export const ${tc} = `)));
      expect(viaDerive, tc).not.toBeNull();
      expect(inst, tc).toContain(
        `export const ${uncap(tc)}Money: ${tc}<Money> = ${viaDerive![1]};`
      );
      expect(t.code["use.ts"]).toContain(`export const s${tc} = ${uncap(tc)}Money;`);
    }
    const m = run(t.code, "instances.ts");
    const a = { amount: 1, currency: "EUR" };
    expect(m.eqMoney.equals(a, { ...a })).toBe(true);
    expect(m.ordMoney.compare(a, { amount: 2, currency: "EUR" })).toBe(-1);
    expect(m.cloneMoney.clone(a)).not.toBe(a);
    expect(m.monoidMoney.combine(a, a)).toEqual({ amount: 2, currency: "EUREUR" });
  });

  it("the expansion type-checks against @typesugar/std's own typeclass types", () => {
    const std = ["Eq", "Ord", "Clone", "Debug", "Hash", "Json", "Semigroup", "Monoid"];
    const t = transformAll({
      "money.ts": `export interface Money ${MONEY}\n`,
      "instances.ts": `import type { ${std.join(", ")} } from "@typesugar/std";
import type { Money } from "./money";
import { derived } from "typesugar";
${std.map((tc) => `export const ${uncap(tc)}Money = derived<${tc}<Money>>();`).join("\n")}
`,
    });
    expect(t.diagnostics["instances.ts"]).toEqual([]);
    expect(typecheck(t.code)).toEqual([]);
  });
});

describe("derived<TC<T>>() for a built-in type (review round 2)", () => {
  it("Array, Map, Date: a clear TS9106, not a derivation from lib internals", () => {
    const t = transformAll({
      "builtins.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
export const a = derived<Eq<Array<number>>>();
export const m = derived<Eq<Map<string, number>>>();
export const d = derived<Eq<Date>>();
`,
    });
    const errs = transformErrors(t)["builtins.ts"] ?? [];
    expect(errs).toHaveLength(3);
    for (const e of errs) {
      expect(e).toContain("TS9106");
      expect(e).toMatch(/built-in/);
      expect(e).not.toMatch(/__@/);
    }
    // Nothing was generated from Map's lib members.
    expect(t.code["builtins.ts"]).not.toContain("__@");
  });

  it("summon doesn't resolve to a derived const whose derivation failed", () => {
    // Before: `s` resolved to `m` (the scanner registers `derived<...>()`
    // consts by their call), so the output was `const s = m` with `m` the
    // un-expanded stub, and the only error was at `m`'s line.
    for (const order of ["derived first", "summon first"]) {
      const lines = [
        "export const m = derived<Eq<Map<string, number>>>();",
        "export const s = summon<Eq<Map<string, number>>>();",
      ];
      if (order === "summon first") lines.reverse();
      const t = transformAll({
        "builtins.ts": `import type { Eq } from "@typesugar/std";
import { derived, summon } from "typesugar";
${lines.join("\n")}
`,
      });
      const errs = transformErrors(t)["builtins.ts"] ?? [];
      expect(errs, order).toHaveLength(2);
      expect(
        errs.some((e) => e.includes("TS9106")),
        order
      ).toBe(true);
      expect(t.code["builtins.ts"], order).not.toMatch(/const s = m\b/);
    }
  });

  it("implicit()'s by-name fallback doesn't resolve to a derived const whose derivation failed", () => {
    // Before: resolveInstance dropped the failed `eqInner`, but implicit()'s
    // name-based fallback (findScannedInScope) did not, so the call became
    // `same(x, x, eqInner)` with `eqInner` the un-expanded stub, and the only
    // error was at `eqInner`'s line.
    for (const order of ["derived first", "use first"]) {
      const lines = [
        "export const eqInner = derived<Eq<Inner>>();",
        "export const r = same(x, x);",
      ];
      if (order === "use first") lines.reverse();
      const t = transformAll({
        "inner.ts": `import type { Eq } from "@typesugar/std";
import { derived, implicit } from "typesugar";
export interface Inner { m: Map<string, number> }
function same<A>(a: A, b: A, E: Eq<A> = implicit()): boolean {
  return E.equals(a, b);
}
const x: Inner = { m: new Map() };
${lines.join("\n")}
`,
      });
      const errs = transformErrors(t)["inner.ts"] ?? [];
      expect(t.code["inner.ts"], order).not.toMatch(/same\(x, x, eqInner\)/);
      // The derived const's own failure, and the call's missing instance.
      expect(errs, order).toHaveLength(2);
      expect(
        errs.some((e) => e.includes("TS9001")),
        order
      ).toBe(true);
    }
  });

  it("lib utility types (Readonly, Partial, Record, Pick) are derived from their fields", () => {
    // They're type aliases declared in TypeScript's lib, but what they
    // resolve to is an ordinary object type: the built-in check reads the
    // resolved type's own symbol, not the alias.
    const t = transformAll({
      "util.ts": `import type { Eq, Clone } from "@typesugar/std";
import { derived } from "typesugar";
interface Point { x: number; y: number }
export const eqRP = derived<Eq<Readonly<Point>>>();
export const eqPart = derived<Eq<Partial<Point>>>();
export const eqRec = derived<Eq<Record<"a" | "b", number>>>();
export const clPick = derived<Clone<Pick<Point, "x">>>();
`,
    });
    expect(transformErrors(t)).toEqual({});
    expect(typecheck(t.code)).toEqual([]);
    const m = run(t.code, "util.ts");
    expect(m.eqRP.equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(m.eqRP.equals({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(m.eqPart.equals({ x: 1 }, { x: 2 })).toBe(false);
    expect(m.eqPart.equals({ x: 1 }, { x: 1 })).toBe(true);
    expect(m.eqRec.equals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    const src = { x: 1 };
    const c = m.clPick.clone(src);
    expect(c).toEqual(src);
    expect(c).not.toBe(src);
  });

  it("an alias of a built-in, or a lib utility over one, is still a built-in", () => {
    const t = transformAll({
      "alias.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
type Nums = number[];
export const a = derived<Eq<Nums>>();
export const r = derived<Eq<Readonly<number[]>>>();
`,
    });
    const errs = transformErrors(t)["alias.ts"] ?? [];
    expect(errs).toHaveLength(2);
    for (const e of errs) expect(e).toMatch(/TS9106[\s\S]*built-in/);
  });

  it("a lib utility over a built-in object type (Readonly<Map>, Partial<Date>) is a built-in", () => {
    // review 5, item 3: the mapped type's own symbol is a type literal, so
    // Readonly<Map<string, number>> was derived from Map's internals
    // (`a.size === b.size && a["__@toStringTag@24"] ...`).
    const t = transformAll({
      "mapped.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
type RM = Readonly<Map<string, number>>;
export const a = derived<Eq<Readonly<Map<string, number>>>>();
export const b = derived<Eq<Readonly<Set<string>>>>();
export const c = derived<Eq<RM>>();
export const d = derived<Eq<Partial<Date>>>();
export const e = derived<Eq<Readonly<Date>>>();
`,
    });
    const errs = transformErrors(t)["mapped.ts"] ?? [];
    expect(errs).toHaveLength(5);
    for (const e of errs) expect(e).toMatch(/TS9106[\s\S]*built-in/);
    expect(JSON.stringify(t.code)).not.toMatch(/__@/);
  });

  it("a lib utility over a user type that extends a lib type derives, like the type itself", () => {
    // review 6, item 6: Readonly<AppError> has properties declared in lib's
    // Error interface (name, message, stack), so it was a built-in (TS9106)
    // while derived<Eq<AppError>>() derived. A mapped type is a built-in only
    // when the type it maps is one, by symbol.
    const t = transformAll({
      "mapped-user.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
interface AppError extends Error { code: number }
interface Bare extends Error {}
type RA = Readonly<AppError>;
export const plain = derived<Eq<AppError>>();
export const ro = derived<Eq<Readonly<AppError>>>();
export const viaAlias = derived<Eq<RA>>();
export const partial = derived<Eq<Partial<Bare>>>();
export const picked = derived<Eq<Pick<AppError, "message" | "code">>>();
`,
    });
    // Each is derived from its fields: lib's Error has `cause: unknown` (no
    // Eq instance), reported the same way for the type and for each utility
    // over it; `Pick` without `cause` derives cleanly.
    const errs = transformErrors(t)["mapped-user.ts"] ?? [];
    expect(errs.filter((e) => /TS9106/.test(e))).toEqual([]);
    for (const e of errs) expect(e).toMatch(/TS9107[\s\S]*`cause`/);
    expect(errs.some((e) => /Pick/.test(e))).toBe(false);
  });

  it("summon's help for a built-in type doesn't point at derived<...>()", () => {
    const t = transformAll({
      "use.ts": `import type { Eq } from "@typesugar/std";
import { summon } from "typesugar";
export const a = summon<Eq<Map<string, number>>>();
`,
    });
    const errs = transformErrors(t)["use.ts"] ?? [];
    expect(errs).toHaveLength(1);
    expect(errs[0]).not.toContain("derived<Eq<Map");
    expect(errs[0]).toMatch(/built-in/);
  });
});

describe("derived<TC<T>>() with an @impl tag: the tag and the call compared as types", () => {
  it("an alias of the type is the same type; another type is an error", () => {
    const t = transformAll({
      "ok.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
/** @derive(Eq) */
export interface Pt { x: number }
type P2 = Pt;
/** @impl Eq<P2> */
export const eqPt = derived<Eq<Pt>>();
`,
    });
    expect(transformErrors(t)).toEqual({});
    const differ = transformAll({
      "bad.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
export interface Pt { x: number }
export interface Qt { y: number }
/** @impl Eq<Qt> */
export const eqPt = derived<Eq<Pt>>();
`,
    });
    expect(transformErrors(differ)["bad.ts"]?.[0]).toMatch(/@impl Eq<Qt>.*derived<Eq<Pt>>\(\)/s);
  });

  it("a qualified name in the tag (a namespace import's member) is resolved through the checker", () => {
    // `/** @impl Eq<geo.Point> */` on `derived<Eq<geo.Point>>()` was "the tag
    // names a different type": the tag's name was looked up whole in scope.
    const t = transformAll({
      "geo.ts": `export interface Point { x: number; y: number }\nexport interface Other { z: number }\n`,
      "ok.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
import * as geo from "./geo";
import type { Point as P2 } from "./geo";
/** @impl Eq<geo.Point> */
export const eqGeo = derived<Eq<geo.Point>>();
/** @impl Eq<P2> */
export const eqGeo2 = derived<Eq<geo.Point>>();
`,
      "hand.ts": `import type { Eq } from "@typesugar/std";
import * as geo from "./geo";
/** @impl Eq<geo.Other> */
export const eqOther: Eq<geo.Other> = {
  equals: (a, b) => a.z === b.z,
  notEquals: (a, b) => a.z !== b.z,
};
`,
      "use.ts": `import type { Eq } from "@typesugar/std";
import { summon } from "typesugar";
import type { Other } from "./geo";
import { eqOther } from "./hand";
export const e = summon<Eq<Other>>();
`,
    });
    expect(transformErrors(t)).toEqual({});
    expect(t.code["use.ts"]).toContain("e = eqOther");
    const differ = transformAll({
      "geo.ts": `export interface Point { x: number; y: number }\nexport interface Other { z: number }\n`,
      "bad.ts": `import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
import * as geo from "./geo";
/** @impl Eq<geo.Other> */
export const eqGeo = derived<Eq<geo.Point>>();
`,
    });
    expect(transformErrors(differ)["bad.ts"]?.[0]).toMatch(/@impl Eq<geo\.Other>/);
  });
});

describe("derivation finds the type by identity, not by name", () => {
  // tryDeriveViaGeneric looked the type up by its NAME among the names in
  // scope at the top of the file, so a type declared in a function derived
  // the outer (or global) type of the same name, and `ns.T` wasn't found.
  it("summon in a function: a local type shadowing a top-level one and a DOM global", () => {
    const t = transformAll({
      "local.ts": `import type { Eq } from "@typesugar/std";
import { summon } from "typesugar";
export interface Point { x: number }
export function points(): boolean[] {
  interface Point { a: string; b: string }
  const E = summon<Eq<Point>>();
  return [E.equals({ a: "1", b: "2" }, { a: "1", b: "3" }), E.equals({ a: "1", b: "2" }, { a: "1", b: "2" })];
}
export function ranges(): boolean[] {
  interface Range { lo: number; hi: number }
  const E = summon<Eq<Range>>();
  return [E.equals({ lo: 1, hi: 2 }, { lo: 1, hi: 3 }), E.equals({ lo: 1, hi: 2 }, { lo: 1, hi: 2 })];
}
export const r = [points(), ranges()];
`,
    });
    expect(transformErrors(t)).toEqual({});
    const out = t.code["local.ts"];
    expect(out).toContain("a.a === b.a");
    expect(out).toContain("a.lo === b.lo");
    expect(out).not.toContain("a.x === b.x");
    expect(typecheck(t.code)).toEqual([]);
    expect(run(t.code, "local.ts").r).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it("derived<Eq<geo.Point>>() through a namespace import, beside an unrelated Point", () => {
    const t = transformAll({
      "ns.ts": `import type * as geo from "geojson";
import type { Eq } from "@typesugar/std";
import { derived } from "typesugar";
export interface Point { z: string }
export const eqGeoPoint = derived<Eq<geo.Point>>();
const p = (x: number): geo.Point => ({ type: "Point", coordinates: [x, 0] });
export const r = [eqGeoPoint.equals(p(1), p(1)), eqGeoPoint.equals(p(1), p(2))];
`,
    });
    expect(transformErrors(t)).toEqual({});
    expect(t.code["ns.ts"]).not.toContain("a.z === b.z");
    expect(typecheck(t.code)).toEqual([]);
    expect(run(t.code, "ns.ts").r).toEqual([true, false]);
  });
});
