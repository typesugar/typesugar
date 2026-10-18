import "@typesugar/std/syntax/do";
function g1() {
    const r = [1, 2, 3];
}
yield: {
    x * 10;
}
;
return r;
function g2() {
    const r = [1, 2].map(x => [x, x * 10]);
}
;
return r;
function g3() {
    const r = [1, 2];
    par: {
        b << [10, 20];
        c << [100];
    }
}
yield: {
    a + b + c;
}
;
return r;
async function g4() {
    const r = par, { _ };
        << log("a");
    _ << log("b");
}
yield: {
    1;
}
;
return r;
async function g5() {
    const r = par, { user };
        << Promise.resolve(1);
    posts << Promise.resolve(req.user);
}
yield: {
    user;
}
;
return r;
