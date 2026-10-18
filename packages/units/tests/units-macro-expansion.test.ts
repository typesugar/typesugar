/**
 * MU-3 / MU-21: the `units` macro's expansion, executed.
 *
 * Runs real source through the in-memory transformer (`transformCode`), then
 * EXECUTES the output with `@typesugar/units` bound to this package's runtime
 * entry. The bug class here (a bare constructor identifier with its import
 * stripped → ReferenceError, or a capture of a user's local `meters`) only
 * shows up when the generated code runs, so these tests do not grep text.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import "../src/macros.js"; // registers the `units` macro
import * as unitsRuntime from "../src/index.js";
import { transformCode } from "../../transformer-core/src/index.js";

const FILE = "/virtual/units-macro-expansion.ts";

function expand(source: string) {
  const result = transformCode(source, { fileName: FILE });
  const messages = (result.diagnostics ?? []).map((d) => String(d.message));
  return { code: result.code, messages };
}

/** Transpile the transformed TS to CJS and run it; returns its exports. */
function run(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (id: string) => {
    if (id === "@typesugar/units") return unitsRuntime;
    throw new Error(`unexpected require(${id})`);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

describe("units macro expansion (executed)", () => {
  it("tagged template with only `units` imported runs and yields the right quantity", () => {
    const { code, messages } = expand(
      `import { units } from "@typesugar/units";\nexport const speed = units\`100 km/h\`;\n`
    );
    expect(messages).toEqual([]);
    // The macro must have expanded (not fallen back to the runtime tag).
    expect(code).not.toContain("units`");
    const out = run(code);
    const speed = out.speed as unitsRuntime.Unit<unitsRuntime.Velocity>;
    expect(speed).toBeInstanceOf(unitsRuntime.Unit);
    expect(speed.value).toBeCloseTo(100 / 3.6, 12);
    expect(speed.symbol).toBe("km/h");
  });

  it('call forms units("5 m") and units(5, "kg") run with only `units` imported', () => {
    const { code, messages } = expand(
      `import { units } from "@typesugar/units";\n` +
        `export const a = units("5 m");\nexport const b = units(5, "kg");\n`
    );
    expect(messages).toEqual([]);
    const out = run(code);
    expect((out.a as unitsRuntime.Unit<unitsRuntime.Length>).toString()).toBe("5 m");
    expect((out.b as unitsRuntime.Unit<unitsRuntime.Mass>).toString()).toBe("5 kg");
  });

  it("does not capture a top-level user binding with the constructor's name", () => {
    const { code, messages } = expand(
      `import { units } from "@typesugar/units";\n` +
        `export const meters = 42;\nexport const d = units\`5 m\`;\n`
    );
    expect(messages).toEqual([]);
    const out = run(code);
    expect(out.meters).toBe(42);
    expect((out.d as unitsRuntime.Unit<unitsRuntime.Length>).toString()).toBe("5 m");
  });

  it("does not silently call a function-local binding with the constructor's name", () => {
    const { code, messages } = expand(
      `import { units } from "@typesugar/units";\n` +
        `export function f() { const meters = (n: number) => n * 1000; return units\`5 m\`; }\n`
    );
    // There is no MacroContext API to force an aliased import for a
    // function-local collision, so the macro must refuse with a diagnostic
    // naming the constructor — never emit `meters(5)` for the local to capture.
    expect(messages.join("\n")).toMatch(/local binding named `meters` shadows it/);
    expect(code).not.toMatch(/return meters\(5\)/);
  });

  it("rejects Object.prototype keys as units with a diagnostic (MU-21)", () => {
    for (const key of ["toString", "hasOwnProperty", "constructor", "__proto__"]) {
      const { messages } = expand(
        `import { units } from "@typesugar/units";\nexport const w = units\`5 ${key}\`;\n`
      );
      expect(messages.join("\n")).toContain(`Unknown unit: ${key}`);
      const { messages: m2 } = expand(
        `import { units } from "@typesugar/units";\nexport const w = units(5, "${key}");\n`
      );
      expect(m2.join("\n")).toContain(`Unknown unit: ${key}`);
    }
  });
});

describe("units runtime fallback (MU-21)", () => {
  it("throws Unknown unit for Object.prototype keys", () => {
    const tag = (s: string) =>
      unitsRuntime.units(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray);
    for (const key of ["toString", "hasOwnProperty", "constructor", "__proto__", "valueOf"]) {
      expect(() => tag(`5 ${key}`)).toThrow(`Unknown unit: ${key}`);
    }
    expect(tag("5 m").toString()).toBe("5 m");
  });
});
