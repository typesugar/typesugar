/**
 * Shared harness for tests that transform a small multi-file program that
 * uses a type the program doesn't own: `@types/geojson` (a trimmed copy of
 * 7946.0.14, the version the Turf case study uses), served as a virtual
 * `node_modules/@types/geojson`. The virtual root sits inside this package, so
 * `typesugar` and `@typesugar/*` resolve to the workspace's real packages.
 *
 * - {@link transformAll} builds ONE program over all files and transforms
 *   each of them, as a build does.
 * - {@link typecheck} type-checks the transformed files together.
 * - {@link run} executes the transformed modules (CommonJS, in memory).
 */
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { transformCode } from "@typesugar/transformer-core";
// Registers the built-in macros (summon, implicit, @derive, ...).
import "@typesugar/macros";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, "__external_types_virtual__");

/** `@types/geojson` 7946.0.14 (MIT), declarations only, comments removed. */
export const GEOJSON = `export type GeoJsonGeometryTypes = Geometry["type"];
export type GeoJsonTypes = GeoJSON["type"];
export type BBox = [number, number, number, number] | [number, number, number, number, number, number];
export type Position = number[];
export interface GeoJsonObject { type: GeoJsonTypes; bbox?: BBox | undefined; }
export type GeoJSON = Geometry | Feature | FeatureCollection;
export type Geometry = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;
export type GeometryObject = Geometry;
export interface Point extends GeoJsonObject { type: "Point"; coordinates: Position; }
export interface MultiPoint extends GeoJsonObject { type: "MultiPoint"; coordinates: Position[]; }
export interface LineString extends GeoJsonObject { type: "LineString"; coordinates: Position[]; }
export interface MultiLineString extends GeoJsonObject { type: "MultiLineString"; coordinates: Position[][]; }
export interface Polygon extends GeoJsonObject { type: "Polygon"; coordinates: Position[][]; }
export interface MultiPolygon extends GeoJsonObject { type: "MultiPolygon"; coordinates: Position[][][]; }
export interface GeometryCollection<G extends Geometry = Geometry> extends GeoJsonObject {
  type: "GeometryCollection";
  geometries: G[];
}
export type GeoJsonProperties = { [name: string]: any } | null;
export interface Feature<G extends Geometry | null = Geometry, P = GeoJsonProperties> extends GeoJsonObject {
  type: "Feature";
  geometry: G;
  id?: string | number | undefined;
  properties: P;
}
export interface FeatureCollection<G extends Geometry | null = Geometry, P = GeoJsonProperties> extends GeoJsonObject {
  type: "FeatureCollection";
  features: Array<Feature<G, P>>;
}
`;

export type Files = Record<string, string>;

export interface Transformed {
  code: Files;
  /** `severity: message` per file. */
  diagnostics: Record<string, string[]>;
}

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

function createProgram(files: Files): ts.Program {
  const byAbs: Files = {
    [path.join(ROOT, "node_modules/@types/geojson/index.d.ts")]: GEOJSON,
    [path.join(ROOT, "node_modules/@types/geojson/package.json")]:
      `{"name":"@types/geojson","version":"7946.0.14","types":"index.d.ts"}`,
  };
  for (const [k, v] of Object.entries(files)) byAbs[path.join(ROOT, k)] = v;
  const host = ts.createCompilerHost(compilerOptions);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lv, ...r) =>
    byAbs[f] !== undefined ? ts.createSourceFile(f, byAbs[f], lv, true) : orig(f, lv, ...r);
  host.fileExists = (f) => byAbs[f] !== undefined || ts.sys.fileExists(f);
  host.readFile = (f) => byAbs[f] ?? ts.sys.readFile(f);
  host.directoryExists = (d) =>
    Object.keys(byAbs).some((k) => k.startsWith(d + path.sep)) || ts.sys.directoryExists(d);
  return ts.createProgram(
    Object.keys(files).map((f) => path.join(ROOT, f)),
    compilerOptions,
    host
  );
}

/** Build ONE program over all files and transform each of them. */
export function transformAll(files: Files): Transformed {
  const program = createProgram(files);
  const out: Transformed = { code: {}, diagnostics: {} };
  for (const f of Object.keys(files)) {
    const r = transformCode(files[f], { fileName: path.join(ROOT, f), program });
    out.code[f] = r.code;
    out.diagnostics[f] = (r.diagnostics ?? []).map(
      (d: { severity: unknown; message: string }) => `${String(d.severity)}: ${d.message}`
    );
  }
  return out;
}

/** Errors in the transform's diagnostics, per file (files without any omitted). */
export function transformErrors(t: Transformed): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [f, ds] of Object.entries(t.diagnostics)) {
    const errs = ds.filter((d) => d.startsWith("error"));
    if (errs.length > 0) out[f] = errs;
  }
  return out;
}

/** Type-check the transformed files as one program: `file: message` per error. */
export function typecheck(code: Files): string[] {
  const program = createProgram(code);
  const out: string[] = [];
  for (const f of Object.keys(code)) {
    const sf = program.getSourceFile(path.join(ROOT, f))!;
    for (const d of [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ]) {
      out.push(`${f}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    }
  }
  return out;
}

/**
 * Execute transformed modules. Relative imports resolve within `code`;
 * anything else resolves to an empty module, so a stray runtime import of a
 * compile-time package shows up as `undefined` rather than crashing the loader.
 */
export function run(code: Files, entry: string): Record<string, any> {
  const cache = new Map<string, { exports: Record<string, any> }>();
  const load = (name: string): Record<string, any> => {
    const hit = cache.get(name);
    if (hit) return hit.exports;
    const js = ts.transpileModule(code[name], {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as Record<string, any> };
    cache.set(name, mod);
    const req = (spec: string) => {
      if (spec.startsWith("./")) {
        const key = spec.slice(2).replace(/\.(js|ts)$/, "") + ".ts";
        if (code[key] === undefined) throw new Error(`test loader: no module ${spec}`);
        return load(key);
      }
      return {};
    };
    new Function("module", "exports", "require", js)(mod, mod.exports, req);
    return mod.exports;
  };
  return load(entry);
}
