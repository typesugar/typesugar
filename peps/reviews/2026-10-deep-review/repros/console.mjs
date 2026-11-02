const base = process.argv[2];
const { Console } = await import(base + "/dist/io/console.js");
const { IO, runIO } = await import(base + "/dist/io/io.js");
const inputs = ["abc", "maybe"];
Console.prompt = () => IO.delay(() => inputs.shift());
console.log("readRequiredNumber('abc') ->", await runIO(Console.readRequiredNumber("n? ")));
console.log("confirm('maybe') ->", await runIO(Console.confirm("ok?")));
// ESM readLine
const { Console: C2 } = await import(base + "/dist/io/console.js?x=1");
try { console.log(await runIO(C2.readLine())); } catch (e) { console.log("ESM readLine rejected:", e.message); }
