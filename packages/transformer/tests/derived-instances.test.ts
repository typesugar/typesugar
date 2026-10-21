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
