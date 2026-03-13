/**
 * Snapshot tests for oxc-engine macros
 *
 * These tests verify that the oxc-engine produces identical output
 * to the TypeScript pipeline for cfg and static-assert macros.
 */

import { describe, test, expect } from "vitest";

// We'll import the native module once built
// For now, test the Rust implementation via transform function
const oxcEngine = require("../oxc-engine.darwin-arm64.node");

describe("cfg macro", () => {
  test("removes declaration when flag is disabled", () => {
    const source = `/** @cfg debug */
const debugLog = () => console.log("debug");

const normalCode = 1;`;

    // With debug=false, debugLog should be removed
    const result = oxcEngine.transform(source, "test.ts", {
      cfgConfig: { debug: false },
    });

    expect(result.diagnostics).toHaveLength(0);
    // debugLog should be removed
    expect(result.code).not.toContain("debugLog");
    // normalCode should remain
    expect(result.code).toContain("normalCode");
    // Code was changed
    expect(result.changed).toBe(true);
  });

  test("keeps declaration when flag is enabled", () => {
    const source = `/** @cfg debug */
const debugLog = () => console.log("debug");

const normalCode = 1;`;

    // With debug=true, debugLog should be kept
    const result = oxcEngine.transform(source, "test.ts", {
      cfgConfig: { debug: true },
    });

    expect(result.diagnostics).toHaveLength(0);
    // Both declarations should be present
    expect(result.code).toContain("debugLog");
    expect(result.code).toContain("normalCode");
    // Code was not changed (keeping is not a change)
    expect(result.changed).toBe(false);
  });

  test("handles complex condition", () => {
    const source = `/** @cfg debug && !production */
const devOnlyCode = true;`;

    const result = oxcEngine.transform(source, "test.ts", {
      cfgConfig: { debug: true, production: false },
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("devOnlyCode");
  });
});

describe("staticAssert macro", () => {
  test("removes passing assertion", () => {
    const source = `staticAssert(true, "should pass");
const x = 1;`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    // staticAssert should be removed
    expect(result.code).not.toContain("staticAssert");
    // Rest of code should remain
    expect(result.code).toContain("const x = 1");
    expect(result.changed).toBe(true);
  });

  test("reports error for failing assertion", () => {
    const source = `staticAssert(false, "This should fail");`;

    const result = oxcEngine.transform(source, "test.ts", {});

    // Should have an error diagnostic
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe("error");
    expect(result.diagnostics[0].message).toContain("staticAssert failed");
    expect(result.diagnostics[0].message).toContain("This should fail");
  });

  test("handles simple number comparisons", () => {
    // Simple comparison without arithmetic
    const source = `staticAssert(1 === 1, "One equals one");
const x = 1;`;

    const result = oxcEngine.transform(source, "test.ts", {});

    // This should pass and be removed
    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).not.toContain("staticAssert");
    expect(result.code).toContain("const x = 1");
    expect(result.changed).toBe(true);
  });

  test("handles arithmetic as unevaluable", () => {
    // Arithmetic expressions are not yet supported
    const source = `staticAssert(1 + 1 === 2, "Math is broken");`;

    const result = oxcEngine.transform(source, "test.ts", {});

    // Arithmetic is not supported yet, so should warn
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe("warning");
  });

  test("warns on unevaluable condition", () => {
    const source = `staticAssert(someVariable, "Variable check");`;

    const result = oxcEngine.transform(source, "test.ts", {});

    // Should have a warning diagnostic for unevaluable condition
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe("warning");
    expect(result.diagnostics[0].message).toContain("cannot be evaluated");
    // The call should be kept
    expect(result.code).toContain("staticAssert");
  });
});

describe("preprocessed .sts content", () => {
  test("parses __binop__ correctly", () => {
    const source = `// Preprocessed from: x |> double |> square
const result = __binop__(__binop__(x, "|>", double), "|>", square);`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    expect(result.code).toContain('"|>"');
  });

  test("parses Kind<F,A> correctly", () => {
    const source = `// HKT placeholder - preprocessed
interface Functor<F> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("Functor");
    expect(result.code).toContain("Kind");
  });

  test("parses mixed .sts content", () => {
    const source = `/** @typeclass */
interface Eq<A> {
  equals(a: A, other: A): boolean;
}

/** @impl Eq<number> */
const eqNumber: Eq<number> = {
  equals: (a, b) => a === b,
};

// Pipeline operator usage (preprocessed)
const result = __binop__(5, "|>", double);`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("Eq");
    expect(result.code).toContain("eqNumber");
    expect(result.code).toContain("__binop__");
  });
});

describe("JSDoc annotation detection", () => {
  test("detects @typeclass annotation", () => {
    const source = `/** @typeclass */
interface Show<A> {
  show(a: A): string;
}`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("Show");
  });

  test("detects @impl annotation", () => {
    const source = `/** @impl Show<number> */
const showNumber = { show: (n: number) => String(n) };`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("showNumber");
  });

  test("detects @deriving annotation", () => {
    const source = `/** @deriving Eq, Show */
interface Point {
  x: number;
  y: number;
}`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("Point");
  });

  test("detects multiple annotations on same declaration", () => {
    const source = `/**
 * @typeclass
 * @pure
 */
interface Monad<M> {
  pure<A>(a: A): Kind<M, A>;
  flatMap<A, B>(ma: Kind<M, A>, f: (a: A) => Kind<M, B>): Kind<M, B>;
}`;

    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("Monad");
    expect(result.code).toContain("pure");
    expect(result.code).toContain("flatMap");
  });
});

describe("source map generation", () => {
  test("generates source map when enabled", () => {
    const source = `const x = 1;`;

    // napi-rs converts snake_case to camelCase
    const result = oxcEngine.transform(source, "test.ts", { sourceMap: true });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.map).toBeDefined();
    expect(result.map).not.toBeNull();

    // Verify it's valid JSON
    const map = JSON.parse(result.map!);
    expect(map).toHaveProperty("version", 3);
    expect(map).toHaveProperty("sources");
    expect(map).toHaveProperty("mappings");
  });

  test("omits source map when disabled", () => {
    const source = `const x = 1;`;

    // napi-rs converts snake_case to camelCase
    const result = oxcEngine.transform(source, "test.ts", { sourceMap: false });

    expect(result.diagnostics).toHaveLength(0);
    // When sourceMap is false, map is not generated (undefined)
    expect(result.map).toBeUndefined();
  });
});

describe("transformWithMacros - JS callback protocol", () => {
  // Protocol types
  interface MacroCallInfo {
    macroName: string;
    callSiteArgs: string[];
    jsDocTag?: string;
    filename: string;
    line: number;
    column: number;
  }

  interface MacroExpansion {
    code: string;
    kind: "expression" | "statements" | "declaration";
    diagnostics: { severity: string; message: string; line?: number; column?: number }[];
  }

  test("calls JS callback for @typeclass annotation", () => {
    const source = `/** @typeclass */
interface Show<A> {
  show(a: A): string;
}`;

    let callbackCalled = false;
    let receivedCallInfo: MacroCallInfo | null = null;

    const callback = (json: string): string => {
      callbackCalled = true;
      receivedCallInfo = JSON.parse(json);

      const expansion: MacroExpansion = {
        code: `// Expanded Show typeclass
interface Show<A> { show(a: A): string; }
const ShowImpl = {};`,
        kind: "declaration",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    expect(callbackCalled).toBe(true);
    expect(receivedCallInfo).not.toBeNull();
    expect(receivedCallInfo!.macroName).toBe("typeclass");
    expect(receivedCallInfo!.filename).toBe("test.ts");
    expect(result.changed).toBe(true);
    expect(result.code).toContain("ShowImpl");
  });

  test("calls JS callback for @impl annotation", () => {
    const source = `/** @impl Show<number> */
const showNumber = { show: (n: number) => String(n) };`;

    let receivedCallInfo: MacroCallInfo | null = null;

    const callback = (json: string): string => {
      receivedCallInfo = JSON.parse(json);

      const expansion: MacroExpansion = {
        code: `const showNumber = { show: (n: number) => String(n) };
// Registered as Show<number> implementation`,
        kind: "declaration",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    expect(receivedCallInfo).not.toBeNull();
    expect(receivedCallInfo!.macroName).toBe("impl");
    expect(receivedCallInfo!.jsDocTag).toBe("Show<number>");
    expect(result.changed).toBe(true);
  });

  test("forwards diagnostics from macro expansion", () => {
    const source = `/** @typeclass */
interface InvalidTypeclass {}`;

    const callback = (json: string): string => {
      const expansion: MacroExpansion = {
        code: `interface InvalidTypeclass {}`,
        kind: "declaration",
        diagnostics: [
          {
            severity: "warning",
            message: "Typeclass should have at least one method",
            line: 2,
            column: 0,
          },
        ],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.message.includes("at least one method"))).toBe(true);
  });

  test("handles multiple macro annotations", () => {
    const source = `/** @typeclass */
interface Eq<A> { equals(a: A, b: A): boolean; }

/** @impl Eq<number> */
const eqNumber = { equals: (a: number, b: number) => a === b };`;

    const callbackCalls: MacroCallInfo[] = [];

    const callback = (json: string): string => {
      const callInfo: MacroCallInfo = JSON.parse(json);
      callbackCalls.push(callInfo);

      const expansion: MacroExpansion = {
        code: `// Processed ${callInfo.macroName}`,
        kind: "declaration",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    expect(callbackCalls.length).toBe(2);
    expect(callbackCalls[0].macroName).toBe("typeclass");
    expect(callbackCalls[1].macroName).toBe("impl");
    expect(result.changed).toBe(true);
  });

  test("syntax macros still work alongside JS callback macros", () => {
    const source = `/** @cfg debug */
const debugOnly = true;

/** @typeclass */
interface Show<A> { show(a: A): string; }

staticAssert(true, "should pass");`;

    let typeclassCallbackCalled = false;

    const callback = (json: string): string => {
      typeclassCallbackCalled = true;
      const callInfo: MacroCallInfo = JSON.parse(json);

      const expansion: MacroExpansion = {
        code: `interface Show<A> { show(a: A): string; }`,
        kind: "declaration",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(
      source,
      "test.ts",
      { cfgConfig: { debug: false } },
      callback
    );

    // cfg macro should remove debugOnly
    expect(result.code).not.toContain("debugOnly");
    // JS callback should be called for typeclass
    expect(typeclassCallbackCalled).toBe(true);
    // staticAssert should be removed (passes)
    expect(result.code).not.toContain("staticAssert");
    expect(result.changed).toBe(true);
  });

  test("calls JS callback for __binop__ expression macro", () => {
    const source = `const result = __binop__(x, "|>", double);`;

    let receivedCallInfo: MacroCallInfo | null = null;

    const callback = (json: string): string => {
      receivedCallInfo = JSON.parse(json);

      // __binop__ with |> (pipeline) should become double(x)
      const expansion: MacroExpansion = {
        code: "double(x)",
        kind: "expression",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    expect(receivedCallInfo).not.toBeNull();
    expect(receivedCallInfo!.macroName).toBe("__binop__");
    expect(receivedCallInfo!.callSiteArgs).toHaveLength(3);
    expect(receivedCallInfo!.callSiteArgs[0]).toBe("x");
    expect(receivedCallInfo!.callSiteArgs[1]).toBe('"|>"');
    expect(receivedCallInfo!.callSiteArgs[2]).toBe("double");
    expect(result.changed).toBe(true);
    expect(result.code).toContain("double(x)");
    expect(result.code).not.toContain("__binop__");
  });

  test("handles nested __binop__ calls (inner first)", () => {
    // Nested __binop__ calls - inner is expanded first (leaf-first for correct expansion)
    const source = `const result = __binop__(__binop__(x, "|>", double), "|>", square);`;

    const callbacks: MacroCallInfo[] = [];

    const callback = (json: string): string => {
      const callInfo: MacroCallInfo = JSON.parse(json);
      callbacks.push(callInfo);

      // Expand: __binop__(a, "|>", f) -> f(a)
      const expansion: MacroExpansion = {
        code: callInfo.callSiteArgs[2] + "(" + callInfo.callSiteArgs[0] + ")",
        kind: "expression",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    // Both __binop__ calls should be detected, inner first (leaf-first expansion)
    expect(callbacks.length).toBe(2);
    // Inner is expanded first (it has no nested macros in its args)
    expect(callbacks[0].callSiteArgs[2]).toBe("double");
    // Outer is expanded second (after inner is resolved)
    expect(callbacks[1].callSiteArgs[2]).toBe("square");
    expect(result.changed).toBe(true);
    // Final result should be correctly expanded
    expect(result.code).toContain("square(double(x))");
  });

  test("handles :: cons operator", () => {
    const source = `const list = __binop__(head, "::", tail);`;

    const callback = (json: string): string => {
      const callInfo: MacroCallInfo = JSON.parse(json);

      // :: (cons) should become [head, ...tail]
      const expansion: MacroExpansion = {
        code: `[${callInfo.callSiteArgs[0]}, ...${callInfo.callSiteArgs[2]}]`,
        kind: "expression",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const result = oxcEngine.transformWithMacros(source, "test.ts", {}, callback);

    expect(result.changed).toBe(true);
    expect(result.code).toContain("[head, ...tail]");
    expect(result.code).not.toContain("__binop__");
  });

  test("measures callback overhead (target: <0.5ms per call)", () => {
    const source = `/** @typeclass */
interface T1<A> { m(a: A): A; }
/** @typeclass */
interface T2<A> { m(a: A): A; }
/** @typeclass */
interface T3<A> { m(a: A): A; }
/** @typeclass */
interface T4<A> { m(a: A): A; }
/** @typeclass */
interface T5<A> { m(a: A): A; }`;

    let callCount = 0;
    const callback = (json: string): string => {
      callCount++;
      const expansion: MacroExpansion = {
        code: `// expanded`,
        kind: "declaration",
        diagnostics: [],
      };
      return JSON.stringify(expansion);
    };

    const start = performance.now();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      oxcEngine.transformWithMacros(source, "test.ts", {}, callback);
    }

    const elapsed = performance.now() - start;
    const totalCalls = callCount; // Should be 5 * iterations = 500
    const msPerCall = elapsed / totalCalls;

    console.log(
      `Callback overhead: ${msPerCall.toFixed(3)}ms per call (${totalCalls} calls in ${elapsed.toFixed(1)}ms)`
    );

    // Target: <0.5ms per callback
    expect(msPerCall).toBeLessThan(0.5);
  });
});
