/**
 * Server-side code execution endpoint — DISABLED on the public playground.
 *
 * This endpoint used to transpile the posted code and run it in-process under
 * `node:vm` with a module blocklist. `node:vm` is not a security boundary
 * (any host-realm constructor in the context — `Error.constructor("return
 * process")()` — escapes it) and a blocklist is always incomplete
 * (`node:child_process`, `fs/promises`, `v8` all passed), so it was remote
 * code execution plus an environment/secret leak on a public URL.
 *
 * Executing untrusted code safely needs real isolation (a disposable microVM
 * such as Vercel Sandbox, or isolated-vm with no host objects), which this
 * function does not have. Until that exists, the endpoint never executes
 * anything and tells the caller so. The playground's in-browser runner is
 * unaffected.
 *
 * POST /api/run
 * { code: string }
 *
 * Response (always): 403 { output: [], error: string }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export const RUN_DISABLED_MESSAGE =
  "Server-side execution is not available on the public playground. " +
  "Run it locally instead: npx typesugar run <file>.";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(403).json({ output: [], error: RUN_DISABLED_MESSAGE });
}
