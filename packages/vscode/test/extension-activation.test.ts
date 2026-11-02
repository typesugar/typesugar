/**
 * activate() behaviour of the thin LSP client (deep-review tooling #6, #26).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

const created: Array<{ serverOptions: any }> = [];

vi.mock("vscode-languageclient/node.js", () => ({
  TransportKind: { stdio: 0, ipc: 1, pipe: 2, socket: 3 },
  LanguageClient: class {
    constructor(_id: string, _name: string, serverOptions: any, _clientOptions: any) {
      created.push({ serverOptions });
    }
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
  },
}));

vi.mock("fs", async (orig) => {
  const real = (await orig()) as typeof import("fs");
  return { ...real, existsSync: (p: string) => String(p).endsWith("server-bundled.cjs") };
});

function makeContext(): any {
  return { subscriptions: [] as unknown[] };
}

describe("extension activate()", () => {
  let updates: unknown[][];

  beforeEach(() => {
    created.length = 0;
    updates = [];
    vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(
      () =>
        ({
          get: () => undefined,
          has: () => false,
          inspect: () => undefined,
          update: (...args: unknown[]) => {
            updates.push(args);
            return Promise.resolve();
          },
        }) as any
    );
  });

  // #6: the extension wrote `typescript.validate.enable: false` into the user's
  // workspace settings on every activation and never restored it.
  it("does not modify the user's TypeScript settings", async () => {
    const { activate } = await import("../src/extension.js");
    await activate(makeContext());
    expect(updates).toEqual([]);
  });

  // #26: the server was spawned as `node` from PATH (whatever version, or
  // none); it must run under VS Code's own Node via the module form.
  it("launches the server as a module under VS Code's Node, not `node` from PATH", async () => {
    const { activate } = await import("../src/extension.js");
    await activate(makeContext());
    expect(created.length).toBe(1);
    const { run, debug } = created[0].serverOptions;
    for (const opts of [run, debug]) {
      expect(opts.command).toBeUndefined();
      expect(String(opts.module)).toMatch(/server-bundled\.cjs$/);
    }
  });
});
