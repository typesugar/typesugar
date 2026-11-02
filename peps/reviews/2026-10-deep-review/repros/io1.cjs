const { IO, runIO, runIOSync } = require(process.argv[2] + "/dist/io/io.cjs");
(async () => {
  // A: continuation after attempt throws -> should fail IO
  let log = [];
  const a = IO.flatMap(IO.flatMap(IO.attempt(IO.pure(1)), (r) => { throw new Error("boom"); }),
     (y) => IO.delay(() => { log.push(["second-ran", y]); return "ok"; }));
  try { const v = await runIO(a); console.log("A async resolved:", v, JSON.stringify(log)); } catch (e) { console.log("A async rejected:", e.message); }
  log = [];
  try { const v = runIOSync(a); console.log("A sync returned:", v, JSON.stringify(log)); } catch (e) { console.log("A sync threw:", e.message); }

  // B: handler throws in async HandleError
  let calls = 0;
  const b = IO.handleError(IO.raiseError(new Error("orig")), (e) => { calls++; if (calls > 3) return IO.pure("stop"); throw new Error("handler-" + e.message); });
  try { const v = await runIO(b); console.log("B async resolved:", v, "handler calls", calls); } catch (e) { console.log("B async rejected:", e.message, "handler calls", calls); }

  // C: continuation after handleError throws; handler must NOT be called (sync)
  let hcalls = 0;
  const c = IO.flatMap(IO.handleError(IO.pure(1), (e) => { hcalls++; return IO.pure(99); }), (x) => { if (x === 1) throw new Error("cont"); return IO.pure(x); });
  try { const v = runIOSync(c); console.log("C sync returned:", v, "handler calls", hcalls); } catch (e) { console.log("C sync threw:", e.message, "handler calls", hcalls); }
  hcalls = 0;
  try { const v = await runIO(c); console.log("C async resolved:", v, "handler calls", hcalls); } catch (e) { console.log("C async rejected:", e.message, "handler calls", hcalls); }
})();
