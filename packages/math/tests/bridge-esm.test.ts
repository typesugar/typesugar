/**
 * MU-15: the units bridge must not use `require` (it throws in the ESM build).
 * Runs the BUILT ESM bundle in a child Node process, as an ESM consumer would.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { readFileSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const esmEntry = path.join(here, "../dist/index.js");

describe("MU-15: units bridge in ESM", () => {
  it("source has no require() calls", () => {
    const src = readFileSync(path.join(here, "../src/bridge/units.ts"), "utf8");
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it("rationalToUnit / unitToRationalPrecise work from the ESM bundle", () => {
    const script = `
      const m = await import(${JSON.stringify(esmEntry)});
      const u = m.rationalToUnit(m.rational(1n, 2n), "m");
      const r = m.unitToRationalPrecise(m.meters(5));
      console.log(JSON.stringify({ v: u.value, s: u.symbol, isUnit: u instanceof m.Unit, num: String(r.num), den: String(r.den) }));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(out.trim())).toEqual({ v: 0.5, s: "m", isUnit: true, num: "5", den: "1" });
  });
});
