/**
 * Extension methods for geometry types.
 *
 * Use with registerExtensions() to enable method-call syntax:
 *   v.magnitude(), p.translate(vec), etc.
 */

import {
  addVec,
  subVec,
  scale,
  magnitude,
  normalize,
  dot,
  translate,
  displacement,
  distance,
  midpoint,
  negate,
} from "./operations.js";
import type { Point2D, Point3D, Vec2, Vec3, Vector } from "./types.js";

/** Extension methods for Vec2 — use with registerExtensions("Vec2", Vec2Ext) */
export const Vec2Ext = {
  add: (v: Vec2, other: Vec2) => addVec(v, other),
  sub: (v: Vec2, other: Vec2) => subVec(v, other),
  scale: (v: Vec2, s: number) => scale(v, s),
  negate: (v: Vec2) => negate(v),
  magnitude: (v: Vec2) => magnitude(v),
  normalize: (v: Vec2) => normalize(v),
  dot: (v: Vec2, other: Vec2) => dot(v, other),
};

/** Extension methods for Vec3 — use with registerExtensions("Vec3", Vec3Ext) */
export const Vec3Ext = {
  add: (v: Vec3, other: Vec3) => addVec(v, other),
  sub: (v: Vec3, other: Vec3) => subVec(v, other),
  scale: (v: Vec3, s: number) => scale(v, s),
  negate: (v: Vec3) => negate(v),
  magnitude: (v: Vec3) => magnitude(v),
  normalize: (v: Vec3) => normalize(v),
  dot: (v: Vec3, other: Vec3) => dot(v, other),
};

/** Extension methods for Point2D — use with registerExtensions("Point2D", Point2DExt) */
export const Point2DExt = {
  translate: (p: Point2D, v: Vec2) => translate(p, v),
  displacement: (p: Point2D, to: Point2D) => displacement(p, to),
  distance: (p: Point2D, other: Point2D) => distance(p, other),
  midpoint: (p: Point2D, other: Point2D) => midpoint(p, other),
};

/** Extension methods for Point3D — use with registerExtensions("Point3D", Point3DExt) */
export const Point3DExt = {
  translate: (p: Point3D, v: Vec3) => translate(p, v),
  displacement: (p: Point3D, to: Point3D) => displacement(p, to),
  distance: (p: Point3D, other: Point3D) => distance(p, other),
  midpoint: (p: Point3D, other: Point3D) => midpoint(p, other),
};
