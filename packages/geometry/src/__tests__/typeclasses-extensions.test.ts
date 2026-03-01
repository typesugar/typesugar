/**
 * Tests for Show typeclass and extension method registration
 */
import { describe, it, expect } from "vitest";
import { vec2, vec3, point2d, point3d } from "../constructors.js";
import { showVec2, showVec3, showPoint2D, showPoint3D } from "../typeclasses.js";
import { Vec2Ext, Vec3Ext, Point2DExt, Point3DExt } from "../extensions.js";

describe("Show typeclass", () => {
  it("showVec2 produces Vec2(x, y) format", () => {
    const v = vec2(3, 4);
    expect(showVec2.show(v)).toBe("Vec2(3, 4)");
  });

  it("showVec3 produces Vec3(x, y, z) format", () => {
    const v = vec3(1, 2, 3);
    expect(showVec3.show(v)).toBe("Vec3(1, 2, 3)");
  });

  it("showPoint2D produces Point2D(x, y) format", () => {
    const p = point2d(5, 6);
    expect(showPoint2D.show(p)).toBe("Point2D(5, 6)");
  });

  it("showPoint3D produces Point3D(x, y, z) format", () => {
    const p = point3d(1, 0, 0);
    expect(showPoint3D.show(p)).toBe("Point3D(1, 0, 0)");
  });
});

describe("Extension namespaces", () => {
  it("Vec2Ext has magnitude, add, scale, etc.", () => {
    const v = vec2(3, 4);
    expect(Vec2Ext.magnitude(v)).toBe(5);
    expect(Vec2Ext.add(v, vec2(1, 0))).toEqual([4, 4]);
    expect(Vec2Ext.scale(v, 2)).toEqual([6, 8]);
    expect(Vec2Ext.dot(v, vec2(1, 0))).toBe(3);
  });

  it("Vec3Ext has magnitude, add, scale, etc.", () => {
    const v = vec3(1, 0, 0);
    expect(Vec3Ext.magnitude(v)).toBe(1);
    expect(Vec3Ext.add(v, vec3(0, 1, 0))).toEqual([1, 1, 0]);
  });

  it("Point2DExt has translate, distance, midpoint", () => {
    const p = point2d(0, 0);
    const q = point2d(3, 4);
    expect(Point2DExt.distance(p, q)).toBe(5);
    expect(Point2DExt.midpoint(p, q)).toEqual([1.5, 2]);
    expect(Point2DExt.translate(p, vec2(1, 2))).toEqual([1, 2]);
  });

  it("Point3DExt has translate, distance, midpoint", () => {
    const p = point3d(0, 0, 0);
    const q = point3d(1, 0, 0);
    expect(Point3DExt.distance(p, q)).toBe(1);
    expect(Point3DExt.translate(p, vec3(1, 2, 3))).toEqual([1, 2, 3]);
  });
});
