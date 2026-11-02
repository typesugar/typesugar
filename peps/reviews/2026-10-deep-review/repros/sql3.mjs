const m = await import(process.cwd() + "/dist/index.js");
const { sql, ConnectionIO, Transactor, TypedFragment, Read } = m;
// What sql$ emits:
const tf = new TypedFragment(["SELECT * FROM users WHERE id = ", ""], [{ value: 5 }]);
console.log("sql$-shaped toSql", tf.toQuery().toSql(), "query", tf.query);
// README quickstart
try {
  const conn = { async query(){return [{id:1}]}, async execute(){return 0}, async begin(){}, async commit(){}, async rollback(){} };
  const xa = new Transactor(conn);
  const cio = ConnectionIO.query(sql`SELECT * FROM users WHERE id = ${1}`.toQuery());
  console.log("README raw cio", await Transactor.fromConnection(conn).run(cio).catch(e=>"ERR "+e.message));
  console.log("README new Transactor(conn).run", await xa.run(ConnectionIO.pure(1)).catch(e=>"ERR "+e.message));
} catch (e) { console.log("threw", e.message); }
