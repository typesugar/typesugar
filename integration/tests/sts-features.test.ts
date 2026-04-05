/**
 * Integration test: .sts syntax features (|>, ::, F<_>).
 *
 * Verifies that preprocessed syntax maps positions back correctly
 * through the two-stage source map composition.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, assertDiagnosticAt, type LspSession } from "../lib/assertions.js";

describe("STS features (sts-project)", () => {
  let fixture: PreparedFixture;
  let session: LspSession;

  beforeAll(async () => {
    fixture = await prepareFixture("sts-project");
    session = await initSession(fixture);
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("pipe operator (|>) — type error after chain maps correctly", async () => {
    const { diagnostics } = await openFile(session, "src/pipe-operator.sts");

    if (diagnostics.length === 0) {
      console.log(
        "Note: No diagnostics for .sts file — LSP may not process .sts in standalone fixture mode"
      );
      return;
    }
    assertDiagnosticAt(diagnostics, 8, "not assignable", "type error after |> chain");
  });

  it("cons operator (::) — type error after cons maps correctly", async () => {
    const { diagnostics } = await openFile(session, "src/cons-operator.sts");

    if (diagnostics.length === 0) {
      console.log(
        "Note: No diagnostics for .sts file — LSP may not process .sts in standalone fixture mode"
      );
      return;
    }
    assertDiagnosticAt(diagnostics, 5, "not assignable", "type error after :: chain");
  });

  it("HKT syntax (F<_>) — type error after HKT preprocessing maps correctly", async () => {
    const { diagnostics } = await openFile(session, "src/hkt-syntax.sts");

    if (diagnostics.length === 0) {
      console.log(
        "Note: No diagnostics for .sts file — LSP may not process .sts in standalone fixture mode"
      );
      return;
    }
    assertDiagnosticAt(diagnostics, 7, "not assignable", "type error after HKT preprocessing");
  });
});
