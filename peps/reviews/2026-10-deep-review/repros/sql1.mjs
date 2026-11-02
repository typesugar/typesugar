const m = await import(process.cwd() + "/dist/index.js");
const { Fragment, sql, TypedFragment, inListTyped, whereAndTyped, setTyped, emptyTyped } = m;
const inl = inListTyped("id", [1,2,3]);
console.log("inListTyped.query", inl.query);
console.log("inListTyped.toSql", inl.toQuery().toSql());
const eq = new TypedFragment(["name = ", ""], ["bob"]);
console.log("whereAnd(inl, eq).query", whereAndTyped(inl, eq).query);
console.log("whereAnd(inl, eq).toSql", whereAndTyped(inl, eq).toQuery().toSql());
// nested fragment regex renumber
const inner = sql`price > ${5} AND note = '$1 off'`;
const outer = sql`SELECT * WHERE a = ${1} AND ${inner}`;
console.log("outer", outer.query);
// whereAnd drops param-only fragments
const p = sql`${Fragment.raw("x = 1")}`;
console.log("whereAnd raw", Fragment.whereAnd([Fragment.param(true)]).query);
// Fragment as param via constructor
const nf = new Fragment(["a = ", " AND ", ""], [1, sql`b = ${2}`]);
console.log("nested ctor", nf.query);
// inList column injection
console.log(Fragment.set({"name = 'x' --": 1}).query);
// sql`` with empty segments
console.log(sql`${"a"}${"b"}`.query);
