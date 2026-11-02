import "@typesugar/std/syntax/do";
declare function ag(): AsyncIterable<number>;
declare function it(): Iterable<number>;
let: { x << ag(); y << ag() } yield: { x + y }
let: { x << it(); y << it() } yield: { x + y }
