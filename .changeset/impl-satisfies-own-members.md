---
"@typesugar/macros": patch
---

`@impl` on an unannotated HKT instance keeps the instance's own type. It used to annotate the
const with the typeclass's expanded type, which dropped every member the typeclass doesn't declare
(`_tag`, `orElse` on `@typesugar/fp`'s `flatMapOption`) from its type and from the `.d.ts` emitted
from the expansion, and made `typesugar check --strict` report them as excess properties. The
initializer now `satisfies` the expanded type, with its members optional and an index signature:
unannotated method parameters are still typed from the typeclass, and the members the instance has
are still checked. An instance for a type-level function with its own parameter (`@impl
FlatMap<EitherF>`, where `EitherF<E>` fixes `E`) or for a type with more than one unfixed parameter
gets no expanded type, instead of a wrong one (`EitherF<A>`, `Either<A>`).
