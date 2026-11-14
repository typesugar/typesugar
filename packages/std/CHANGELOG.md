# @typesugar/std

## 0.2.0

### Minor Changes

- e92220f: 1.0 public-API pruning (audit/ARCH-REVIEW-2026-11-TRIAGE.md, PR 3). Removes exports that
  nothing in the compiler used, that were deprecated, or that duplicated a newer API.

  **`@typesugar/core`**
  - Macro capabilities (`capabilities.ts`, never enforced): `createRestrictedContext`,
    `resolveCapabilities`, `DEFAULT_CAPABILITIES`, `MacroCapabilities`.
  - Prelude table (`prelude.ts`, never consulted): `DEFAULT_PRELUDE`, `getPreludeTypeclasses`,
    `getPreludeEntry`, `isPreludeMethod`, `isPreludeOperator`, `generatePreludeDeclaration`,
    `METHOD_TO_TYPECLASS`, `OPERATOR_TO_TYPECLASS`, `PreludeEntry`. The `resolution.prelude`
    config option is unchanged.
  - Manifest discovery (never called): `discoverManifests`, `createManifestRegistry`,
    `mergeManifestIntoRegistry`, `getManifestRegistry`, `resetManifestRegistry`,
    `DiscoveredManifest`, `ManifestDiscoveryOptions`, `ManifestRegistry`. The manifest schema types,
    `loadManifest` and `validateManifest` stay.
  - Diagnostics: `legacyToRichDiagnostic`, `printDiagnostic`, `printDiagnostics`,
    `renderDiagnosticsCLI`, and the `writer` option of `CLIRenderOptions` (only the printers read
    it). `renderDiagnosticCLI` stays.
  - `createInstanceLocation`, `InMemoryExpansionCache`.

  **`@typesugar/macros`**
  - The `impl("TC<T>", {...})`, `typeclass("Name")` and `instance("TC<T>", {...})` expression
    macros (`implMacro`, `typeclassMacro`), left over from the removed preprocessor. Use
    `/** @impl TC<T> */` and `/** @typeclass */` (JSDoc) or the decorator forms; they are the only
    forms. The instance scanner no longer recognises a `const x = impl("TC<T>", …)` initializer.
  - The runtime stubs `typeclass(name)` and `impl(desc, obj)` lose their expression overloads;
    `typeclass`, `impl` and the deprecated `instance` remain as decorators.
  - `generateStandardTypeclasses`, `getAllTypeclassDefs`, and the `SemigroupPrimitives` /
    `MonoidPrimitives` aliases (use `Semigroup` / `Monoid`).

  **`@typesugar/typeclass`**: `implMacro` and `generateStandardTypeclasses` re-exports.

  **`typesugar`**: the expression overloads of the `typeclass`, `impl` and `instance` stubs, as
  above.

  **`@typesugar/transformer-core`**
  - `isExtensionEnabled` and `fallbackNameLookup` (internal, unused).
  - `JSDOC_MACRO_TAGS` is now a `ReadonlySet<string>` of tag names instead of an identity map,
    without the dead `operators`/`operator` entries (no macro has either name; an `@operators` JSDoc
    tag is now left alone instead of being reported as an unknown macro tag).

  **`@typesugar/std`**
  - Range: the deprecated function API (`range`, `rangeInclusive`, `rangeBy`, `rangeReversed`,
    `rangeIterator`, `rangeToArray`, `rangeForEach`, `rangeMap`, `rangeFilter`, `rangeReduce`,
    `rangeContains`, `rangeSize`, `rangeFirst`, `rangeLast`, `rangeIsEmpty`) and the `RangeExt` and
    `RangeExtensions` objects. Use the extension methods: `(1).to(10).step(2).toArray()`. The
    `Range` type, `eqRange` and `ordRange` stay.
  - Legacy typeclasses that duplicated newer ones or had no instances: `Parseable` (and
    `ParseResult`), `Printable`, `Coercible`, `Defaultable`, `Copyable`, `Sized`, `Identifiable`,
    `Reducible`, `Zippable`, `Splittable`, `Searchable`, with all their instances
    (`parseableNumber`, `printableNumber`, `numberToString`, `defaultNumber`, `copyableArray`,
    `sizedString`, …). Use `Clone`, `Debug`, `Json`, or fp's `Show`.
  - `registerParCombine` (deprecated) and its generic fallback builder, which emitted an
    unimportable `getParCombine("X")` call. Declare an `@impl ParCombine<F>` instance instead.

  **`@typesugar/fp`**: the third Option/Result implementation (`ZeroCost`, `ZeroCostOptionOps`,
  `ZeroCostResultOps`, `ZeroCostOption`, `ZeroCostResult`, `ZeroCostOk`, `ZeroCostErr`, the
  `@typesugar/fp/zero-cost` subpath) and the `zeroCostOptionMacro`/`zeroCostResultMacro` macros
  that only inlined calls to it. fp's `Option` (`A | null`) is the zero-cost Option.

- f086b8b: Decorators and JSDoc tags go through one attribute-macro dispatcher
  (`expandAttributeSources`, transformer-core `attribute-dispatch.ts`), so a JSDoc tag now behaves
  exactly like the decorator it stands for:
  - tags expand in `expandAfter` order, not written order;
  - each expansion runs in its own hygiene scope and shows in the expansion view;
  - `@derive` reads the declaration as written, even after an earlier tag rewrote it;
  - a `// @ts-no-typesugar <feature>` comment on the declaration's line covers its tags;
  - a failing macro is reported as `@name macro expansion failed: …` at the tag and leaves a throwing
    stub in the output, as a decorator does (it used to say "this may be transient — try saving
    again");
  - extra statements a macro returns are visited, so macros inside them expand.

  **Breaking:** instance lookup by name follows `===` sugar's rule everywhere: two instances at the same level
  (two local ones, or two imported modules that both export one) are an error naming both, and
  nothing else is reported for that use. An instance some import exports ranks above another module's
  non-exported one. A
  `let:`/`par:` comprehension and `implicit()`'s by-name fallback used to take the first one in
  import order. `@derive` planning still treats either as "the type already has an instance".

- 2ec1797: `@derive(Destructure)` gives your own types extractor patterns. On a product
  interface (or object type alias) it generates a constructor function named
  after the type, `Point(x, y)`, and a `Destructure` instance binding the fields
  in declaration order (`@destructure always -> x, y`). On a discriminated union
  it generates one per variant, named after the variant's interface or, for an
  inline variant, its tag in PascalCase (`{ kind: "circle"; r }` → `Circle(r)`),
  testing the discriminant. So `case Point(x, y)`, `.case(Circle(r))` and
  `Point(1, 2)` all work, in the same file and from other files, and a library's
  `.d.ts` declares the functions and instances for its consumers.

  Patterns compile to field reads and discriminant checks and never reference the
  generated function or instance, so a bundler drops them when only patterns use
  them. Ambiguous cases are compile errors: several candidate discriminants, a tag
  that makes no name or a duplicate one, `extends` clauses, a name some value
  (or global) already has, a class.

  `@derive` now emits derive-generated function declarations before the rest of
  a declaration's derive output, so `@derive(Eq, Destructure)` can merge the
  function `Point` with the companion namespace `Point` (TypeScript requires the
  function first).

- 7340c04: Extractor patterns come from `Destructure` instances. `Name(...)` in a
  pattern (fluent `match()` or a `match:` switch) resolves a
  `Destructure<typeof Name, Input, Output>` instance by `Name`'s symbol, from the
  current file, the modules it imports, or the module that declares `Name`. An
  instance with a `@destructure` descriptor (`not-null -> self`,
  `kind = "circle" -> r`, `always -> x, y`, ...) is inlined: the test and the
  field reads, no call. Without one, its `extract` is called once and the result
  destructured. A name with no instance is still an `instanceof` pattern.

  **Breaking (internal):** `registerProductExtractor`, `registerCustomExtractor`
  and `clearRegisteredExtractors` are removed (nothing outside tests used them);
  declare a `Destructure` instance instead. `@impl` on a multi-parameter
  typeclass no longer warns that it can't generate a companion.

- 3460709: `==` and `!=` now dispatch through std's `Eq` the same way `===` and `!==` do.
  Before, in a file that imports `@typesugar/std/syntax/eq/ops`, `a === b` called
  `Eq.equals(a, b)` but `a == b` stayed a reference comparison, and without the
  import TS9804 warned for `===`/`!==` but not for `==`/`!=`. Now `a == b` compiles
  to `Eq.equals(a, b)`, `a != b` to `Eq.notEquals(a, b)`, and TS9804 covers all four.
  Comparisons with `null` or `undefined` (`a == null`) and primitive operands stay
  native, as before. For reference identity in a file that activates Eq, write
  `Object.is(a, b)`: it is a call, so it is never rewritten.
  - `@typesugar/macros`: a typeclass method may carry several `@op` tags, one per
    operator, for equivalent spellings of the same operation (`@op ===` and
    `@op ==` on `equals`). Every tag maps its operator to the method. New
    `extractOpsFromJSDoc()` returns all of a member's `@op` operators, and
    `TypeclassMethod.operatorSymbols` lists them; `extractOpFromJSDoc()` and
    `operatorSymbol` keep returning the first. The built-in `Eq` seed maps `==`
    and `!=` too.
  - `@typesugar/std`: `Eq.equals` is tagged `@op ===` and `@op ==`, and
    `Eq.notEquals` `@op !==` and `@op !=`.
  - `@typesugar/transformer-core`: TS9804's help for `===`/`!==`/`==`/`!=` names
    `Object.is(a, b)` as the way to keep reference equality. The operator rewrite
    now honors the documented `operators` opt-out (`// @ts-no-typesugar operators`,
    `"use no typesugar operators"`); before, only `extensions` stopped it, so the
    `operators` opt-out silenced TS9804 but still rewrote in an activated file.
  - `@typesugar/core`: the TS9804 explanation covers `==`/`!=` and `Object.is`.

- 95602ac: The built-in extractors are `Destructure` instances owned by the packages that
  own the types. `@typesugar/fp` ships `destructureSome`/`destructureNone`,
  `destructureLeft`/`destructureRight`, `destructureCons`/`destructureNil` and
  (new) `destructureValid`/`destructureInvalid` next to Option, Either, List and
  Validated, each with a `@destructure` descriptor, so `match(o).case(Some(v))`
  compiles to the same inlined test and binding as before (pinned in tests).

  **Breaking:** `match.ts` no longer special-cases these names. An extractor
  follows the constructor's symbol: a `Some`/`Left`/`Ok`/... that is not fp's
  needs its own instance. The `_tag`-based fallback (used when the scrutinee's
  type had a `_tag` property) and the `Ok`/`Err` extractors for
  `{ ok: true; value }` results are gone: declare instances with
  `@destructure _tag = "Some" -> value` / `@destructure ok = true -> value`, or
  use object patterns. Exhaustiveness for key tests is now general: `has k`
  extractors cover a union when every member has a required `k`.

- b893cb6: The fluent `match()` chain has real types for tools that type-check unexpanded
  source (plain `tsc`, tsup's own `.d.ts` step, typescript-eslint, typedoc). It
  was typed `never`, so every fluent match failed there with "Property 'case'
  does not exist on type 'never'". Now `match(x)` is a `FluentMatch<T>`: literal
  arms and `.else()` type-check, and the value is the union of the arm results.
  A chain that ends in `.then()` is `R & FluentMatch<…>`, with `null` and
  `undefined` results kept beside the intersection; continuing a chain after
  such an arm is "possibly null" to plain `tsc`, and typesugar's own checks
  (`MacroCallChain`) suppress that error on the chain's receiver. Names bound
  by patterns are still undeclared to plain `tsc`. `FluentMatch`,
  `FluentMatchCase` and `FluentMatchArms` are exported from `@typesugar/std`.
- 851809b: `match: switch` — the statement form of pattern matching. A `match:` label on
  a `switch` (activated by `import "@typesugar/std/syntax/match"`) keeps the
  switch, with arm bodies in place and plain `break`/`return`/`continue`/
  `throw`/fallthrough, and adds the exhaustiveness check (TS9226, as for the
  fluent form):
  - literal cases (literals, consts, enum members) compile to the same switch,
    label removed: the JavaScript is the hand-written switch;
  - destructuring cases (`case { type: "Point", coordinates: [x, y] }:`)
    compile to a switch on the shared discriminant with the bindings
    destructured in a block per case; built-in extractors (`case Some(v):`)
    work too, and cases with no shared discriminant compile to `switch (true)`;
  - `default:` covers the rest, except one that only throws (a runtime safety
    net), which keeps the check; an unreachable `default:` is a warning.

  Supporting changes: `LabeledBlockMacro.statement` (`"block"` | `"switch"`)
  selects the statement a label attaches to; `erasableSyntaxModule` removes a
  marker-only activation import from the output; a `MatchSwitch` diagnostic
  suppression rule hides TS2304/TS18004 for names a case binds and TS7028 on the
  `match` label in files that activate it.

- d8f810b: PEP-052 Wave 2: labeled-block macros are now import-scoped (`@syntax-labels`
  activation), matching the operator/method syntax gates.
  - BREAKING (pre-1.0): `let:`/`seq:`/`par:`/`all:` do-notation comprehensions
    only expand in files that import `@typesugar/std/syntax/do`, and bare
    `requires:`/`ensures:` contract blocks only apply `@contract` in files that
    import `@typesugar/contracts/syntax`. The explicit `@contract` decorator form
    is unaffected (importing the symbol is the opt-in).
  - NEW: TS9224 warning when a block-shaped label matches a registered macro
    whose syntax is not activated, with a help hint naming the exact import to
    add (unexpanded do-notation is still valid JS — `x << effect()` silently
    becomes a bit-shift — so the hint matters).
  - NEW: `@syntax-labels <macroName>` activation-marker tag (read alongside
    `@syntax-operators`/`@syntax-methods`) and an optional `syntaxModule` field
    on `LabeledBlockMacro`/`AttributeMacro` that feeds the TS9224 hint and
    doubles as a resolution-free activation fallback — an import specifier
    exactly matching a macro's `syntaxModule` activates it even in hosts that
    cannot resolve modules (the playground's in-memory host, virtual file
    names).
  - FIXED: ordinary loop labels colliding with macro label names
    (`all: for (…)`) were dispatched to the macro (a hard error) when the file
    had the syntax activated; labeled non-blocks are no longer dispatch
    candidates at all.
  - FIXED: an expression-position comprehension in a file that never activates
    do-notation was text-rewritten by the preprocessor and then left mangled
    (invalid JS) by the gate; the preprocessor is now gated on activation too,
    leaving such files untouched.
  - FIXED: activation markers (all kinds, operators/methods included) were
    silently dropped in files rewritten by the expression-comprehension
    preprocessor — the re-parsed file isn't part of the `ts.Program`, so
    checker-based marker resolution failed. Markers now resolve against the
    program's own copy of the file.

- 63bf193: PEP-052 Wave 3: do-notation instance resolution is scope-based — the last
  process-global instance registry is deleted.
  - BREAKING (pre-1.0): `let:`/`par:` comprehensions resolve their
    `FlatMap`/`ParCombine` instance from the file's scope (a local `@impl`
    declaration or an export of any imported module), not from a global
    registry populated by side-effect imports elsewhere in the program. The
    std builtins (Array, Promise, Iterable, AsyncIterable) ride along with the
    `@typesugar/std/syntax/do` marker every do-notation file already imports —
    zero new imports for the common case. Effect users import
    `@typesugar/effect/syntax/do` (one line: activates the labels AND provides
    the Effect instances).
  - NEW: TS9225 "No FlatMap instance for 'X' is in scope" error naming the
    exact import to add when resolution misses.
  - NEW: `@do-methods` JSDoc metadata on instances declares do-notation
    emission (bind/map/orElse method names, static-vs-method call style,
    static receiver, `all` join) — replacing the hardcoded Promise/Effect
    special cases in the comprehension macros. Third-party monads get the
    same treatment as std's.
  - NEW: scanner-visible `FlatMap<Either>` instance (`flatMapEitherInstance`)
    in `@typesugar/fp` — `let:` over Either now works via any fp import (the
    `flatMapEither<E>()` factory alone was never discoverable, so Either
    do-notation had silently never expanded).
  - NEW: `ParCombine<Effect>` instance — `par:` over Effect now emits
    `Effect.map(Effect.all([...]), ...)`; previously it fell back to an
    applicative chain emitting `.map(...).ap(...)` calls Effect doesn't have.
  - REMOVED: `doNotationRegistry`, `parCombineBuilderRegistry`, and their API
    (`registerFlatMap`, `registerParCombine`, `registerParCombineBuilder`,
    `getFlatMapMethodNames`, `hasFlatMapInstance`, `hasParCombineInstance`,
    `getInstanceMeta`, `clearRegistries`). Declare instances with `@impl` +
    `@do-methods` and export them instead.

- c3ad41c: **Breaking:** `Range`'s step size field is now `stride` (`{ start, end, stride, inclusive }`).
  While it was `step`, it hid the `step` extension method from the type checker, so
  `(0).to(10).step(2)` failed with TS2349 ("This expression is not callable"). The method keeps its
  name: `(0).to(10).step(2).toArray()` now type-checks. Code that read `r.step` reads `r.stride`.

  `@typesugar/fp`'s `Eq`, `Ord` and `Ordering` are now `@typesugar/std`'s types, re-exported, rather
  than a copy with the same members, and fp depends on `@typesugar/std`. fp's `PartialOrd`,
  `LT`/`EQ`/`GT` and combinators are unchanged.

### Patch Changes

- 612112b: Fixes from the 2026-11 architecture review (audit/ARCH-REVIEW-2026-11-TRIAGE.md):
  - A decorator the file implements itself is no longer taken for a macro of the same name:
    `function reflect(t) { … }  @reflect class A {}` keeps the user's `@reflect` instead of
    dropping it and emitting `__A_meta__`. An ambient declaration (`declare function reflect`)
    still reaches the macro.
  - Every opt-out feature in docs/guides/opt-out.md now works. `"use no typesugar typeclasses"`
    turns off `@typeclass`, `@impl`/`@instance` and `summon`/`summonAll` (it was accepted and
    ignored), and `"use no typesugar derive"` covers a JSDoc `/** @derive … */` tag as well as
    the decorator. Core exports the feature names as `OptOutFeature`/`OPT_OUT_FEATURES`, and a
    macro can declare the feature that turns it off (`optOutFeature`), checked by
    `isMacroOptedOut`.
  - An expression-position comprehension (`const f = (x) => par: { … } yield: { … }`) in a file
    that hasn't activated the label syntax gets the TS9224 hint, as the block form does, instead
    of only TypeScript's syntax error.
  - An ambiguous typeclass method-sugar instance (and a failure resolving one) is reported at the
    call, not at the start of the file.
  - TS9602 for an imported generic function says that only same-file functions are specialized,
    instead of advising a different declaration form.
  - std's `ordArray(O).lessThan` and the other comparison methods no longer rebuild the `Ord` and
    `Eq` dictionaries on every call.

- a070a0c: Every reader of a `@derive` / `@deriving` JSDoc tag uses one parser, `deriveTagNames` (exported
  from `@typesugar/core`), so they agree with the derive macro on what a type derives. Method syntax
  matched the typeclass name anywhere in the tag's comment: with `@derive(Eq)` and a description
  line that mentioned "Show", `p.show()` became `Point.Show.show(p)`, a companion that never
  exists. The TS2339 suppression rule took every word of the comment as a derive name, the
  auto-derive check and std's `Destructure` planner had the same kind of match, and the instance
  scanner dropped the last name of `@derive Eq, Clone` when a description line followed. Tags in
  prose or fenced examples no longer count in any of them.
- 3ae83a6: The values `@derive(Destructure)` declares (the constructor functions `Point`, `Circle` and their
  instances) can be imported, called and re-exported by name before expansion. Checked as written,
  the source reported `export { Circle } from "./shapes"` and `import { Circle }` as TS2305,
  `Point(1, 2)` as TS2693 and `Circle(2)` in the deriving file as TS2304, so `emitDeclarations` (tsup's
  `withTypesugar`) wrote nothing for an index file that re-exports them. A derive macro can now say
  which names it declares (`generatedNames`), and the `DerivedDeclarationReference` suppression rule
  accepts exactly those. `typesugar build` keeps those names in the JavaScript's imports and
  re-exports, which TypeScript dropped as type-only.
- 8f533b0: Do-notation finds a `FlatMap`/`ParCombine` instance by the first bind's type when no instance carries its printed name. With `@impl FlatMap<Result>` for a union `Result = Ok | Err`, a bind typed `Ok<…>`, `Err<…>` or an alias of `Result` used to fail with TS9225 ("No FlatMap instance for 'Ok'"); it now resolves when every class or interface the bind's type is made of is part of the instance's type. Name matches still take precedence.

  `typesugar check` and the language service no longer report TS2348 ("Value of type 'typeof X' is not callable") for a class used as an extractor pattern (`.case(Ok(v))`, `case Ok(v):`); the expansion never calls it. The error is still reported outside patterns, including in an arm's result.

- 7d84596: Docs and comments brought in line with the extractor typing, covering-match,
  marker-type and scoping fixes: the fp README's `Some`/`None` output (the
  assertion, no `MatchError`), the std and macros READMEs on when a match has no
  throw, the umbrella README on markers being types, the reserved TS9702 (no
  "automatic"/"explicit" modes in 1.0), and core's prelude, resolution-scope and
  `ResolutionConfig` comments (the mode and prelude are not read).
- 0780883: `match()`: exhaustiveness agrees with the code it generates
  - An arm that names a field its variant declares optional
    (`.case({ k: "b", extra })` with `extra?: string`) tests `"extra" in` the
    value, so `{ k: "b" }` matched no arm and threw `MatchError` at run time, yet
    the match was accepted as exhaustive. Such an arm no longer covers the
    variant: TS9226 reports it and names the optional field. Add an arm for the
    rest (`.case({ k: "b" })`) after it. `match: switch` destructures instead of
    testing, so there the same case still covers the variant and binds
    `undefined`.
  - Enum members are constant patterns: `.case({ k: K.A, n })` tests
    `k === K.A`, and the arms count for exhaustiveness as the members' values.
    Before, `K.A` had no test at all (the arm matched any value with an `n`) and
    the match reported "missing variants". A qualified name is a constant only
    when its type is one literal value; any other sub-pattern the macro can't
    compile is now an error instead of matching anything.
  - A tuple pattern of the tuple's length with only bindings (`[x, y]` on
    `[number, number]`), or `[head, ...rest]` on a tuple at least that long,
    covers the tuple type: no "not enumerable" TS9226.

- f6e9683: A fluent `match()`'s discriminant switch no longer tests a field the tag guarantees. Inside `case
"circle":`, `if ("radius" in _s)` tested what the type already says (the circle variant requires
  `radius`), so it was dead code in every arm. It is emitted only when the field is optional in that
  variant, or when the tag doesn't pick out one variant (two variants share it, a variant's tag isn't
  a literal, or the scrutinee isn't a discriminated union). The output is smaller, and an arm whose
  fields are all required is the plain field read a hand-written switch has.
- 0079f40: `match()`: no dead `break` or `MatchError` after a discriminant switch that covers every variant
  - A fluent match on a discriminated union compiles to a `switch` on the
    discriminant. When every variant has an arm with no guard and nothing left
    to test (`.case({ kind: "circle", radius })` where `radius` is required), the
    switch can't fall out of a `case`, but every arm was still followed by
    `break;` and the switch by `throw new MatchError(_s)`, which kept
    `import { MatchError } from "@typesugar/std"` in the output (std's showcase
    had it). Both are gone. A `case` whose arms can fall through (a guard, an
    optional field's test, a sub-pattern) keeps its `break;`, and the throw stays
    unless the switch is shown to cover every variant of the type it reads.
  - An `if`-chain match that ends in an arm taking every value with a binding or
    `.as()` (`.case(other).then(...)`) no longer has a dead `MatchError` after it.
    The "unguarded binding" case was meant to be covered already, but the arm's
    block wasn't recognised as returning.
  - The object-handler form `match(value, { ... })` with a handler for every
    member of a literal union, or every variant, calls its last handler with no
    test: no `MatchError.throw` (and its import) or non-exhaustive throw after it.

- f66c14f: `match()`: an extractor's binding has the payload's type, and a covering extractor match has no dead `MatchError`
  - `Some(v)` over `@typesugar/fp`'s `Option` compiled to `const v = _o`, typed
    `Option<number>`: fp's `Option` is `@opaque`, so `_o != null` doesn't narrow
    it for the checker, and the expanded code failed strict type-checking
    (`typesugar build --strict`, the playground's `strictOutput`) on `v * 2`. The
    binding is now asserted to the payload type the `Destructure` instance's
    `extract` declares (`const v = _o as unknown as number`), worked out by
    matching `extract`'s parameter type against the value's type by identity. The
    same goes for `Some(...)` nested in another extractor (`Right(Some(v))`), for
    nested tests (`Some(5)`), and for the `match: switch` form. Left/Right,
    Cons/Nil, Valid/Invalid and `@derive(Destructure)` extractors bind fields of
    transparent types, which TypeScript narrows itself; they were already typed.
  - A match whose extractors cover the type (Some/None, Left/Right, Cons/Nil,
    Valid/Invalid, Ok/Err-style discriminants, derived variant extractors) now
    ends in its last arm with no test: no `throw new MatchError(...)`, so no
    runtime `import { MatchError } from "@typesugar/std"` in the output. The same
    holds for a 7+ literal `switch` that covers its literal union (the last arm
    is the `default:`). A value outside the static type takes the last arm.
  - Arms that bind nothing (`None`, `Nil`, `Some(_)`, literals) compile to a
    conditional instead of an IIFE: `match(o).case(None).then("none").case(Some(_)).then("some")`
    is `o == null ? "none" : "some"`. Arms with bindings keep the IIFE, which
    gives their `const`s a block.

- 4e1787c: `match()`: literal arms compile to a conditional chain, and no dead `MatchError`
  - A match whose arms are all plain literals (with any `.or()` literals), ending
    in `.else()`, a `_` arm or an arm that completes a literal union, now compiles
    to `x === "a" || x === "b" ? 1 : x === "c" ? 2 : 3` when the scrutinee is an
    identifier. It used to compile to an arrow IIFE, a closure per evaluation,
    unless it had exactly one arm and an `.else()`. The guide already documented
    `x === "ok" ? 200 : 500` for this shape. A `yield` or `await` in such a match
    now stays in the enclosing function.
  - On the IIFE path, an arm that returns unconditionally (a fully covering last
    arm, or an unguarded `_` or binding) is now the end of the generated code. A
    `throw new MatchError(...)` used to follow it, which could never run but
    still added `import { MatchError } from "@typesugar/std"` to the output, so a
    library gained a runtime dependency on `@typesugar/std` for dead code.

  Found by the Turf case study (Stage 3), on `@turf/meta`'s `flattenEach`.

- 2f7a375: `match()` sees through nested extractor patterns when checking exhaustiveness. Arms such as `Ok(Ok(v))`, `Ok(Err(e))` and `Err(e)` over a `Result<Result<number, string>, string>` (neverthrow's classes with `has value` / `has error` descriptors, or `ok = true` / `ok = false` ones) were reported as TS9226 "the scrutinee type is not enumerable" although they cover every value; they are now exhaustive, and dropping one of them is still reported. Such a match keeps every arm's test, so its output type-checks.
- 945648a: `match` treated any object type with a literal-typed field as a one-variant
  discriminated union, so `interface Cfg { version: 1; name: string }` got
  "missing variants: 1 (discriminant: "version")" for arms on `name`, and a
  `match: switch` over it reported its `default:` as unreachable. The
  one-variant rule now applies only to what it was for: a variable or property
  declared as a discriminated union and narrowed to one variant
  (`const c: Shape = { kind: "circle", ... }`). A plain object type keeps the
  object diagnostics (it needs `.else()`).
- 2252df8: A fluent `match()` on a value TypeScript has narrowed reads it at its declared type. The expansion
  reads the scrutinee from a const, which had the narrowed type: after `const circle: Shape = { kind:
"circle", radius: 5 }`, `match(circle)...case({ kind: "square", side })` expanded to a `case
"square":` TypeScript called unreachable (TS2678) and a `side` it typed `unknown` (TS18046), so
  type-checking the expansion (`typesugar check --strict`) reported 5 errors on std's showcase, all
  in valid code. The const is now asserted back to the declared type, `const _circle = circle as
Shape;` (as the file can name the type: an import type when the file doesn't import it). Only the
  members the narrowing removed that are of the kind left come back, so `Shape | null` narrowed to
  `Shape` stays non-null. The JavaScript is unchanged: the assertion is erased.

  `typeToPortableTypeNode` (exported from `@typesugar/core`) writes a type as a type node a given
  file can contain; the declaration emit's `@opaque` annotations use it too.

- 718090c: `break match;` inside a `match:` switch works: when a case names the label, the
  expanded switch keeps it (renamed, with its `break`s, when a nested `match:`
  switch would clash). It used to be removed, leaving `break match;` a
  `SyntaxError: Undefined label 'match'`.
- 5d3d92a: A call pattern whose name has no `Destructure` instance is a type test
  (`value instanceof Name`) that binds the whole value to its one argument. Two
  silent miscompilations of it are now errors: more than one argument
  (`Money(a, c)` bound only `a` and left `c` unbound or captured from an outer
  scope), and a name that is not a class or built-in constructor (an interface
  with a factory function, `Pt(p)`, compiled to an `instanceof` that throws).
  A checker failure while looking up a `Destructure` instance is reported as a
  warning instead of being swallowed.
- 928566a: PEP-049 Wave 4 (test debt):
  - `@typesugar/std`: rename the boolean extension `then(b, fn)` → `andThen(b, fn)`
    (and the matching `Boolean` global augmentation). A top-level ESM export named
    `then` makes the module namespace a thenable, so `await import()` of
    `extensions/boolean` rejected with `undefined` — the module was effectively
    un-dynamically-importable. Use `b.andThen(() => …)` for the lazy
    conditional; `thenSome`/`elseSome`/`fold` are unchanged.
  - `@typesugar/macros`: fix `@hkt` `_` detection inside object type literals.
    `type ObjF = { value: _ }` is now correctly recognized as Tier 3 and expands
    to `this["__kind__"]` (previously the `_` inside a `TypeLiteral`
    `PropertySignature` was skipped and the alias mis-classified as Tier 2).

- 98adbea: PEP-052 Wave 4: de-magicking — HKT typeclass knowledge is
  declaration-derived and the dead post-registry surfaces are gone.
  - REMOVED: `hktTypeclassNames`, `registerHKTTypeclass`, the
    `hktExpansionRegistry` hardcoded seeds, and the hand-written HKT signature
    templates. `isHKTTypeclass` now derives from the `@typeclass` interface
    declaration (type parameter used as `Kind<F,…>`, including through
    `extends` chains — the op-index flattens heritage). fp's typeclass
    interfaces (Functor…Alternative) now carry `@typeclass` tags and are read
    exactly like third-party typeclasses.
  - REMOVED: the `InstanceMeta` type, all no-op 1-arg
    `registerInstanceWithMeta` calls, the legacy transformer's import
    pre-scan, the dead `knownTypeclasses` scope chain
    (`isTypeclassInScope`/`getInScopeTypeclasses`/`registerImportedTypeclass`),
    the test-only ResultAlgebra helpers
    (`unsafeResultAlgebra`/`hasResultAlgebra`/`getAllResultAlgebras`), and
    `register-instances.ts` (`registerStdInstances` survives as a deprecated
    runtime no-op stub).
  - NEW: `@do-instance-module <specifier>` JSDoc tag — do-notation instance
    providers self-describe their activation import; the TS9225 hint consults a
    program-wide index first and falls back to a small static table only for
    providers whose declaration files are unreachable in the program.

- 563e46b: PEP-052 Wave 6: resolution-free operator/method syntax-marker fallback,
  closing the gap for hosts (the browser playground) that cannot resolve
  modules via the checker.
  - NEW: `@typesugar/core` exports `registerSyntaxMarkerFallback`/
    `getSyntaxMarkerFallback` — a small, provider-declared registry that lets a
    package register "this exact import specifier activates operator/method
    syntax for typeclass X" without needing real module resolution.
    `scanImportsForScope` consults it as a purely additive fallback alongside
    the existing checker-based marker discovery.
  - NEW: `@typesugar/std` registers all 21 of its syntax markers (13 method +
    8 operator) via this mechanism from its `./macros` entry; `@typesugar/fp`
    registers its one marker (`@typesugar/fp/syntax/show`) from its root `.`
    entry (fp has no separate `./macros` compile-time entry).
  - FIXED: `@typesugar/playground`'s `transform()` — the actual in-memory host
    this wave exists for — never loaded std's or fp's compile-time
    registrations at all (both were only imported for runtime values via a
    separate iframe-sandbox bundle). A playground snippet importing e.g.
    `@typesugar/std/syntax/eq/ops` could not activate Eq operator syntax.
    Fixed with two side-effect imports; verified negligible bundle-size impact.

- 76672a0: PEP-053 Waves 4–5: the compiler's hard-coded builtin instance table is gone.
  The ~28 static `registerInstanceMethods(...)` registrations (source-code-as-
  strings copies of the fp/std/effect instances), the deprecated
  `registerInstanceMethods` function, and the internal-registration machinery
  are deleted from `@typesugar/macros`. Instance method bodies now come
  exclusively from source extraction — the same rules for std/fp/effect
  instances as for user instances, no builtin magic. The 16 primitive
  intrinsics (`eqNumber` → `a === b`, …) and the per-program AST registry
  (`registerInstanceMethodsFromAST`) remain. `eitherBifunctor` and
  `flatMapStream` (registrations with no corresponding source instance) are
  dropped. Residual `specialize()`-as-API comment mentions in std/effect/
  collections/validate sources are rewritten for the always-on model.
- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- 93ea406: PEP-060 item 1: support TypeScript 6, reject TypeScript 7 with one clear error
  - **Peer range is now `typescript >=5.9.0 <7.0.0`** on every package (was
    `>=5.0.0 <6.0.0`). TypeScript 6.0.x still has the JavaScript compiler API typesugar
    is built on; TypeScript 7 (`typescript@latest` since 7.0) does not. The floor
    moved up from 5.0 because older releases were measured to break: before 5.5,
    Node's ESM loader sees none of TypeScript's named exports, so the CLI and the
    Vite plugin crash on their first `ts.*` access (5.0–5.3 also lack
    `checker.isTypeAssignableTo` and other APIs typesugar calls); 5.5–5.8 lack
    `checker.getNonPrimitiveType()`, so `@impl X<object>` instances never resolve.
    5.9.3 and 6.0.3 build, type-check and pass the core, transformer-core, macros,
    transformer, std and fp suites. The `library` and `macro-plugin` templates that
    `typesugar create` copies peer the same range, and all three templates now
    install `typescript ^5.9.3`.
  - **`typescript` is now an optional peer** of the packages whose runtime `.` entry
    never loads it: codec, collections, contracts, erased, fp, fusion, mapper, parser,
    strings, testing, units, validate and the `typesugar` umbrella. Their `./macros`
    entries still need TypeScript at build time. `check:runtime-purity` now fails if a
    package with an optional peer loads `typescript` from its `.` entry, directly or
    through a dependency.
  - **TypeScript version guard.** `@typesugar/core` exports `assertSupportedTypeScript`,
    `getUnsupportedTypeScriptReason`, `UnsupportedTypeScriptError`,
    `SUPPORTED_TYPESCRIPT_RANGE` and `TYPESCRIPT_SUPPORT_URL`. `@typesugar/macros` runs
    it first thing at load, and the transformer (pipeline, ts-patch factory, and the
    language-service plugin, which checks tsserver's own TypeScript), `transformCode`,
    unplugin, the LSP server and the ESLint processors call it before their first
    compiler-API access. On TypeScript 7 they all stop with
    `[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed the JavaScript
compiler API that typesugar's transformer needs. Install typescript@6 (or 5.9+) as a
devDependency for typesugar (npm i -D typescript@6); see
https://typesugar.org/getting-started/troubleshooting#typescript-7` instead of an
    opaque `Cannot read properties of undefined (reading 'ES2022')`. TypeScript older
    than 5.9, or a module missing `ts.factory` / `ts.createProgram`, is rejected the
    same way.

- e064ef7: std's showcase compiles and runs again, and every `packages/*/examples/*.ts` is now run with
  `typesugar run` in the test suite (the ones still broken are listed, with why). Fixes on the way:
  - `match()` treats an object type with a literal-typed property as a one-variant discriminated
    union: `const c: Shape = { kind: "circle", radius: 5 }` (narrowed to the circle variant) is
    covered by its `.case({ kind: "circle", radius })` arm instead of TS9226 "not enumerable".
  - std's root exports the array `groupBy` under its own name (as well as `arrayGroupBy`), so
    `import { groupBy } from "@typesugar/std"; xs.groupBy(f)` resolves.
  - An imported value whose apparent type carries a `declare global` stub (std's `LT`, a number,
    has `clamp` through `interface Number`) is no longer offered as an extension namespace:
    importing `LT` next to `clamp` made `(150).clamp(0, 100)` ambiguous.
  - `typesugar run` bundles for the Node it runs on (top-level await works) and gives bundled
    CommonJS modules a `require` for Node builtins ("Dynamic require of 'path' is not supported").

- Updated dependencies [e92220f]
- Updated dependencies [f086b8b]
- Updated dependencies [612112b]
- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [4d4ce68]
- Updated dependencies [9bcb9d8]
- Updated dependencies [0e0fe90]
- Updated dependencies [f8dcade]
- Updated dependencies [3400d8c]
- Updated dependencies [fae35e9]
- Updated dependencies [f3c8949]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [a7158b3]
- Updated dependencies [c5ebf64]
- Updated dependencies [ec2188f]
- Updated dependencies [d79d995]
- Updated dependencies [81f31db]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [34850dc]
- Updated dependencies [291dc90]
- Updated dependencies [5f9af12]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7340c04]
- Updated dependencies [8f533b0]
- Updated dependencies [7d84596]
- Updated dependencies [592d66b]
- Updated dependencies [3460709]
- Updated dependencies [eb77b03]
- Updated dependencies [810833a]
- Updated dependencies [c60519f]
- Updated dependencies [4ca9f31]
- Updated dependencies [0435dc6]
- Updated dependencies [bec2d2b]
- Updated dependencies [fbf4ef1]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [75f1968]
- Updated dependencies [e016c8d]
- Updated dependencies [c9a1e3e]
- Updated dependencies [624d80a]
- Updated dependencies [e0ba26b]
- Updated dependencies [4b0d84d]
- Updated dependencies [76af80e]
- Updated dependencies [977888e]
- Updated dependencies [ac891d1]
- Updated dependencies [c7fb29f]
- Updated dependencies [508c7d3]
- Updated dependencies [283fe78]
- Updated dependencies [d7d6236]
- Updated dependencies [eb6e5a8]
- Updated dependencies [6659c44]
- Updated dependencies [f4ffc81]
- Updated dependencies [0780883]
- Updated dependencies [b893cb6]
- Updated dependencies [914817e]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [05dbbcb]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [dade880]
- Updated dependencies [d0392e0]
- Updated dependencies [babbb30]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [89c895b]
- Updated dependencies [c30101d]
- Updated dependencies [4f6ad83]
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [48b621b]
- Updated dependencies [563e46b]
- Updated dependencies [57d76a1]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [76672a0]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [2fb4b62]
- Updated dependencies [93ea406]
- Updated dependencies [e0694af]
- Updated dependencies [3e05585]
- Updated dependencies [95b6631]
- Updated dependencies [f471698]
- Updated dependencies [5da6803]
- Updated dependencies [51a72ca]
- Updated dependencies [616d213]
- Updated dependencies [dca9c00]
- Updated dependencies [cf7c08b]
- Updated dependencies [d7b3911]
- Updated dependencies [e40c7e3]
- Updated dependencies [2f1744b]
- Updated dependencies [5d86014]
- Updated dependencies [0c9202a]
- Updated dependencies [5cc34d9]
- Updated dependencies [8204470]
- Updated dependencies [c1e797e]
- Updated dependencies [6edd688]
- Updated dependencies [615d4c1]
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0
  - @typesugar/typeclass@0.2.0
  - @typesugar/type-system@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/macros@0.1.1
  - @typesugar/typeclass@0.1.1
  - @typesugar/type-system@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/macros@0.1.1-rc.0
  - @typesugar/typeclass@0.1.1-rc.0
  - @typesugar/type-system@0.1.1-rc.0
