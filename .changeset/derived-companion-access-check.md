---
"@typesugar/macros": patch
---

`typesugar check` and `typesugar build` accept a direct call to a derived companion
(`Point.Eq.equals(a, b)`, `Point.Debug.debug(p)`), the form the derive guide documents. They report
the diagnostics of the program before expansion, where the companion doesn't exist yet, and failed
with TS2339 ("Property 'Eq' does not exist on type 'typeof Point'") for a class and TS2693
("'Point' only refers to a type") for an interface or type alias. A new diagnostic suppression rule,
`DerivedCompanionAccess`, suppresses these when the receiver's declaration derives the accessed
typeclass; `Point.Ord` on a type that derives only `Eq` is still an error.
