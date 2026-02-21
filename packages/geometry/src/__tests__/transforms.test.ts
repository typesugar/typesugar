import { describe, expect, it } from "vitest";
import {
  point2d,
  point3d,
  vec2,
  vec3,
  rotation2d,
  translation2d,
  scale2d,
  shear2d,
  rotationX,
  rotationY,
  rotationZ,
  translation3d,
  scale3d,
  applyToPoint,
  applyToVector,
  compose,
  identity2d,
  identity3d,
  inverse,
} from "../index.js";

const EPSILON = 5;

describe("2D rotation", () => {
  it("rotates 90 degrees", () => {
    const r = rotation2d(Math.PI / 2);
    const p = applyToPoint(r, point2d(1, 0));
    expect(p[0]).toBeCloseTo(0, EPSILON);
    expect(p[1]).toBeCloseTo(1, EPSILON);
  });

  it("rotates 180 degrees", () => {
    const r = rotation2d(Math.PI);
    const p = applyToPoint(r, point2d(1, 0));
    expect(p[0]).toBeCloseTo(-1, EPSILON);
    expect(p[1]).toBeCloseTo(0, EPSILON);
  });

  it("rotates 360 degrees (full circle)", () => {
    const r = rotation2d(2 * Math.PI);
    const p = applyToPoint(r, point2d(3, 4));
    expect(p[0]).toBeCloseTo(3, EPSILON);
    expect(p[1]).toBeCloseTo(4, EPSILON);
  });

  it("rotates arbitrary angle", () => {
    const r = rotation2d(Math.PI / 4);
    const p = applyToPoint(r, point2d(1, 0));
    expect(p[0]).toBeCloseTo(Math.SQRT2 / 2, EPSILON);
    expect(p[1]).toBeCloseTo(Math.SQRT2 / 2, EPSILON);
  });
});

describe("2D translation", () => {
  it("translates a point", () => {
    const t = translation2d(3, 5);
    const p = applyToPoint(t, point2d(1, 2));
    expect(p[0]).toBeCloseTo(4, EPSILON);
    expect(p[1]).toBeCloseTo(7, EPSILON);
  });

  it("translation does not affect vectors", () => {
    const t = translation2d(100, 200);
    const v = applyToVector(t, vec2(1, 2));
    expect(v[0]).toBeCloseTo(1, EPSILON);
    expect(v[1]).toBeCloseTo(2, EPSILON);
  });
});

describe("2D scale", () => {
  it("scales uniformly", () => {
    const s = scale2d(2, 2);
    const p = applyToPoint(s, point2d(3, 4));
    expect(p[0]).toBeCloseTo(6, EPSILON);
    expect(p[1]).toBeCloseTo(8, EPSILON);
  });

  it("scales non-uniformly", () => {
    const s = scale2d(2, 3);
    const p = applyToPoint(s, point2d(1, 1));
    expect(p[0]).toBeCloseTo(2, EPSILON);
    expect(p[1]).toBeCloseTo(3, EPSILON);
  });
});

describe("2D shear", () => {
  it("shears in x", () => {
    const s = shear2d(1, 0);
    const p = applyToPoint(s, point2d(0, 1));
    expect(p[0]).toBeCloseTo(1, EPSILON);
    expect(p[1]).toBeCloseTo(1, EPSILON);
  });
});

describe("3D rotations", () => {
  it("rotationX rotates around X axis", () => {
    const r = rotationX(Math.PI / 2);
    const p = applyToPoint(r, point3d(0, 1, 0));
    expect(p[0]).toBeCloseTo(0, EPSILON);
    expect(p[1]).toBeCloseTo(0, EPSILON);
    expect(p[2]).toBeCloseTo(1, EPSILON);
  });

  it("rotationY rotates around Y axis", () => {
    const r = rotationY(Math.PI / 2);
    const p = applyToPoint(r, point3d(1, 0, 0));
    expect(p[0]).toBeCloseTo(0, EPSILON);
    expect(p[1]).toBeCloseTo(0, EPSILON);
    expect(p[2]).toBeCloseTo(-1, EPSILON);
  });

  it("rotationZ rotates around Z axis", () => {
    const r = rotationZ(Math.PI / 2);
    const p = applyToPoint(r, point3d(1, 0, 0));
    expect(p[0]).toBeCloseTo(0, EPSILON);
    expect(p[1]).toBeCloseTo(1, EPSILON);
    expect(p[2]).toBeCloseTo(0, EPSILON);
  });
});

describe("3D translation", () => {
  it("translates a 3D point", () => {
    const t = translation3d(1, 2, 3);
    const p = applyToPoint(t, point3d(10, 20, 30));
    expect(p[0]).toBeCloseTo(11, EPSILON);
    expect(p[1]).toBeCloseTo(22, EPSILON);
    expect(p[2]).toBeCloseTo(33, EPSILON);
  });

  it("translation does not affect 3D vectors", () => {
    const t = translation3d(100, 200, 300);
    const v = applyToVector(t, vec3(1, 2, 3));
    expect(v[0]).toBeCloseTo(1, EPSILON);
    expect(v[1]).toBeCloseTo(2, EPSILON);
    expect(v[2]).toBeCloseTo(3, EPSILON);
  });
});

describe("composition", () => {
  it("compose with identity is no-op (2D)", () => {
    const r = rotation2d(Math.PI / 4);
    const composed = compose(r, identity2d());
    const p1 = applyToPoint(r, point2d(1, 0));
    const p2 = applyToPoint(composed, point2d(1, 0));
    expect(p2[0]).toBeCloseTo(p1[0], EPSILON);
    expect(p2[1]).toBeCloseTo(p1[1], EPSILON);
  });

  it("compose with identity is no-op (3D)", () => {
    const r = rotationX(Math.PI / 3);
    const composed = compose(r, identity3d());
    const p1 = applyToPoint(r, point3d(0, 1, 0));
    const p2 = applyToPoint(composed, point3d(0, 1, 0));
    expect(p2[0]).toBeCloseTo(p1[0], EPSILON);
    expect(p2[1]).toBeCloseTo(p1[1], EPSILON);
    expect(p2[2]).toBeCloseTo(p1[2], EPSILON);
  });

  it("rotate then translate differs from translate then rotate", () => {
    const r = rotation2d(Math.PI / 2);
    const t = translation2d(1, 0);

    const rt = compose(r, t);
    const tr = compose(t, r);

    const p = point2d(1, 0);
    const prt = applyToPoint(rt, p);
    const ptr = applyToPoint(tr, p);

    const same = Math.abs(prt[0] - ptr[0]) < 1e-10 && Math.abs(prt[1] - ptr[1]) < 1e-10;
    expect(same).toBe(false);
  });

  it("composes multiple 2D transforms", () => {
    const r = rotation2d(Math.PI / 2);
    const t = translation2d(5, 0);
    const combined = compose(r, t);
    const p = applyToPoint(combined, point2d(0, 0));
    expect(p[0]).toBeCloseTo(5, EPSILON);
    expect(p[1]).toBeCloseTo(0, EPSILON);

    const p2 = applyToPoint(combined, point2d(1, 0));
    expect(p2[0]).toBeCloseTo(5, EPSILON);
    expect(p2[1]).toBeCloseTo(1, EPSILON);
  });
});

describe("identity", () => {
  it("identity2d leaves point unchanged", () => {
    const p = point2d(7, 11);
    const result = applyToPoint(identity2d(), p);
    expect(result[0]).toBeCloseTo(7, EPSILON);
    expect(result[1]).toBeCloseTo(11, EPSILON);
  });

  it("identity3d leaves point unchanged", () => {
    const p = point3d(7, 11, 13);
    const result = applyToPoint(identity3d(), p);
    expect(result[0]).toBeCloseTo(7, EPSILON);
    expect(result[1]).toBeCloseTo(11, EPSILON);
    expect(result[2]).toBeCloseTo(13, EPSILON);
  });
});

describe("inverse", () => {
  it("transform then inverse gives original (2D rotation)", () => {
    const r = rotation2d(Math.PI / 3);
    const rInv = inverse(r);
    const p = point2d(3, 4);
    const transformed = applyToPoint(r, p);
    const back = applyToPoint(rInv, transformed);
    expect(back[0]).toBeCloseTo(p[0], EPSILON);
    expect(back[1]).toBeCloseTo(p[1], EPSILON);
  });

  it("transform then inverse gives original (2D translation)", () => {
    const t = translation2d(5, -3);
    const tInv = inverse(t);
    const p = point2d(1, 2);
    const back = applyToPoint(tInv, applyToPoint(t, p));
    expect(back[0]).toBeCloseTo(1, EPSILON);
    expect(back[1]).toBeCloseTo(2, EPSILON);
  });

  it("transform then inverse gives original (3D rotation)", () => {
    const r = rotationX(1.2);
    const rInv = inverse(r);
    const p = point3d(1, 2, 3);
    const back = applyToPoint(rInv, applyToPoint(r, p));
    expect(back[0]).toBeCloseTo(1, EPSILON);
    expect(back[1]).toBeCloseTo(2, EPSILON);
    expect(back[2]).toBeCloseTo(3, EPSILON);
  });

  it("transform then inverse gives original (3D translation)", () => {
    const t = translation3d(10, 20, 30);
    const tInv = inverse(t);
    const p = point3d(5, 5, 5);
    const back = applyToPoint(tInv, applyToPoint(t, p));
    expect(back[0]).toBeCloseTo(5, EPSILON);
    expect(back[1]).toBeCloseTo(5, EPSILON);
    expect(back[2]).toBeCloseTo(5, EPSILON);
  });

  it("compose(t, inverse(t)) ~ identity (2D)", () => {
    const r = rotation2d(0.7);
    const composed = compose(r, inverse(r));
    const p = point2d(3, 4);
    const result = applyToPoint(composed, p);
    expect(result[0]).toBeCloseTo(3, EPSILON);
    expect(result[1]).toBeCloseTo(4, EPSILON);
  });

  it("compose(t, inverse(t)) ~ identity (3D)", () => {
    const s = scale3d(2, 3, 4);
    const composed = compose(s, inverse(s));
    const p = point3d(1, 1, 1);
    const result = applyToPoint(composed, p);
    expect(result[0]).toBeCloseTo(1, EPSILON);
    expect(result[1]).toBeCloseTo(1, EPSILON);
    expect(result[2]).toBeCloseTo(1, EPSILON);
  });
});

describe("apply to vector vs point", () => {
  it("translation affects points but not vectors (2D)", () => {
    const t = translation2d(10, 20);
    const pResult = applyToPoint(t, point2d(1, 2));
    const vResult = applyToVector(t, vec2(1, 2));
    expect(pResult[0]).toBeCloseTo(11, EPSILON);
    expect(pResult[1]).toBeCloseTo(22, EPSILON);
    expect(vResult[0]).toBeCloseTo(1, EPSILON);
    expect(vResult[1]).toBeCloseTo(2, EPSILON);
  });

  it("rotation affects both points and vectors equally (2D)", () => {
    const r = rotation2d(Math.PI / 2);
    const pResult = applyToPoint(r, point2d(1, 0));
    const vResult = applyToVector(r, vec2(1, 0));
    expect(pResult[0]).toBeCloseTo(vResult[0], EPSILON);
    expect(pResult[1]).toBeCloseTo(vResult[1], EPSILON);
  });
});

describe("singular matrix", () => {
  it("inverse throws for a zero scale (singular 2D)", () => {
    const s = scale2d(0, 0);
    expect(() => inverse(s)).toThrow(/Singular/);
  });

  it("inverse throws for a singular 3D matrix", () => {
    const s = scale3d(0, 1, 1);
    expect(() => inverse(s)).toThrow(/Singular/);
  });
});
