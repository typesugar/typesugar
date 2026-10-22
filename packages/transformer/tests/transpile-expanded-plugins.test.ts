/**
 * transpileExpanded (the bundler plugins' TS → JS step, after expansion) must
 * not hand the project's `plugins` to TypeScript.
 *
 * With ts-patch installed (`typesugar create library` runs `ts-patch install`
 * in `prepare`), TypeScript applies every `{ "transform": ... }` entry of
 * `compilerOptions.plugins`, in `transpileModule` too. The library template's
 * tsconfig lists `@typesugar/transformer` there for `tspc`, so the ALREADY
 * EXPANDED code was expanded a second time: a `/** @typeclass *\/` interface
 * got its companion twice, and tsup failed with "Multiple exports with the
 * same name 'Printable'".
 */
import { describe, it, expect, vi } from "vitest";

const seenOptions: Array<Record<string, unknown>> = [];

vi.mock("typescript", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  const real = (actual.default ?? actual) as typeof import("typescript");
  const transpileModule: typeof real.transpileModule = (input, options) => {
    seenOptions.push({ ...(options.compilerOptions ?? {}) });
    return real.transpileModule(input, options);
  };
  return { ...actual, ...real, transpileModule, default: { ...real, transpileModule } };
});

const { transpileExpanded } = await import("../src/pipeline.js");

describe("transpileExpanded", () => {
  it("drops compilerOptions.plugins, so a ts-patched TypeScript does not expand the code again", () => {
    seenOptions.length = 0;
    const out = transpileExpanded("export const x: number = 1;\n", "/p/src/a.ts", {
      plugins: [
        { name: "@typesugar/transformer/language-service" },
        { transform: "@typesugar/transformer", type: "program" },
      ] as never,
      declaration: true,
    });
    expect(out.outputText).toContain("export const x = 1;");
    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0].plugins).toBeUndefined();
  });
});
