import "@typesugar/std/syntax/do";
declare function log(s: string): Promise<void>;
declare const req: { user: number };
let: { x << [1, 2, 3]; if (x > 1) {} } yield: { x * 10 }
let: { x << [1, 2]; y << [x, x * 10] }
let: { a << [1, 2]; par: { b << [10, 20]; c << [100] } } yield: { a + b + c }
par: { _ << log("a"); _ << log("b") } yield: { 1 }
par: { user << Promise.resolve(1); posts << Promise.resolve(req.user) } yield: { user }
let: { x << Promise.resolve(1); y << Promise.reject(2) || _.fallback } yield: { y }
