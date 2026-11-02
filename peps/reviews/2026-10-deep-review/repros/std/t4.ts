import "@typesugar/std/syntax/do";
declare function log(s: string): Promise<void>;
declare const req: { user: string };
function g1() {
  const r = let: { x << [1, 2, 3]; if (x > 1) {} } yield: { x * 10 };
  return r;
}
function g2() {
  const r = let: { x << [1, 2]; y << [x, x * 10] };
  return r;
}
function g3() {
  const r = let: { a << [1, 2]; par: { b << [10, 20]; c << [100] } } yield: { a + b + c };
  return r;
}
async function g4() {
  const r = par: { _ << log("a"); _ << log("b") } yield: { 1 };
  return r;
}
async function g5() {
  const r = par: { user << Promise.resolve(1); posts << Promise.resolve(req.user) } yield: { user };
  return r;
}
