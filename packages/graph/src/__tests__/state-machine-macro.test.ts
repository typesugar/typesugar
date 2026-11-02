/**
 * End-to-end tests for the `stateMachine` tagged-template macro: run the real
 * transformer over a source file, then execute the emitted code.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../macros.js";
import * as graphRuntime from "../index.js";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../../__sm_macro_input.ts");

function expand(src: string): { code: string; diagnostics: string[] } {
  const r = transformCode(src, { fileName: FILE });
  return {
    code: r.code,
    diagnostics: (r.diagnostics ?? []).map((d: any) => String(d.message ?? d.messageText)),
  };
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/graph") return graphRuntime;
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

describe("stateMachine macro (FMG-1)", () => {
  it("emitted create() works at runtime", () => {
    const { code } = expand(`import { stateMachine } from "@typesugar/graph";
const sm = stateMachine\`
  @initial Idle
  @terminal Done
  Idle --start--> Running
  Running --stop--> Done
\`;
export const inst = sm.create();
export const next = inst.transition("start");
`);
    expect(code).not.toContain("stateMachine`");
    const out = run(code);
    expect(out.inst.current).toBe("Idle");
    expect(out.next.current).toBe("Running");
  });
});

describe("stateMachine macro (FMG-5): interpolated identifiers", () => {
  it("uses the identifier's VALUE, not its name", () => {
    const { code } = expand(`import { stateMachine } from "@typesugar/graph";
const IDLE = "Idle";
const sm = stateMachine\`
  @initial \${IDLE}
  @terminal Done
  \${IDLE} --start--> Done
\`;
export const initial = sm.initial;
export const states = sm.states;
export const cur = sm.create().current;
`);
    expect(code).not.toContain('"IDLE"');
    const out = run(code);
    expect(out.initial).toBe("Idle");
    expect(out.states).toEqual(["Idle", "Done"]);
    expect(out.cur).toBe("Idle");
  });

  it("still inlines string-literal interpolations at compile time", () => {
    const { code } = expand(`import { stateMachine } from "@typesugar/graph";
const sm = stateMachine\`
  @initial \${"Idle"}
  @terminal Done
  Idle --start--> Done
\`;
export const verified = sm.__verified;
export const cur = sm.create().current;
`);
    const out = run(code);
    expect(out.verified).toBe(true);
    expect(out.cur).toBe("Idle");
  });
});

describe("stateMachine macro (FMG-15): dense machines", () => {
  it("expands a fully connected 12-state machine without enumerating its cycles", () => {
    const states = Array.from({ length: 12 }, (_, i) => "S" + i);
    const lines = states.flatMap((a) =>
      states.filter((b) => b !== a).map((b) => `  ${a} --to${b}--> ${b}`)
    );
    const t0 = Date.now();
    const { code } = expand(`import { stateMachine } from "@typesugar/graph";
const sm = stateMachine\`
  @initial S0
${lines.join("\n")}
\`;
export const n = sm.__stateCount;
`);
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(run(code).n).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Docs review r3 (guides-b #6): states and events were typed `string`, so
// `m.create().transition("nope")` type-checked and threw at runtime.
// ---------------------------------------------------------------------------

const SM_DSL = `
  @initial Idle
  @terminal Done
  Idle --start--> Running
  Running --stop--> Done
`;

function strictDiags(src: string): string[] {
  const r = transformCode(src, { fileName: FILE, strictOutput: true });
  return (r.diagnostics ?? []).map((d: any) => String(d.message ?? d.messageText));
}

/** Type-check SOURCE (not output) against the package's own src. */
function typecheckSource(code: string): string[] {
  const file = path.resolve(__dirname, "__sm_typecheck_input.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === file ? ts.createSourceFile(f, code, lang, true) : origGet(f, lang, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === file || origExists(f);
  const program = ts.createProgram([file], options, host);
  const sf = program.getSourceFile(file)!;
  return program
    .getSemanticDiagnostics(sf)
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

describe("stateMachine macro: literal state/event types (r3)", () => {
  it("the emitted instance is typed with the DSL's literal unions", () => {
    const ok = strictDiags(`import { stateMachine } from "@typesugar/graph";
const m = stateMachine\`${SM_DSL}\`;
const s: "Idle" | "Running" | "Done" = m.create().transition("start").current;
export { s };
`);
    expect(ok.filter((d) => d.includes("strictOutput"))).toEqual([]);
    const bad = strictDiags(`import { stateMachine } from "@typesugar/graph";
const m = stateMachine\`${SM_DSL}\`;
export const x = m.create().transition("nope");
`);
    expect(bad.join("\n")).toMatch(/strictOutput.*"nope".*not assignable/);
  });

  it("explicit tag type arguments make the SOURCE type-check precisely", () => {
    const diags = typecheckSource(`import { stateMachine } from "../index.js";
const m = stateMachine<"Idle" | "Running" | "Done", "start" | "stop">\`${SM_DSL}\`;
const ok = m.create().transition("start");
// @ts-expect-error -- not an event of this machine
m.create().transition("nope");
const cur: "Idle" | "Running" | "Done" = ok.current;
void cur;
`);
    expect(diags).toEqual([]);
  });

  it("explicit type arguments that disagree with the DSL are a macro error", () => {
    const { diagnostics } = expand(`import { stateMachine } from "@typesugar/graph";
export const m = stateMachine<"Idle" | "Running", "start" | "stop" | "pause">\`${SM_DSL}\`;
`);
    const all = diagnostics.join("\n");
    expect(all).toMatch(/states.*missing.*Done/);
    expect(all).toMatch(/events.*not in the definition.*pause/);
  });

  it("matching explicit type arguments expand and run", () => {
    const { code, diagnostics } = expand(`import { stateMachine } from "@typesugar/graph";
const m = stateMachine<"Idle" | "Running" | "Done", "start" | "stop">\`${SM_DSL}\`;
export const cur = m.create().transition("start").current;
`);
    expect(diagnostics).toEqual([]);
    expect(run(code).cur).toBe("Running");
  });
});
