/**
 * Decorators and JSDoc tags share one attribute-macro dispatcher
 * (transformer-core/src/attribute-dispatch.ts; audit/ARCH-REVIEW-2026-11.md A1).
 * Each case runs the same macros through both syntaxes and expects the same
 * behaviour: expandAfter order, failure handling, visiting a macro's extra
 * statements, and expansion tracking.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import { globalRegistry, type AttributeMacro } from "@typesugar/core";
import { transformCode } from "../src/pipeline.js";

const MODULE = "arch-review-dispatch-test-macros";
const order: string[] = [];

function attribute(
  name: string,
  expand: AttributeMacro["expand"],
  extra: Partial<AttributeMacro> = {}
): AttributeMacro {
  return {
    kind: "attribute",
    name,
    module: MODULE,
    validTargets: ["class", "interface"],
    expand,
    ...extra,
  } as AttributeMacro;
}

beforeAll(() => {
  globalRegistry.register(
    attribute("archFirst", (_ctx, _d, target) => (order.push("archFirst"), target))
  );
  globalRegistry.register(
    attribute("archSecond", (_ctx, _d, target) => (order.push("archSecond"), target), {
      expandAfter: ["archFirst"],
    })
  );
  globalRegistry.register(
    attribute("archBoom", () => {
      throw new Error("kaboom");
    })
  );
  // Returns an extra statement holding the class's own first initializer (a
  // real source node, so the macro call in it is expandable): it must be
  // visited, as the target is.
  globalRegistry.register(
    attribute("archExtra", (ctx, _d, target) => {
      const f = ctx.factory;
      const prop = (target as ts.ClassDeclaration).members.find(ts.isPropertyDeclaration)!;
      const extra = f.createVariableStatement(
        [f.createModifier(ts.SyntaxKind.ExportKeyword)],
        f.createVariableDeclarationList(
          [f.createVariableDeclaration("archExtraValue", undefined, undefined, prop.initializer!)],
          ts.NodeFlags.Const
        )
      );
      return [target, extra];
    })
  );
});

const IMPORTS = `import { comptime } from "typesugar";\nimport "${MODULE}";\n`;
const FORMS = {
  decorator: (tags: string[]) =>
    `${IMPORTS}${tags.map((t) => `@${t}`).join("\n")}\nexport class A { x = comptime(() => 20 + 22); }\n`,
  jsdoc: (tags: string[]) =>
    `${IMPORTS}/**\n${tags.map((t) => ` * @${t}`).join("\n")}\n */\nexport class A { x = comptime(() => 20 + 22); }\n`,
};

describe.each(Object.entries(FORMS))("attribute dispatch via %s", (form, src) => {
  it("expands in expandAfter order, whatever the written order", () => {
    order.length = 0;
    transformCode(src(["archSecond", "archFirst"]), { fileName: `dispatch-order-${form}.ts` });
    expect(order).toEqual(["archFirst", "archSecond"]);
  });

  it("reports a failure at the source and emits a throwing stub", () => {
    const r = transformCode(src(["archBoom"]), { fileName: `dispatch-boom-${form}.ts` });
    const errs = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    expect(errs.some((m) => m.includes("@archBoom macro expansion failed: kaboom"))).toBe(true);
    expect(r.code).toContain("attribute macro 'archBoom' failed: kaboom");
  });

  it("expands macros inside a macro's extra statements", () => {
    const r = transformCode(src(["archExtra"]), { fileName: `dispatch-extra-${form}.ts` });
    expect(r.code).toContain("export const archExtraValue = 42;");
  });

  it("records the expansion when tracking is on", () => {
    const r = transformCode(src(["archExtra"]), {
      fileName: `dispatch-track-${form}.ts`,
      trackExpansions: true,
    });
    expect((r.expansions ?? []).some((e) => e.macroName === "archExtra")).toBe(true);
  });
});
