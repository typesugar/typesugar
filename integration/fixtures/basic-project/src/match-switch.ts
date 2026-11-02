// match: — the statement form of pattern matching (std match-switch.ts).
import "@typesugar/std/syntax/match";

type Geometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Polygon"; coordinates: number[][][] };

export function describeGeometry(geom: Geometry): number {
  match: switch (geom) {
    case { type: "Point", coordinates: [x, y] }:
      return x + y;
    case { type: "LineString", coordinates }:
      return coordinates.length;
    case { type: "Polygon" }:
      return 0;
  }
}

export function kindNumber(kind: Geometry["type"]): number {
  match: switch (kind) {
    case "Point":
      return 1;
    case "LineString":
      return 2;
  }
  return 0;
}
