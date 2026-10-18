const { IO, runIO, runIOSync } = require(process.argv[2] + "/dist/io/io.cjs");
const t0 = Date.now();
process.on("exit", () => console.log("process exit after ms", Date.now() - t0));
(async () => {
  const v = await runIO(IO.timeout(IO.pure(1), 3000));
  console.log("timeout result", v, "at ms", Date.now() - t0);
  // per-step overhead
  let t = Date.now();
  const n = 200;
  await runIO(IO.traverse(Array.from({length:n},(_, i)=>i), (i) => IO.fromPromise(() => Promise.resolve(i))));
  console.log(n, "fromPromise steps ms", Date.now() - t);
  t = Date.now();
  await runIO(IO.traverse(Array.from({length:n},(_, i)=>i), (i) => IO.attempt(IO.pure(i))));
  console.log(n, "attempt steps ms", Date.now() - t);
  // deep nested guarantee
  const loop = (k) => k === 0 ? IO.unit : IO.guarantee(IO.flatMap(IO.unit, () => loop(k - 1)), IO.unit);
  try { runIOSync(loop(20000)); console.log("sync nested guarantee 20k ok"); } catch (e) { console.log("sync nested guarantee threw", e.constructor.name); }
  try { await runIO(loop(20000)); console.log("async nested guarantee 20k ok"); } catch (e) { console.log("async nested guarantee rejected", e.constructor.name, e.message); }
  // traverse 20000 quadratic
  t = Date.now();
  runIOSync(IO.traverse(Array.from({length:20000},(_, i)=>i), (i) => IO.pure(i)));
  console.log("traverse 20k sync ms", Date.now() - t);
})();
