/**
 * Field-wise derived Clone on `@types/geojson`, the Turf case study's shape
 * (CASE-STUDY.md F8/F9, `case-study/experiments/stage-1-derived-clone.ts`).
 *
 * `clone.ts` is that experiment: `derived<Clone<...>>()` instances for the
 * GeoJSON types, which typesugar derives from their structure, behind Turf's
 * `clone()` dispatcher (the experiment used `summon<Clone<...>>()`, which
 * still derives when no instance is in scope, with a TS9009 warning). Two
 * changes, both about what the TYPES say:
 *
 * - Turf's data has features with `geometry: null`, which `Feature`'s default
 *   type argument (`Geometry`) excludes. A clone that follows the types
 *   would call the geometry clone on `null`, so the features are derived as
 *   `Feature<Geometry | null>`, the type that admits them.
 * - `properties` is `{ [name: string]: any } | null`: its values are `any`,
 *   which name no Clone, so a derived clone copies them by reference. Turf
 *   clones them deeply (its `cloneProperties`), so `clone.ts` supplies that as
 *   the `Clone<GeoJsonProperties>` instance, which the derived Feature clone
 *   then uses for the field. Without it, the two assertions that mutate a
 *   nested property value fail (the last test below pins that).
 *
 * `turf.ts` ports Turf's `turf-clone` test suite (46 assertions, counted) and
 * the `@turf/helpers` constructors it uses.
 */
import { describe, it, expect } from "vitest";
import {
  transformAll,
  transformErrors,
  typecheck,
  run,
  type Files,
} from "./external-types-harness.js";

const CLONE_PROPERTIES = `export function cloneProperties(properties: GeoJsonProperties): { [key: string]: any } {
  const cloned: { [key: string]: any } = {};
  if (!properties) return cloned;
  Object.keys(properties).forEach((key) => {
    const value = properties[key];
    if (typeof value === "object") {
      if (value === null) cloned[key] = null;
      else if (Array.isArray(value)) cloned[key] = value.map((item) => item);
      else cloned[key] = cloneProperties(value);
    } else {
      cloned[key] = value;
    }
  });
  return cloned;
}
`;

const cloneModule = (withPropertiesInstance: boolean) => `import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryCollection,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
  GeoJsonProperties,
} from "geojson";
import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";

${CLONE_PROPERTIES}
${
  withPropertiesInstance
    ? `/** @impl Clone<GeoJsonProperties> */
const clonePropertiesInstance: Clone<GeoJsonProperties> = { clone: cloneProperties };
`
    : ""
}
type NullableFeature = Feature<Geometry | null>;
type NullableFeatureCollection = FeatureCollection<Geometry | null>;

const clonePoint = derived<Clone<Point>>();
const cloneLineString = derived<Clone<LineString>>();
const clonePolygon = derived<Clone<Polygon>>();
const cloneMultiPoint = derived<Clone<MultiPoint>>();
const cloneMultiLineString = derived<Clone<MultiLineString>>();
const cloneMultiPolygon = derived<Clone<MultiPolygon>>();
const cloneGeometryCollection = derived<Clone<GeometryCollection>>();
const cloneFeature = derived<Clone<NullableFeature>>();
const cloneFeatureCollection = derived<Clone<NullableFeatureCollection>>();

export function clone(geojson: any): any {
  if (!geojson) {
    throw new Error("geojson is required");
  }
  switch (geojson.type) {
    case "Feature":
      return cloneFeature.clone(geojson);
    case "FeatureCollection":
      return cloneFeatureCollection.clone(geojson);
    case "Point":
      return clonePoint.clone(geojson);
    case "LineString":
      return cloneLineString.clone(geojson);
    case "Polygon":
      return clonePolygon.clone(geojson);
    case "MultiPoint":
      return cloneMultiPoint.clone(geojson);
    case "MultiLineString":
      return cloneMultiLineString.clone(geojson);
    case "MultiPolygon":
      return cloneMultiPolygon.clone(geojson);
    case "GeometryCollection":
      return cloneGeometryCollection.clone(geojson);
    default:
      throw new Error("unknown GeoJSON type");
  }
}
`;

/** One program: the clone module plus a module that only declares the types. */
function build(withPropertiesInstance = true) {
  const files: Files = { "clone.ts": cloneModule(withPropertiesInstance) };
  const t = transformAll(files);
  return { t, mod: () => run(t.code, "clone.ts") as { clone: (g: any, ...rest: any[]) => any } };
}

// ---------------------------------------------------------------------------
// @turf/helpers (the parts turf-clone's tests use) and @turf/meta's coordEach
// ---------------------------------------------------------------------------

type Opts = { bbox?: number[]; id?: string | number };
function feature(geometry: any, properties: any = {}, options: Opts = {}): any {
  const feat: any = { type: "Feature" };
  if (options.id === 0 || options.id) feat.id = options.id;
  if (options.bbox) feat.bbox = options.bbox;
  feat.properties = properties || {};
  feat.geometry = geometry;
  return feat;
}
const point = (c: number[], p?: any, o?: Opts) => feature({ type: "Point", coordinates: c }, p, o);
const lineString = (c: number[][], p?: any, o?: Opts) =>
  feature({ type: "LineString", coordinates: c }, p, o);
const polygon = (c: number[][][], p?: any, o?: Opts) =>
  feature({ type: "Polygon", coordinates: c }, p, o);
function featureCollection(features: any[], options: Opts = {}): any {
  const fc: any = { type: "FeatureCollection" };
  if (options.id) fc.id = options.id;
  if (options.bbox) fc.bbox = options.bbox;
  fc.features = features;
  return fc;
}
const geometryCollection = (geometries: any[], p?: any, o?: Opts) =>
  feature({ type: "GeometryCollection", geometries }, p, o);

/** Every Position in a Feature/FeatureCollection/Geometry (enough for these tests). */
function coordEach(geojson: any, cb: (coord: number[]) => void): void {
  const geom = (g: any): void => {
    if (!g) return;
    if (g.type === "GeometryCollection") return g.geometries.forEach(geom);
    const walk = (c: any): void => (typeof c[0] === "number" ? cb(c) : c.forEach(walk));
    walk(g.coordinates);
  };
  if (geojson.type === "FeatureCollection") geojson.features.forEach((f: any) => geom(f.geometry));
  else if (geojson.type === "Feature") geom(geojson.geometry);
  else geom(geojson);
}

/** tape-style assertions, counted, recording failures instead of throwing. */
function tape() {
  const failures: string[] = [];
  let count = 0;
  const t = {
    deepEqual(a: unknown, b: unknown, msg = "deepEqual") {
      count++;
      try {
        expect(a).toEqual(b);
      } catch {
        failures.push(msg);
      }
    },
    equal(a: unknown, b: unknown, msg = "equal") {
      count++;
      if (a !== b) failures.push(msg);
    },
    throws(fn: () => unknown, re: RegExp, msg = "throws") {
      count++;
      try {
        fn();
        failures.push(msg);
      } catch (e) {
        if (!re.test(String(e))) failures.push(msg);
      }
    },
  };
  return { t, failures, count: () => count };
}

/** turf-clone's test.ts, assertion for assertion. */
function turfCloneSuite(clone: (g: any, ...rest: any[]) => any) {
  const { t, failures, count } = tape();

  // test("turf-clone")
  {
    const pt = point([0, 20]);
    const line = lineString([
      [10, 40],
      [0, 20],
    ]);
    const poly = polygon([
      [
        [10, 40],
        [0, 20],
        [20, 0],
        [10, 40],
      ],
    ]);
    const fc = featureCollection([
      point([0, 20]),
      lineString([
        [10, 40],
        [0, 20],
      ]),
      polygon([
        [
          [10, 40],
          [0, 20],
          [20, 0],
          [10, 40],
        ],
      ]),
    ]);
    const gc = geometryCollection([
      point([0, 20]).geometry,
      lineString([
        [10, 40],
        [0, 20],
      ]).geometry,
      polygon([
        [
          [10, 40],
          [0, 20],
          [20, 0],
          [10, 40],
        ],
      ]).geometry,
    ]).geometry;

    const ptCloned = clone(pt);
    const lineCloned = clone(line);
    const polyCloned = clone(poly, true);
    const fcCloned = clone(fc);
    const gcCloned = clone(gc);

    ptCloned.geometry.coordinates.reverse();
    lineCloned.geometry.coordinates.reverse();
    polyCloned.geometry.coordinates.reverse();
    coordEach(fcCloned, (coord) => coord.reverse());
    coordEach(gcCloned, (coord) => coord.reverse());

    t.deepEqual(pt.geometry.coordinates, [0, 20], "point");
    t.deepEqual(
      line.geometry.coordinates,
      [
        [10, 40],
        [0, 20],
      ],
      "lineString"
    );
    t.deepEqual(
      poly.geometry.coordinates,
      [
        [
          [10, 40],
          [0, 20],
          [20, 0],
          [10, 40],
        ],
      ],
      "polygon"
    );
    t.deepEqual(fc.features[0].geometry.coordinates, [0, 20], "fc - point");
    t.deepEqual(
      fc.features[1].geometry.coordinates,
      [
        [10, 40],
        [0, 20],
      ],
      "fc - lineString"
    );
    t.deepEqual(
      fc.features[2].geometry.coordinates,
      [
        [
          [10, 40],
          [0, 20],
          [20, 0],
          [10, 40],
        ],
      ],
      "fc - polygon"
    );
    t.deepEqual(gc.geometries[0].coordinates, [0, 20], "gc - point");
    t.deepEqual(
      gc.geometries[1].coordinates,
      [
        [10, 40],
        [0, 20],
      ],
      "gc - lineString"
    );
    t.deepEqual(
      gc.geometries[2].coordinates,
      [
        [
          [10, 40],
          [0, 20],
          [20, 0],
          [10, 40],
        ],
      ],
      "gc - polygon"
    );
  }

  // test("turf-clone -- throws")
  t.throws(() => clone(undefined), /geojson is required/, "throws");

  // test("turf-clone -- optional properties")
  {
    const pt = point([0, 20]);
    pt.properties = undefined;
    pt.id = 300;
    pt.bbox = [0, 20, 0, 20];
    const ptCloned = clone(pt);
    t.deepEqual(ptCloned.bbox, [0, 20, 0, 20], "optional: bbox");
    t.equal(ptCloned.id, 300, "optional: id");
  }

  // test("turf-clone -- Geometry Objects")
  {
    const pt = point([0, 20]).geometry;
    const line = lineString([
      [10, 40],
      [0, 20],
    ]).geometry;
    const poly = polygon([
      [
        [10, 40],
        [0, 20],
        [20, 0],
        [10, 40],
      ],
    ]).geometry;
    const ptCloned = clone(pt);
    const lineCloned = clone(line);
    const polyCloned = clone(poly);
    ptCloned.coordinates.reverse();
    lineCloned.coordinates.reverse();
    polyCloned.coordinates.reverse();
    t.deepEqual(pt.coordinates, [0, 20], "geometry point");
    t.deepEqual(
      line.coordinates,
      [
        [10, 40],
        [0, 20],
      ],
      "geometry line"
    );
    t.deepEqual(
      poly.coordinates,
      [
        [
          [10, 40],
          [0, 20],
          [20, 0],
          [10, 40],
        ],
      ],
      "geometry polygon"
    );
  }

  // test("turf-clone -- Preserve Foreign Members -- Feature")
  {
    const properties = { foo: "bar" };
    const bbox = [0, 20, 0, 20];
    const id = 12345;
    const pt = point([0, 20], properties, { bbox, id });
    pt.custom = "foreign members";
    const cloned = clone(pt);
    t.equal(cloned.id, id, "foreign feature: id");
    t.equal(cloned.custom, pt.custom, "foreign feature: custom");
    t.deepEqual(cloned.bbox, bbox, "foreign feature: bbox");
    t.deepEqual(cloned.properties, properties, "foreign feature: properties");
  }

  // test("turf-clone -- Preserve Foreign Members -- FeatureCollection")
  {
    const properties = { foo: "bar" };
    const bbox = [0, 20, 0, 20];
    const id = 12345;
    const fc = featureCollection([point([0, 20])], { bbox, id });
    fc.custom = "foreign members";
    fc.properties = properties;
    const cloned = clone(fc);
    t.equal(cloned.id, id, "foreign fc: id");
    t.equal(cloned.custom, fc.custom, "foreign fc: custom");
    t.deepEqual(cloned.bbox, bbox, "foreign fc: bbox");
    t.deepEqual(cloned.properties, properties, "foreign fc: properties");
  }

  // test("turf-clone -- Preserve all properties -- Feature")
  {
    const id = 12345;
    const bbox = [0, 20, 0, 20];
    const properties = {
      foo: "bar",
      object: { property: 1 },
      array: [0, 1, 2],
      number: 1,
      nullity: null,
      boolean: true,
    };
    const pt = point([0, 20], properties, { bbox, id });
    pt.hello = "world";
    const cloned = clone(pt);
    t.equal(cloned.hello, "world", "all: hello");
    t.equal(cloned.properties.foo, "bar", "all: foo");
    t.equal(cloned.id, 12345, "all: id");
    t.deepEqual(cloned.bbox, [0, 20, 0, 20], "all: bbox");
    t.equal(cloned.properties.object.property, 1, "all: object.property");
    t.deepEqual(cloned.properties.array, [0, 1, 2], "all: array");
    t.equal(cloned.properties.number, 1, "all: number");
    t.equal(cloned.properties.nullity, null, "all: nullity");
    t.equal(cloned.properties.boolean, true, "all: boolean");

    cloned["hello"] = "universe";
    cloned.properties["foo"] = "foo";
    cloned["id"] = 54321;
    cloned["bbox"] = [30, 40, 30, 40];
    cloned.properties.object["property"] = 2;
    cloned.properties.array[0] = 500;
    cloned.properties.number = -99;
    cloned.properties.boolean = false;

    t.equal(pt.hello, "world", "original: hello");
    t.equal(pt.properties.foo, "bar", "original: foo");
    t.equal(pt.id, 12345, "original: id");
    t.deepEqual(pt.bbox, [0, 20, 0, 20], "original: bbox");
    t.equal(pt.properties.object.property, 1, "original: object.property");
    t.deepEqual(pt.properties.array, [0, 1, 2], "original: array");
    t.equal(pt.properties.number, 1, "original: number");
    t.equal(pt.properties.boolean, true, "original: boolean");
  }

  // test("turf-clone -- Preserve all properties -- FeatureCollection")
  {
    const bbox = [0, 20, 0, 20];
    const id = 12345;
    const fc = featureCollection([point([0, 20])], { bbox, id });
    fc.hello = "world";
    const cloned = clone(fc);
    cloned["hello"] = "universe";
    cloned["id"] = 54321;
    cloned["bbox"] = [30, 40, 30, 40];
    t.equal(fc.hello, "world", "fc original: hello");
    t.equal(fc.id, 12345, "fc original: id");
    t.deepEqual(fc.bbox, [0, 20, 0, 20], "fc original: bbox");
  }

  // test("turf-clone -- Feature with null geometry")
  {
    const fc = featureCollection([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [102.0, 0.5] },
        properties: { prop0: "value0" },
      },
      { type: "Feature", geometry: null, properties: { prop0: "value1" } },
    ]);
    const cloned = clone(fc);
    t.deepEqual(fc, cloned, "null geometry");
  }

  // test("turf-clone -- Feature with property called 'length', issue #1621")
  {
    const f = feature(
      { type: "Point", coordinates: [0, 0] },
      { processed: { length: { orig: 123.456, opti: 100.0 } } }
    );
    const cloned = clone(f);
    t.deepEqual(f, cloned, "length: deep equal");
    t.equal(cloned.properties.processed.length.orig, 123.456, "length: orig");
  }

  return { failures, count: count() };
}

describe("field-wise derived Clone on @types/geojson (Turf case study)", () => {
  it("transforms and type-checks with no errors", () => {
    const { t } = build();
    expect(transformErrors(t)).toEqual({});
    // Declared with derived<...>(), nothing is derived in place (no TS9009).
    expect(t.diagnostics["clone.ts"].filter((d) => d.includes("[TS9009]"))).toEqual([]);
    expect(t.code["clone.ts"]).not.toMatch(/\bderived\b/);
    expect(typecheck(t.code)).toEqual([]);
  });

  it("passes all 46 of turf-clone's assertions", () => {
    const { mod } = build();
    const { failures, count } = turfCloneSuite(mod().clone);
    expect(count).toBe(46);
    expect(failures).toEqual([]);
  });

  it("the clone shares no coordinates, bbox or properties with the original", () => {
    const { clone } = build().mod();
    const original = featureCollection(
      [
        point([1, 2], { tags: ["a"], nested: { n: 1 } }, { bbox: [1, 2, 1, 2] }),
        polygon([
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [0, 0],
          ],
        ]),
        geometryCollection([
          {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ]),
        feature(null, { k: "v" }),
      ],
      { bbox: [0, 0, 1, 1] }
    );
    const copy = clone(original);
    expect(copy).toEqual(original);
    const pairs: Array<[unknown, unknown]> = [];
    const collect = (a: any, b: any): void => {
      if (a === null || typeof a !== "object") return;
      pairs.push([a, b]);
      for (const k of Object.keys(a)) collect(a[k], b[k]);
    };
    collect(copy, original);
    // Every object and array in the copy is a new one.
    for (const [a, b] of pairs) expect(a).not.toBe(b);
    expect(pairs.length).toBeGreaterThan(20);
  });

  it("emits direct property construction and .map, with no runtime instance lookup", () => {
    const { t } = build();
    const out = t.code["clone.ts"];
    // Point: the coordinates are sliced in place.
    expect(out).toContain(
      "const clonePoint: Clone<Point> = { clone: (a: Point): Point => ({ ...a, coordinates: a.coordinates.slice(), " +
        "...(a.bbox && { bbox: a.bbox.slice() as typeof a.bbox }) }) };"
    );
    // MultiPolygon: one .map per level, like Turf's deepSlice.
    expect(out).toContain(
      "coordinates: a.coordinates.map(e => e.map(e1 => e1.map(e2 => e2.slice())))"
    );
    // A GeometryCollection recurses through a local helper, point-free.
    expect(out).toContain("geometries: a.geometries.map(cloneGeometry)");
    // Feature: the nullable geometry, and properties through the supplied instance.
    expect(out).toContain("geometry: a.geometry && cloneGeometry(a.geometry)");
    expect(out).toContain("properties: clonePropertiesInstance.clone(a.properties)");
    // A FeatureCollection's features go through the declared Feature instance.
    expect(out).toContain("features: a.features.map(e => cloneFeature.clone(e))");
    // The only other instance call is the hand-written one for properties.
    expect(out.match(/[\w.]+\.clone\(a\./g)).toEqual(["clonePropertiesInstance.clone(a."]);
  });

  it("without a Clone for properties, its `any` values are copied by reference (2 assertions fail)", () => {
    const { t, mod } = build(false);
    expect(transformErrors(t)).toEqual({});
    expect(t.code["clone.ts"]).toContain("properties: a.properties && { ...a.properties }");
    const { failures, count } = turfCloneSuite(mod().clone);
    expect(count).toBe(46);
    expect(failures).toEqual(["original: object.property", "original: array"]);
  });
});

describe("docs/guides/derive.md examples", () => {
  it("Nested Types: the Address is cloned through Address.Clone, not shared", () => {
    const t = transformAll({
      "people.ts": `import { derive, summon, Eq, Clone } from "typesugar";

@derive(Eq, Clone)
class Address {
  constructor(
    public city: string,
    public zip: string
  ) {}
}

@derive(Eq, Clone)
class Person {
  constructor(
    public name: string,
    public address: Address
  ) {}
}

const p1 = new Person("Alice", new Address("NYC", "10001"));
const p2 = summon<Clone<Person>>().clone(p1);
export const equal = summon<Eq<Person>>().equals(p1, p2);
export const sameAddress = p2.address === p1.address;
`,
    });
    expect(transformErrors(t)).toEqual({});
    expect(t.code["people.ts"]).toContain("address: Address.Clone.clone(a.address)");
    const m = run(t.code, "people.ts");
    expect(m.equal).toBe(true);
    expect(m.sameAddress).toBe(false);
  });

  it("Clone section: the Shape example compiles to what the guide shows", () => {
    const t = transformAll({
      "shape.ts": `/** @derive(Clone) */
export interface Shape {
  id: number;
  points: number[][];
  bbox?: [number, number, number, number];
}
`,
    });
    expect(t.diagnostics["shape.ts"]).toEqual([]);
    expect(t.code["shape.ts"]).toContain(
      "export const Clone = { clone: (a: Shape): Shape => ({ ...a, points: a.points.map(e => e.slice()), " +
        "...(a.bbox && { bbox: a.bbox.slice() as typeof a.bbox }) }) };"
    );
  });
});

describe("derived Clone on classes, and generated code free of user comments (review round 2)", () => {
  it("a class's clone keeps its prototype: methods work and instanceof holds", () => {
    const t = transformAll({
      "money.ts": `import { derive, Clone } from "typesugar";

@derive(Clone)
export class Money {
  constructor(
    public amount: number,
    public cur: string,
    public tags: string[]
  ) {}
  show() {
    return \`\${this.amount}\${this.cur}\`;
  }
}

class Base { constructor(public id: number) {} kind() { return "base"; } }
@derive(Clone)
export class Sub extends Base {
  constructor(id: number, public xs: number[]) { super(id); }
  override kind() { return "sub"; }
}

const m = new Money(1, "AUD", ["a"]);
const c = Money.Clone.clone(m);
c.tags.push("b");
export const isMoney = c instanceof Money;
export const shown = c.show();
export const tagsShared = c.tags === m.tags;
export const origTags = m.tags.length;
const s = new Sub(7, [1]);
const sc = Sub.Clone.clone(s);
export const subKind = sc.kind();
export const subId = sc.id;
export const subXsShared = sc.xs === s.xs;
`,
    });
    expect(t.diagnostics["money.ts"]).toEqual([]);
    expect(typecheck(t.code)).toEqual([]);
    expect(t.code["money.ts"]).toContain("Object.create(Object.getPrototypeOf(a))");
    const m = run(t.code, "money.ts");
    expect(m.isMoney).toBe(true);
    expect(m.shown).toBe("1AUD");
    expect(m.tagsShared).toBe(false);
    expect(m.origTags).toBe(1);
    expect(m.subKind).toBe("sub");
    expect(m.subId).toBe(7);
    expect(m.subXsShared).toBe(false);
  });

  it("a class with #private members can't be cloned field-wise: a clear error", () => {
    const t = transformAll({
      "priv.ts": `import { derive, Clone } from "typesugar";

@derive(Clone)
export class Counter {
  #n = 0;
  constructor(public label: string) {}
  inc() { return ++this.#n; }
}
`,
    });
    const errs = transformErrors(t)["priv.ts"] ?? [];
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/Clone<Counter>.*#n/s);
    expect(errs[0]).toMatch(/@impl Clone<Counter>/);
  });

  it("a class that extends a built-in can't be cloned field-wise: a clear error", () => {
    const t = transformAll({
      "builtin.ts": `import { derive, Clone } from "typesugar";

@derive(Clone)
export class Registry extends Map<string, number> {
  constructor(public name: string) { super(); }
}
`,
    });
    const errs = transformErrors(t)["builtin.ts"] ?? [];
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/Clone<Registry>.*Map/s);
  });

  it("no comment from the user's file leaks into a derived Map clone", () => {
    const t = transformAll({
      "bag.ts": `/** @derive(Clone) */
export interface Bag {
  d: Date;
  mp: Map<string, number[]>;
  t: [number, string];
}
`,
    });
    expect(t.diagnostics["bag.ts"]).toEqual([]);
    const companion = t.code["bag.ts"].slice(t.code["bag.ts"].indexOf("export const Clone"));
    expect(companion).not.toContain("/**");
    expect(companion).toContain("[k, v.slice()] as const");
  });
});
