import { describe, it, expect, afterEach } from "vitest";
import { LanguageServiceHarness, createSimpleHarness } from "./harness";

describe("LanguageServiceHarness", () => {
  let harness: LanguageServiceHarness | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

  describe("basic language service (no plugin)", () => {
    it("creates a working language service", () => {
      harness = createSimpleHarness("const x: number = 42;");
      const service = harness.getService();
      expect(service).toBeDefined();
    });

    it("reports no errors for valid TypeScript", () => {
      harness = createSimpleHarness("const x: number = 42;\nexport { x };");
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });

    it("reports errors for invalid TypeScript", () => {
      harness = createSimpleHarness('const x: number = "not a number";');
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("reports syntactic errors", () => {
      harness = createSimpleHarness("const x: = ;");
      const diagnostics = harness.getSyntacticDiagnostics("test.ts");
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("provides completions", () => {
      harness = createSimpleHarness("const x = { foo: 1, bar: 2 };\nx.");
      const completions = harness.getCompletions(
        "test.ts",
        "const x = { foo: 1, bar: 2 };\nx.".length
      );
      expect(completions).toBeDefined();
      expect(completions!.entries.length).toBeGreaterThan(0);

      const fooEntry = completions!.entries.find((e) => e.name === "foo");
      expect(fooEntry).toBeDefined();
    });

    it("provides quick info", () => {
      const code = "const greeting: string = 'hello';";
      harness = createSimpleHarness(code);
      const info = harness.getQuickInfo("test.ts", code.indexOf("greeting"));
      expect(info).toBeDefined();
    });
  });

  describe("file management", () => {
    it("supports multiple files", () => {
      harness = new LanguageServiceHarness({
        files: [
          { name: "a.ts", content: "export const x = 1;" },
          { name: "b.ts", content: 'import { x } from "./a";\nconst y = x + 1;' },
        ],
      });

      const diagnosticsA = harness.getSemanticDiagnostics("a.ts");
      expect(diagnosticsA.length).toBe(0);
    });

    it("supports updating files", () => {
      harness = createSimpleHarness("const x: number = 42;");

      // Valid code — no errors
      let diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);

      // Update to invalid code
      harness.updateFile("test.ts", 'const x: number = "string";');
      diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("handles empty files", () => {
      harness = createSimpleHarness("");
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });
  });

  describe("plugin loading", () => {
    it("loadPlugin returns boolean (true or false)", async () => {
      harness = createSimpleHarness("const x = 1;");
      const result = await harness.loadPlugin();
      // Plugin may or may not load depending on build state
      expect(typeof result).toBe("boolean");
    });

    it("service still works after failed plugin load", async () => {
      harness = createSimpleHarness("const x: number = 42;");
      await harness.loadPlugin();

      // Whether plugin loaded or not, service should work
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });

    it("completions work after plugin load attempt", async () => {
      harness = createSimpleHarness("const x = { a: 1, b: 2 };\nx.");
      await harness.loadPlugin();

      const completions = harness.getCompletions("test.ts", "const x = { a: 1, b: 2 };\nx.".length);
      expect(completions).toBeDefined();
      expect(completions!.entries.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles files with Unicode content", () => {
      harness = createSimpleHarness('const emoji = "🎉";\nconst japanese = "日本語";');
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });

    it("handles files with BOM", () => {
      harness = createSimpleHarness("\uFEFFconst x = 1;");
      const diagnostics = harness.getSyntacticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });

    it("handles very long files", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `const v${i} = ${i};`);
      harness = createSimpleHarness(lines.join("\n"));
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });

    it("handles files with complex types", () => {
      const code = `
        type DeepPartial<T> = T extends object
          ? { [P in keyof T]?: DeepPartial<T[P]> }
          : T;
        
        interface Config {
          db: { host: string; port: number };
          cache: { ttl: number };
        }
        
        const partial: DeepPartial<Config> = { db: { host: "localhost" } };
      `;
      harness = createSimpleHarness(code);
      const diagnostics = harness.getSemanticDiagnostics("test.ts");
      expect(diagnostics.length).toBe(0);
    });

    it("disposes cleanly", () => {
      harness = createSimpleHarness("const x = 1;");
      expect(() => harness!.dispose()).not.toThrow();
      harness = undefined;
    });
  });
});
