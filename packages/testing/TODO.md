# TODO

## Deferred

### Arbitrary Generation

- [ ] Field-level range configuration — `@arb.range(0, 100)` or refined types `x: Range<0, 100>` for domain-appropriate test values
- [ ] Refined type integration — auto-generate valid values for `Positive`, `Port`, `Email`, etc. (Iron + ScalaCheck pattern)
- [ ] Shrinking support — when tests fail, shrink to minimal failing case
- [ ] Generator combinators — `Arbitrary.oneOf()`, `Arbitrary.frequency()`, `Arbitrary.suchThat()`
