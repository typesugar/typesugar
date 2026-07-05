/**
 * Tests for the implicit trigger-label attribute macro dispatch (PEP-056
 * Wave 4) — `tryExpandImplicitLabelMacro`, ported from legacy
 * `packages/transformer/src/index.ts`'s private method of the same name.
 *
 * This is a private method on `MacroTransformer`, so it can only be driven
 * end-to-end through the public `transformCode()` API — which also proves
 * the dispatch WIRING in `tryTransform`, not just a standalone function.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry, type MacroContext } from "@typesugar/core";
import { transformCode } from "../src/transform.js";

const MARKER = "__implicitLabelMacroApplied";
const SYNTAX_MODULE = "__test-implicit-label-syntax-marker";

beforeAll(() => {
  // Registered once under a unique name/label — harmless residue in the
  // shared globalRegistry for the rest of the test run, same as how real
  // macro packages register themselves as an import side effect. The
  // `syntaxModule` feeds the resolution-free marker-fallback path (see
  // `syntax-marker-fallback.ts`), so activation in these tests goes through
  // the real `scanImportsForScope` mechanism via a plain side-effect import
  // rather than a manual bypass — `scanImportsForScope` unconditionally
  // clears and rebuilds each file's scope on every transform, so directly
  // calling `globalResolutionScope.activateLabelSyntax()` before
  // `transformCode()` would just get wiped before dispatch ever runs.
  globalRegistry.register(
    defineAttributeMacro({
      name: "__testTriggerLabelMacro",
      description: "test-only macro for implicit trigger-label dispatch",
      validTargets: ["function", "method"],
      triggerLabels: ["ensures"],
      syntaxModule: SYNTAX_MODULE,
      expand(ctx: MacroContext, _decorator, target) {
        const fn = target as ts.FunctionDeclaration;
        const factory = ctx.factory;
        return factory.updateFunctionDeclaration(
          fn,
          fn.modifiers,
          fn.asteriskToken,
          fn.name,
          fn.typeParameters,
          fn.parameters,
          fn.type,
          factory.createBlock(
            [factory.createExpressionStatement(factory.createIdentifier(MARKER))],
            true
          )
        );
      },
    })
  );
});

describe("implicit trigger-label attribute macro dispatch", () => {
  it("applies the macro to a bare labeled block when label syntax is activated", () => {
    const fileName = "implicit-label-1.ts";

    const result = transformCode(
      `
      import "${SYNTAX_MODULE}";
      function withdraw(amount: number): number {
        ensures: {
          amount > 0;
        }
        return amount;
      }
      `,
      { fileName }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.code).toContain(MARKER);
    expect(result.code).not.toContain("ensures:");
  });

  it("does not apply the macro and emits TS9224 when label syntax is not activated", () => {
    const fileName = "implicit-label-2.ts";
    // Deliberately not calling activateLabelSyntax for this fileName.

    const result = transformCode(
      `
      function withdraw(amount: number): number {
        ensures: {
          amount > 0;
        }
        return amount;
      }
      `,
      { fileName }
    );

    expect(result.code).not.toContain(MARKER);
    expect(result.code).toContain("ensures:");
    const hint = result.diagnostics.find((d) => d.code === 9224);
    expect(hint).toBeDefined();
  });

  it("does not hijack an ordinary (non-block-shaped) label with the same name", () => {
    const fileName = "implicit-label-3.ts";

    const result = transformCode(
      `
      import "${SYNTAX_MODULE}";
      function withdraw(amount: number): number {
        ensures: while (amount > 0) {
          break ensures;
        }
        return amount;
      }
      `,
      { fileName }
    );

    expect(result.code).not.toContain(MARKER);
    expect(result.code).toContain("ensures:");
  });
});
