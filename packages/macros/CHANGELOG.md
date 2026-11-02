# @typesugar/macros

## 0.2.0

### Minor Changes

- 3400d8c: **Breaking:** derived `Clone` is field-wise, like Rust's `#[derive(Clone)]`,
  instead of a shallow copy. Each field is cloned through its own `Clone`, so
  mutating a clone no longer changes the original:
  - primitives and functions are copied as they are; arrays, readonly arrays
    and tuples element by element (`a.xs.slice()`, `a.rows.map(e => e.slice())`);
    `Date`, `Map`, `Set`, `RegExp` and typed arrays into new ones;
  - a field whose type has a `Clone` instance in scope (an `@impl`, or a
    `@derive(Clone)` companion) goes through that instance;
  - any other object type, and a discriminated union (per variant, with a
    `switch`), is cloned structurally by the same rules, inlined; a type that
    contains itself gets a local helper, so derivation never loops;
  - `any`, `unknown`, `object` and type parameters are copied by reference
    (there is no type to clone by; a `Clone<any>` instance in scope is used),
    and so is a class with no `Clone` instance, with a warning.

  The copy is still a spread of the original with the cloned fields set on top,
  so an absent optional field stays absent and undeclared properties are kept.
  Before, `summon<Clone<T>>()` and `@derive(Clone)` produced `({ ...a })`, whose
  nested arrays and objects were shared with the original. Code that relied on
  that sharing must now share explicitly.

  This also includes two fixes from the same branch: a derived `Clone` no longer
  adds `undefined` keys for absent optional fields or drops undeclared
  properties (it listed the declared fields), and `@derive(Clone)` /
  `summon<Clone<T>>()` on a discriminated union no longer fails with TS9106.

  `summon<TC<T>>()` with no instance in scope now derives for the type `T`
  names, so for `interface Feature<G = Geometry, P = Props>` the fields are
  `Geometry` and `Props`, not the type parameters `G` and `P`.

  Found by the Turf case study (Stage 1, findings F8 and F9): a derived `Clone`
  for the `@types/geojson` shapes now passes all 46 of `turf-clone`'s
  assertions.

- f3c8949: Specialize `= implicit()` calls; remove the NewtypeAssignment suppression rule
  - **`@typesugar/transformer-core`** (behaviour change): a call completed by
    `= implicit()` is now auto-specialized exactly like the explicit call.
    `sortWith([3, 1, 2])` with `ord: Ord<T> = implicit()` compiles to a hoisted
    `__typesugar___sortWith_number_0__([3, 1, 2])` with the comparator inlined,
    not to `sortWith([3, 1, 2], numberOrd)`. It falls back to dictionary passing
    in the same cases an explicit call does, and `// @no-specialize` works on it.
    This reverses the PEP-056 choice to keep implicit calls as plain dictionary
    passing.
    - New fallback (explicit and implicit calls): a function whose body calls
      another `= implicit()` function without passing the instance is no longer
      specialized. It warns TS9602 and keeps dictionary passing. Before, the
      hoisted copy dropped the propagated instance and threw "implicit()
      requires the typesugar transformer" at runtime.
  - **`@typesugar/macros`** (breaking): removed the `createNewtypeAssignmentRule`
    export and the `NewtypeAssignment` rule from
    `registerAllDiagnosticSuppressionRules` / `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`.
    `@typesugar/type-system`'s `UnwrapNewtype` reads a phantom base slot, so
    `wrap<T>()` and the newtype constructors type-check without any suppression.
    Code that declares its own `Newtype`/`UnwrapNewtype` with the old
    `T extends Newtype<infer Base, string>` shape will now see that TS2345.

- d3243f9: New `derived<TC<T>>()`: declare a derived instance once, in your own module,
  for a type you can't put `@derive` on (a library type such as `Feature` from
  `@types/geojson`):

  ```ts
  // geo-instances.ts
  import type { Feature } from "geojson";
  import type { Clone } from "@typesugar/std";
  import { derived } from "typesugar";

  export const cloneFeature = derived<Clone<Feature>>();
  ```

  - The call expands to the same code `@derive(Clone)` generates (one
    derivation, emitted once), with field instances from scope: a hand-written
    `Clone<GeoJsonProperties>` declared above it is used for `properties`.
  - The const is the instance: `summon`, `= implicit()` and method syntax find
    it in every file that imports the module, as they find a typed or `@impl`
    const. An `@impl` tag is optional (and must agree if present).
    `export const cloneFeature: Clone<Feature> = derived();` is the same
    instance, typed by its annotation, and its `.d.ts` is that annotation as
    written. Neither form leaves a `typesugar` import in the `.d.ts`.
  - Every typeclass `@derive` supports through a structural derivation (Eq,
    Ord, Clone, Debug, Hash, Default, Json, TypeGuard, Show, Semigroup, Monoid).
  - Errors: a field with no instance that can't be derived is TS9107 at the
    `derived` line, naming the field and its type; a type with free type
    parameters is TS9011 (not supported yet); anything but the initializer of a
    top-level `const` is TS9010. Two instances in scope at a use site are the
    existing ambiguity error.
  - Exported from the `typesugar` root and `@typesugar/typeclass` (runtime stub,
    like `summon`).

  **Deprecated: `summon` and `= implicit()` deriving in place.** When no
  instance is in scope they still derive one at the call site, a new copy at
  each call, but now warn once per typeclass and type per file with TS9009,
  which names the `derived` declaration to write. A later release removes the
  fallback, and such a call becomes TS9001. TS9001 for a type declared outside
  the project now suggests `derived<...>()`.

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

- a591082: New warning TS9804, "operator syntax not activated" (the operator counterpart
  of TS9224). Since PEP-052, `a + b` only dispatches to a typeclass's `@op +`
  method in a file that imports the typeclass's `/ops` marker (or declares the
  typeclass). Without the import, the operator silently stayed native JavaScript.
  Now, when the operand type has an in-scope instance of a typeclass that maps
  the operator, the transformer warns at the operator and names the import to add.
  For example: `Add import "@typesugar/std/syntax/numeric/ops";`. The warning
  covers binary and prefix-unary `@op` operators, including `===`/`!==` on Eq
  types.

  It only fires when activating the typeclass would actually rewrite the
  expression. It never fires for primitive operands, for types with no instance,
  in activated or `"use no typesugar"` files, or for operators no `@op` maps. Use
  `// @ts-no-typesugar operators` to keep a native operator on purpose.
  - `@typesugar/core`: the `TS9804` descriptor, and `findSyntaxMarkerSpecifiers()`
    for reverse lookup of registered marker specifiers.
  - `@typesugar/macros`: `getInactiveOperatorCandidates()`.
  - `@typesugar/transformer-core`: the hint, in `operator-activation.ts`.

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

- 053978c: PEP-053 Wave 1: specialization is now an always-on compiler optimization, not
  an API.
  - REMOVED: the `specialize()`, `specialize$()`, `mono()`, and `inlineCall()`
    macros and runtime stubs, the `fn.specialize(dict)` extension-method rewrite,
    and the `@typesugar/specialize` package (including the `Specialized<F, N>`
    type). Calls that pass a known typeclass instance auto-specialize — no
    annotation needed; use `// @no-specialize` to opt a call out.
  - REMOVED: `createSpecializedFunction`, `canFlattenToExpression`, and the
    `SpecializeOptions` type from `@typesugar/macros` (dead once the explicit
    surface was gone), and the TS9601/TS9221 diagnostics.
  - FIXED: `// @no-specialize-warn` previously disabled specialization entirely
    (substring collision with `// @no-specialize`); it now only suppresses the
    TS9602 skip warning. Both markers now also work on a comment line
    immediately above the call, matching the documented form.

- 8aaf40f: PEP-053 Wave 2: source-based instance extraction now covers everything the
  static builtin table covered. Auto-specialization recognizes instances across
  import aliases (including renames), identifier-alias consts
  (`const stdFlatMapArray = flatMapArray`), zero-arg factory instances
  (`eitherFunctor<E>()`), indirect object-literal members
  (`map: optionFunctor.map`, shorthand `{ map }`), and companion paths
  (`Point.Numeric`). Acceptance criteria are unified across both pipelines:
  an `@impl`/`@instance` tag OR a typeclass-shaped type annotation suffices.

  Cross-module method bodies that reference the instance module's local helpers
  or imports are NOT inlined — those calls fall back to dictionary passing
  (always correct) instead of capturing dangling identifiers.

  The extraction implementation is now shared (`@typesugar/macros`
  instance-extraction module) and consumed by both the legacy transformer and
  transformer-core, replacing the duplicated per-pipeline copies. New
  `cloneNodeDeep` utility in `@typesugar/core` protects foreign-file ASTs from
  in-place position stripping during inlining.

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
- c56886c: PEP-054: Rename "SFINAE rules" to "diagnostic suppression rules"

  "SFINAE" borrowed C++ template-metaprogramming terminology (overload-resolution
  failure) for a mechanism that actually suppresses a TypeScript diagnostic when
  typesugar's macro transformer will resolve it at emit time — an unrelated,
  misleading analogy. Renamed throughout to `DiagnosticSuppressionRule` and its
  family.
  - **`@typesugar/core`** (breaking): `packages/core/src/sfinae.ts` and
    `sfinae-rules.ts` are renamed to `diagnostic-suppression.ts` and
    `diagnostic-suppression-rules.ts`. Every exported symbol is renamed:
    `SfinaeRule` → `DiagnosticSuppressionRule`, `SfinaeAuditEntry` →
    `DiagnosticSuppressionAuditEntry`, `SfinaeEvalResult` →
    `DiagnosticSuppressionEvalResult`, `registerSfinaeRule(Once)` →
    `registerDiagnosticSuppressionRule(Once)`, `clearSfinaeRules` →
    `clearDiagnosticSuppressionRules`, `getSfinaeRules` →
    `getDiagnosticSuppressionRules`, `getSfinaeAuditLog`/`clearSfinaeAuditLog` →
    `getDiagnosticSuppressionAuditLog`/`clearDiagnosticSuppressionAuditLog`,
    `isSfinaeAuditEnabled`/`setSfinaeAuditMode` →
    `isDiagnosticSuppressionAuditEnabled`/`setDiagnosticSuppressionAuditMode`,
    `evaluateSfinae` → `evaluateDiagnosticSuppression`. No deprecated aliases
    (pre-1.0, matching PEP-053's precedent). The `TYPESUGAR_SHOW_SFINAE`
    environment variable is renamed to `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS`.
  - **`@typesugar/macros`** (breaking): `sfinae-rules.ts`/`sfinae-registration.ts`
    renamed to `diagnostic-suppression-rules.ts`/`diagnostic-suppression-registration.ts`.
    `SfinaeRegistrationOptions` → `DiagnosticSuppressionRegistrationOptions`,
    `registerAllSfinaeRules` → `registerAllDiagnosticSuppressionRules`,
    `ALL_SFINAE_RULE_NAMES` → `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`. Individual
    rule creator functions (`createExtensionMethodCallRule`, etc.) are unchanged.
  - **`@typesugar/transformer`** (breaking, CLI): the `--show-sfinae` flag is
    renamed to `--show-suppressed-diagnostics`. No deprecated alias — the old
    flag is now silently ignored (typesugar's CLI does not error on unrecognized
    flags), so scripts/CI invocations using the old name will stop enabling
    audit mode without a warning. Update any tooling that passes `--show-sfinae`
    or reads `TYPESUGAR_SHOW_SFINAE`.
  - **`@typesugar/lsp-server`, `@typesugar/playground`**: internal call sites
    updated to the renamed core/macros exports; no public API changes.

  Not renamed (deliberately out of scope, see PEP-054): `type-rewrite-registry.ts`
  (a separate, correctly-named mechanism), and PEP-011/PEP-034's own historical
  titles.

### Patch Changes

- 4d4ce68: `typesugar check` (and the IDE) no longer reports errors for code the transformer handles,
  found by type-checking every package example:
  - `@reflect interface User` was TS1206 ("Decorators are not valid here"): the MacroDecorator
    rule's name table missed it. Any registered attribute macro's decorator is now suppressed.
  - `.show()` for a `/** @typeclass */ interface Show` the file declares itself was TS2339: the
    rule only knew the standard typeclasses' methods. It now reads the program's typeclasses, as
    the rewrite does.
  - `ensures: { result >= 0; }` was TS2304 "Cannot find name 'result'" and `ensures: (r) => …`
    TS7006, in files that import `@typesugar/contracts/syntax`. A new ContractBlock rule
    suppresses exactly those two.
  - `eff.map((x) => …)` with `import { EffectExt }` was TS2339 and TS7006: the rule matched the
    receiver against the generic `Effect<A, E, R>` parameter with plain assignability. It now uses
    the transformer's own match (`receiverMatchesFirstParam`, moved to `@typesugar/core`), and an
    untyped callback parameter of a rewritten call is not "implicitly any".
  - `summon<Read<User>>()` against the published `@typesugar/sql` was TS9001 "No instance found
    for `Read$1<User>`": its bundled `.d.ts` declares `interface Read$1` and exports it
    `as Read`. A typeclass renamed that way is keyed by its exported name.

- 9bcb9d8: More places that caught a type-checker failure and quietly degraded now say so with a warning:
  `@impl`'s test for a type-level function (the type was silently treated as a data type), the check
  of whether a `@derive` companion is assigned before a use above its declaration (the use was
  silently taken as running first), the scan of an instance method's body before it is inlined (the
  method was silently called through its instance), and the check of what is read before an inlined
  call whose effects might be hoisted.
- 0e0fe90: The rest of the places that caught a type-checker failure and quietly degraded now say so with one
  warning: `@reflect`'s metadata (a field's type was silently "unknown", or every field was left out),
  matching an instance against a type's default type arguments (the instance was silently not found),
  following an imported instance's alias before inlining it, and specialization's symbol comparisons,
  primitive-instance test, body lookup and return-type-driven specialization (the call was silently not
  specialized). A repeat of the same failure is not warned again. A specialized call whose callee has no
  symbol is no longer cached under the callee's name, which two different functions of that name could
  share.
- f8dcade: A derived `Clone` of a class returns an instance of that class: the copy is
  created with the original's prototype (`Object.create(Object.getPrototypeOf(a))`)
  and its own fields copied onto it, so methods, getters, `instanceof` and a
  subclass's overrides work on the clone. It used to be a plain object typed as
  the class. A class whose instances can't be copied field by field, one with a
  `#private` member (or an `accessor` field) or one that extends a built-in such
  as `Map`, is now a TS9106 error that says why, instead of a broken clone.

  Generated code no longer prints a comment from the user's file inside an empty
  argument list (a derived `Map` clone printed `v.slice(/** @derive(Clone) */)`):
  `stripPositions` and the derivation parser reset node lists' positions too.

- fae35e9: `typesugar check` and `typesugar build` no longer fail on do-notation. They type-check the
  code as written, where a `let:`/`par:` comprehension is not valid TypeScript, and reported
  TS1214 on the `let`/`yield` labels, TS2304 on every bound name and TS2363 on every `a << e`
  (TS2869 on `a << e ?? fallback`), in every position; `build` exited 1 although its output was
  right. A new ComprehensionBlock rule hides exactly what the syntax causes, in files that
  activate the labels: the labels, a bind's `<<`, a bound name where the expansion declares it
  (and, when it also names an outer declaration such as the DOM's `name`, the errors from that
  declaration's type), and the expression-position preprocessor's `__letyield_N` tag, which
  `typesugar watch` reported. An unknown name, a wrong argument, or a bound name used where it
  isn't bound is still reported. A use of a bound name (`user.nme`) is type-checked only by the
  editor and `typesugar check --strict`, which check the expansion.
- a7158b3: An imported function's `.call`/`.bind`/`.apply` (a member every function has from the standard
  library) is never taken as an extension method on TypeScript 6 either: default-lib files were
  recognised by their `/// <reference no-default-lib="true"/>`, which TypeScript 6's lib files no
  longer carry, so `o.call(1)` became `helper.call(o, 1)`. They are now recognised by the program.
- ec2188f: Derived instances treat a branded primitive field (`number & { readonly __brand: "ProductId" }`,
  a `Newtype<number, "UserId">`, `string & {}`) as the primitive it is. Derived `Eq` rejected such a
  field ("Cannot derive Eq for 'Product'", TS9106, with "ProductId lacks Eq" in the trace), and
  derived `Clone` copied it with an object spread (`id: { ...a.id }`), which turns a number into `{}`.
  Now `Eq` compares it with `===` and `Clone` keeps the value.
- 81f31db: The derive markers are also their typeclasses' types
  - `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Json`, `Semigroup` and `Monoid` from
    `typesugar` are now both the derive marker (a value, as before) and the
    `@typesugar/std` typeclass of that name (a type alias of the interface, not a
    copy); `Show` is `@typesugar/fp`'s `Show`. One import serves `@derive(Clone)`
    and `summon<Clone<Point>>()`. Before, the marker was only a value, so plain
    TypeScript reported TS2749 on `summon<Clone<Point>>()` and typed it as `any`,
    and `const copy = summon<Clone<Point>>().clone(p); copy === p` stayed
    reference equality unless `copy` was annotated. `typesugar` now depends on
    `@typesugar/std` and `@typesugar/fp` for these types; its runtime entry still
    loads neither (the aliases are type-only). `Default` and `TypeGuard` have no
    typeclass interface yet and stay values only.
  - `summon<TC<T>>()` and `derived<TC<T>>()` find the typeclass `TC` names
    through the checker (imports, renames, forwarding type aliases) instead of by
    its spelling, so `import { Clone as Copyable } from "typesugar"` and
    `summon<Copyable<Point>>()` resolve `Point`'s `Clone` instance.

- a070a0c: Every reader of a `@derive` / `@deriving` JSDoc tag uses one parser, `deriveTagNames` (exported
  from `@typesugar/core`), so they agree with the derive macro on what a type derives. Method syntax
  matched the typeclass name anywhere in the tag's comment: with `@derive(Eq)` and a description
  line that mentioned "Show", `p.show()` became `Point.Show.show(p)`, a companion that never
  exists. The TS2339 suppression rule took every word of the comment as a derive name, the
  auto-derive check and std's `Destructure` planner had the same kind of match, and the instance
  scanner dropped the last name of `@derive Eq, Clone` when a description line followed. Tags in
  prose or fenced examples no longer count in any of them.
- 01a547c: `derived<Eq<Array<number>>>()` reported TS9107 for a field named
  `__@unscopables@22`, and `derived<Eq<Map<string, number>>>()` silently
  generated an `Eq` that compared `a["__@toStringTag@35"]`: a built-in type from
  TypeScript's lib was "derived" from its methods and internals. It is now
  TS9106, saying it is a built-in and to use a library's instance (std's) or
  an `@impl` of your own; `summon`'s TS9001 help for one no longer points at
  `derived<...>()`.

  An `@impl` tag on a `derived<...>()` const is compared with the call's type
  argument as types, not as text: an alias of the type (`/** @impl Eq<P2> */`
  with `type P2 = Pt` on `derived<Eq<Pt>>()`) agrees, and the tag's typeclass
  is resolved through imports and aliases.

- 34850dc: `typesugar check` and `typesugar build` accept a direct call to a derived companion
  (`Point.Eq.equals(a, b)`, `Point.Debug.debug(p)`), the form the derive guide documents. They report
  the diagnostics of the program before expansion, where the companion doesn't exist yet, and failed
  with TS2339 ("Property 'Eq' does not exist on type 'typeof Point'") for a class and TS2693
  ("'Point' only refers to a type") for an interface or type alias. A new diagnostic suppression rule,
  `DerivedCompanionAccess`, suppresses these when the receiver's declaration derives the accessed
  typeclass; `Point.Ord` on a type that derives only `Eq` is still an error.
- 291dc90: A type whose derives only generate its companion (`/** @derive(Eq, Clone) */ export interface Vec`)
  can be re-exported by name. `typesugar build` dropped `export { Vec } from "./vec.js"` (and
  `import { Vec } from "./vec.js"; export { Vec };`) from the JavaScript, because `Vec` is only an
  interface in the source, while the `.d.ts` still exported it; a consumer's `a === b`
  (`Vec.Eq.equals(a, b)`) then failed with "does not provide an export named 'Vec'". The emit now
  keeps a re-export whose target, followed through every alias, is a type a derive makes a value.

  Under `verbatimModuleSyntax` and `isolatedModules`, `typesugar check` and `build` no longer report
  TS1484 on `import { Vec }` or TS1205 on `export { Vec } from` for such a type (`export type`, the fix
  TypeScript suggests, would leave the companion out of the JavaScript), and `typeof Vec.Eq` in a type
  position is no longer TS2693. A type without derives is still reported.

  An exhaustive destructuring `match: switch` at the end of a function, whose every case returns or
  throws, is no longer TS2366 ("Function lacks ending return statement") or TS7030 in `typesugar
check` / `build`. A switch a `break` can leave, or whose last case falls off the end, still is.

- 5f9af12: A `derived<TC<T>>()` const whose derivation failed is no longer used as an instance by the
  by-name scope walk either: `= implicit()`'s by-name fallback emitted `same(x, x, eqInner)` with
  `eqInner` the un-expanded stub (only the type-based resolver dropped it). Companion-path
  extraction and do-notation instance lookup go through the same walk. `findInstanceInScopeByName`,
  `findEmittableInstanceByName`, `resolveDoNotationInstance` and `InstanceExtractionContext` now
  take a full `MacroContext`.
- 2694138: `derived<Eq<Readonly<Point>>>()`, `Partial<Point>`, `Record<"a" | "b", number>`,
  `Pick<Point, "x">` and the lib's other utility types were refused as
  "built-in" (TS9106), because the check read the type's alias, which the lib
  declares. It now reads the resolved type's own symbol: only an interface or
  class declared in TypeScript's lib (Array, ReadonlyArray, Map, Set, Date,
  Promise, ...) is a built-in, so the utility types derive from their fields,
  and an alias of a built-in (`type Nums = number[]`) is refused like the
  built-in itself instead of being "derived" from `__@unscopables`. A utility type over a built-in
  (`Readonly<Map<string, number>>`, `Readonly<Set<T>>`, `Partial<Date>`, or an alias of one) is a
  built-in too, TS9106, instead of being derived from the built-in's internals
  (`a["__@toStringTag@24"]`). Decided by the type the utility maps, by symbol: a user interface that
  extends a lib type (`interface AppError extends Error { code: number }`) is not a built-in, and
  `Readonly<AppError>` derives like `AppError` does, though some of its properties are declared in
  lib's `Error`.
- 3ae83a6: The values `@derive(Destructure)` declares (the constructor functions `Point`, `Circle` and their
  instances) can be imported, called and re-exported by name before expansion. Checked as written,
  the source reported `export { Circle } from "./shapes"` and `import { Circle }` as TS2305,
  `Point(1, 2)` as TS2693 and `Circle(2)` in the deriving file as TS2304, so `emitDeclarations` (tsup's
  `withTypesugar`) wrote nothing for an index file that re-exports them. A derive macro can now say
  which names it declares (`generatedNames`), and the `DerivedDeclarationReference` suppression rule
  accepts exactly those. `typesugar build` keeps those names in the JavaScript's imports and
  re-exports, which TypeScript dropped as type-only.
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

- 7d84596: Docs and comments brought in line with the extractor typing, covering-match,
  marker-type and scoping fixes: the fp README's `Some`/`None` output (the
  assertion, no `MatchError`), the std and macros READMEs on when a match has no
  throw, the umbrella README on markers being types, the reserved TS9702 (no
  "automatic"/"explicit" modes in 1.0), and core's prelude, resolution-scope and
  `ResolutionConfig` comments (the mode and prelude are not read).
- 592d66b: An enum value resolves the enum's own instance before the primitive's: `Color.Green.show()`,
  `c.show()` on a `c: Color` narrowed to one member, and `show(c)` through `= implicit()` used
  `@impl Show<number>` beside an `@impl Show<Color>`, because an enum member's type is mutually
  assignable with `number` and was matched before being widened to its enum. Resolution now looks
  for an instance declared for the enum itself (by symbol) first, in every scope, and falls back to
  the primitive's only when the enum has none. `@impl Show<Color>` on an enum generates no
  `Color.Show` companion and no longer warns "'Color' is not declared in this file": a companion
  merged into the enum object overwrote a same-named member (`Op.Eq` beside `@impl Eq<Op>`) and
  appeared in `Object.values(Status)`. The instance resolves by its declared type without one. An
  enum member passed where an instance is expected (`log(Op.Eq)`) is no longer taken for the
  `Eq<Op>` instance by its dotted name.
- eb77b03: `extend(value).method(args)` falls back to the ordinary method-call rewrite when no typeclass
  instance or registered extension matches: it used to emit a new `value.method(args)` node that the
  visitor never rewrote, so `extend(150).clamp(0, 100)` with std's import-scoped `clamp` became
  `150..clamp(0, 100)` and threw at run time. On an unconstrained type parameter it is now an error
  that says to take the instance as a parameter (`S: Show<T> = implicit()`), instead of a silent
  `x.show()`. `const e = extend(x)` stays an error by design (extend() compiles to a direct call, so
  there is no wrapper value), and its message now names the value and method and says what to write
  instead. Import-scoped extensions are also found for a call a macro rebuilt with `factory.update*`.
- 4ca9f31: A `"use extension"` file's self-registration calls type-check under `noImplicitAny`. They were
  emitted as `globalThis.__typesugar_registerExtension?.(...)`, which is TS7017 where the hook is
  declared nowhere, so `typesugar check --strict` reported every exported extension of
  `@typesugar/std` and `@typesugar/graph`. They are now `(globalThis as any).__typesugar_registerExtension?.(...)`,
  like the companion registry's calls.
- 0435dc6: Instances for types you don't own (a library type such as `Feature` from
  `@types/geojson`), written in your own module and imported, now resolve
  everywhere:
  - An `@impl Clone<Feature>` for a generic whose type parameters all have
    defaults matched `summon<Clone<Feature>>()` but not a value typed `Feature`,
    so `implicit()` and `f.clone()` (with a bare `import "./instances"`) missed
    it. The bare name now matches its default instantiation.
  - `implicit()` resolves its instance by the inferred type, not only by its
    printed name (`Feature<Geometry, GeoJsonProperties>` never matched
    `Feature`).
  - `summon` in an instance's own initializer no longer resolves to that
    instance (`const cloneFeature = cloneFeature`, a ReferenceError at load), so
    `/** @impl Clone<Feature> */ export const cloneFeature =
summon<Clone<Feature>>();` derives it once, for importers to use.

  TS9101's explanation and the error-messages guide no longer tell you to wrap
  a library type in a newtype; they point to the typeclasses guide's new
  "Instances for types you don't own" section.

- bec2d2b: An inlined operator chain no longer moves a side effect in front of an earlier read. In
  `pv + (bump() + bump())`, the two `bump()` calls were bound to `const`s before the statement
  while `pv` was read in it, after them, so a `bump()` that reassigned `pv` changed the result
  (`{ x: 1000, y: 1000 }` instead of `{ x: 1, y: 10 }`; likewise `this.pos + (this.step() +
this.step())`). An operand with side effects is now hoisted only when nothing in the statement
  is evaluated before it except literals, `this` and `const` names (checked through the type
  checker); otherwise that level is applied as a function call in place. Hoisted `const`s also
  go after the statement's leading comments now, with a JSDoc comment staying on the statement.
- fbf4ef1: `@impl TC<T>` for a type declared in another file or package no longer warns "no 'T.TC'
  companion generated". It is how every instance for a type you don't own is written (effect's
  `@impl FlatMap<Effect>`, fusion's `@impl Functor<LazyPipeline>`), nothing at the `@impl` can
  change it, and a `T.TC` written anywhere is a TypeScript error where it is written. The warnings
  that the `@impl` can act on stay: a class declared after the instance, a const or ambient enum,
  a type that is not a plain name.
- 8b4060d: Diagnostics suggest `/** @impl Typeclass<Type> */` for a hand-written instance. The
  "no instance" help used to say "provide @instance Eq<Color>", and a bare `@impl` said
  `@impl("Type")` / `@impl(Typeclass, Type)`: decorator forms, which TypeScript rejects
  on a `const`.
- 75f1968: `@impl` on an unannotated HKT instance keeps the instance's own type. It used to annotate the
  const with the typeclass's expanded type, which dropped every member the typeclass doesn't declare
  (`_tag`, `orElse` on `@typesugar/fp`'s `flatMapOption`) from its type and from the `.d.ts` emitted
  from the expansion, and made `typesugar check --strict` report them as excess properties. The
  initializer now `satisfies` the expanded type intersected with an index signature: an extra member
  is allowed, a missing or misspelled one is still an error at the instance (`check`, `build` and
  the editor report it),
  unannotated method parameters are still typed from the typeclass, and so is `this` in an
  object-literal method (`this.map(...)`). An instance for a type-level function with its own parameter (`@impl
FlatMap<EitherF>`, where `EitherF<E>` fixes `E`) or for a type with more than one unfixed parameter
  gets no expanded type, instead of a wrong one (`EitherF<A>`, `Either<A>`).
- e016c8d: An `@impl` tag naming a type through a namespace import,
  `/** @impl Eq<geo.Point> */ export const eqGeo = derived<Eq<geo.Point>>();`
  with `import * as geo from "./geo"`, was an error saying the tag should be
  `@impl Eq<geo.Point>`: the tag's name was looked up whole in scope. A
  qualified name is now resolved through the checker, segment by segment.
- 624d80a: `implicit()` with literal arguments, `max(3, 7)` for
  `max<A>(a: A, b: A, O: Ord<A> = implicit())`, was TS9001 "No instance found
  for `Ord<3 | 7>`" (with help to `@derive(Ord)` on `3 | 7`). The instance is
  now looked up for the literal type's base type (`Ord<number>`), widened by
  the checker, as method syntax already does for a literal receiver.
- e0ba26b: An imported typeclass instance is an extension provider only for its own type: with a numeric
  enum `Color` and `import { showColor }` (an `@impl Show<Color>`), `n.show()` on `n: number`
  became `showColor.show(n)`, because `number` is assignable to `Color`. The receiver must now be
  the instance's type by identity (literal receivers such as `Color.Red` are widened first); other
  imported objects are unaffected. `InstanceScanner.scanValueDeclaration` reads one value
  declaration as an instance, and `isTypeclassDeclared` is exported.
- 4b0d84d: An `@impl` instance's method is inlined into another module only where every name its body uses
  resolves there to the same declaration. `ordNumber.eqv(NaN, NaN)` in a file that imports only
  `ordNumber` compiled to `compareNumber(NaN, NaN) === EQ`, a ReferenceError at run time, because
  `@impl` registered its methods without the symbols their names resolve to and the call site
  accepted any name that resolved to nothing. Such a call now goes through the instance and warns
  TS9602 naming the identifier. A type name in an inlined body that doesn't resolve to the same type
  at the call site is written through an import type, and the method's own type parameter as the call
  instantiates it, so the expansion type-checks under `typesugar check --strict`.
- 76af80e: An inlined instance-method call no longer narrows its argument to `never`.
  `destructureCons.extract(Nil)` inlined as `(Nil != null ? [Nil.head, Nil.tail] : undefined)`, and
  with `Nil: null` the test narrowed `Nil` to `never`, so `typesugar check --strict` reported
  `Nil.head`. A call whose argument the checker finds narrower than its parameter, and whose body
  reads that parameter more than once, now goes through the instance; one that reads it once is
  inlined as before.
- ac891d1: An inlined `@impl` method no longer writes `any` for a type the call site can't name.
  `mkP.make(1)`, where the call site doesn't import `P`, inlined as `({ x: 1 }) as any`, so the
  emitted `.d.ts` said `p: any` (the source says `P`) and the expanded type check saw nothing. Such
  a type is now written through an import type (`import("./ord.js").P`), and the method's own type
  parameter as the call instantiates it (`o as unknown as number`); one that can't be named at the
  call site (a type private to the instance's module) keeps the call going through the instance. An argument narrower than its parameter (`extract(Nil)`) that
  the body reads more than once is no longer asserted as `any` either: that call goes through the
  instance.
- c7fb29f: Instance resolution prefers the instance declared for the type itself over one for a type of the
  same structure. Two classes with the same fields (`class UserId { constructor(public value: string) {} }`
  and an `Email` of the same shape) are assignable to each other, so with both `@derive(Eq)`'d,
  `===` on two `UserId`s, `summon<Eq<UserId>>()` and `implicit()` failed with "Ambiguous Eq instance
  for type 'UserId': UserId.Eq, Email.Eq". The tie is now broken by symbol identity; a structural
  match still resolves a type that has no instance of its own.
- 508c7d3: The instance scanner no longer swallows a type-checker failure: a module whose exports can't be
  read, a re-export whose alias can't be followed, an instance type that can't be resolved (matched
  by name only), a `@derive`'d type's companions and a type an `@impl` tag names are each reported
  once as a warning (at the use site's file when the failure is in another file).
- eb6e5a8: A library's `@derive` companions are found by its consumers. `/** @derive(Eq) */ export interface
Point` in a published package used to be invisible from its `.d.ts`: a consumer's `p1 === p2` stayed
  a reference comparison and `summon<Eq<Point>>()` derived a second instance with TS9009. The instance
  scanner now reads an exported type's companions (`Point.Eq`) from its `@derive` tag, and each
  generated companion carries an `/** @impl Eq<Point> */` tag that declaration emit keeps (the
  decorator form leaves no `@derive` in a `.d.ts`). Operators, `summon`, `= implicit()` and method syntax
  resolve them like any other instance, through the type's own binding (`import { Point
as P }` gives `P.Eq`). The same works between two source files of one program, whichever is
  transformed first.

  The scanner no longer takes a function or class for an instance because its JSDoc shows an `@impl`
  example (typesugar's own `impl()` declaration made `= implicit()` pass `impl` as an `Eq<Point>`), and
  ignores `@impl`/`@derive` tags in prose and fenced examples. A macro error on a JSDoc tag's
  arguments no longer crashes the CLI's diagnostic printer.

- 6659c44: An operator, `summon` or `implicit()` above its type's `@derive` declaration
  in the same file didn't find the companion: the local scope only saw it once
  the derive had expanded. `function f(a: P, b: P) { return a === b; }` before
  `/** @derive(Eq) */ interface P` was a TS9001 pointing at a derive that had
  succeeded (and `summon<Eq<P>>()` derived a second instance in place, TS9009).
  The local scope now reads the file's `@derive` annotations as the import scan
  reads another file's, so both orders compile to `P.Eq`, when the use is inside
  a function that can only run later: one bound to a name (a function
  declaration, `const f = () => ...`, a class member) that nothing above the
  declaration calls, except another such function. A use that can run before
  the companion is assigned (module top level, an immediately invoked function,
  a callback passed to a call at top level such as `xs.filter(v => v === q)`, a
  function called above the declaration, and a class's definition-time code:
  a static initializer or static block, a computed member name, a decorator,
  or a member a decorator receives) is still TS9001, saying so and to move the
  declaration up; it is never rewritten to a `P.Eq` that would throw. A
  reference to a class at definition time (from its own static parts, `this`
  in them included, or from code above the declaration) runs only what it
  runs: `new C()` runs the constructor and instance initializers, `C.m()` or
  `new C().m()` runs `m`, a member referred to directly may be called, and the
  class or an instance handed to other code may have any member called; so
  `static shared = new C()` or `static kind = C.name` leaves `C`'s methods
  rewritten, while `static early = new C().same(a, b)` makes `same` TS9001.
- f4ffc81: `typesugar check`/`build`: a fluent `match()` pattern name that shadows an outer declaration is
  no longer checked as that declaration. In `function len(s: Seg) { return
match(s).case({ kind: "line", len }).then(len + 1)… }`, TypeScript checked `len + 1` against
  the function `len` before expansion and reported TS2365, though the arm's `len` is the
  `number` the pattern binds. The MacroCallChain rule now hides the errors that come from the
  outer declaration's type for a name the arm binds (as ComprehensionBlock does for
  do-notation), on the name, a member/call chain starting at it, or a binary expression it is
  an operand of. The chain's expansion is still type-checked, so a wrong use of the binding
  (`len.toUpperCase()`) is reported at the line you wrote.
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
- 914817e: `typesugar check`/`build`: a fluent `match()` whose arm result uses a pattern name that shadows
  an outer declaration no longer fails on the chain's result type. With the default lib, in
  `function label(u: U): string { return match(u).case({ kind: "user", name }).then(name)… }`,
  `name` was typed, as written, from DOM's `name: void`, and the `return` was TS2322 (likewise a
  local function `len` in `.then(len)`, and `const v: number[] = xs.map((x) => match(…)…)`). The
  MacroCallChain rule now hides that assignability error, and the expanded check reports it where
  it was if the expansion's type is wrong too. The expanded check now also covers where a chain's
  value meets a declared type (`return`, a typed declaration, an argument), so a wrong result type
  built from pattern names (`.then(nm)` returning a `string` from a `number` function) is reported;
  before, it went unchecked. An error on a `return` the expansion rebuilt is reported at that
  `return`, not at the enclosing function's first line.
- 05dbbcb: `typesugar build` hid a TS2339 that `typesugar check` reported, for a method
  call the transformer then left as written (a TypeError at run time):
  `import "@typesugar/std/syntax/eq"; const m: number = 7; m.equals(7)` with no
  `Eq<number>` instance imported was suppressed because a built-in intrinsic
  existed, and `p.equals(q)` on a `@derive(Eq)` type was suppressed in a file
  that never activated Eq method syntax. The suppression now decides as the
  rewrite does: method syntax active in the file (an activation import or the
  typeclass defined there), and for a primitive receiver an instance resolved
  from scope (literals widened by the checker).
- dade880: An `@opaque` type declared in one file of a project is erased in every other file whichever is
  transformed first. Its rewrite used to be registered only when the declaring file was transformed,
  so `typesugar expand use.ts`, the language service or a bundler that reached the consumer first left
  `a.map(f)` a method call on what is really `A | null`. Every `@opaque` interface of the program is now
  registered before the first file is transformed (where the macro would run: the tag starts a line and
  the file imports typesugar). The companion functions are imported the way the consumer imports the
  declaring file (`./opt.js`), or by a relative path, not by the declaring file's absolute `.ts` path.
- d0392e0: `typesugar check` and `typesugar build` no longer fail on a rewritten `*`, `/`, `-` (or `%`, `**`):
  TypeScript reports `a * b` on two objects as TS2362/TS2363, which the OperatorOverload filter
  (TS2365 only) never covered, so the operators guide's headline example (`a * b; a / b; a - b` on
  rationals) exited 1 although the emitted `numericRational.mul(a, b)` is correct. Those are now
  dropped exactly where the operator is rewritten, decided as the rewrite decides it (shared
  `operator-chain-types`: both operands typed as rewritten, one instance from scope, a right operand
  that fits). A new RewrittenOperatorResult filter drops the knock-on TS2345/TS2322 when a rewritten
  operator's value (or an unannotated same-file `const` bound to one) is passed or assigned where its
  rewritten type fits (`rationalToString(product)`). The rewrite also treats such a const as an
  operand of its rewritten type: `const p = a * b; p + c` was left as JavaScript's `+`.
- babbb30: Chained typeclass operators are rewritten: `a + b + c` on rationals compiled
  to `numericRational.add(a, b) + c`, a string concatenation
  (`"[object Object]..."`), because TypeScript types `a + b` on objects as an
  error and the outer `+` saw no instance. An operator whose method returns the
  typeclass's own type parameter (`add(a: A, b: A): A`, recorded in the op
  index as `resultIsSelf`) now gives its expression that type, so
  `a + b + c` is `add(add(a, b), c)` and `a + b < c` is
  `lessThan(add(a, b), c)`. A method returning anything else ends the chain. Either operand can be such an expression,
  so `a + b * c` is `add(a, mul(b, c))` and `a - (b - c)` is `sub(a, sub(b, c))` (the right operand
  was typed by TypeScript, `number`, and reported as "right operand must also be"), and the chain is
  typed with an explicit stack, not recursion, whichever way it nests.
- 4f6ad83: PEP-034: Unified SFINAE registration and shared IDE infrastructure
  - Unified all SFINAE rule registration into `registerAllSfinaeRules()` to prevent drift between IDE paths
  - New `@typesugar/lsp-common` package with shared position mapping, AST helpers, and macro code actions
  - Added `getApplicableRefactors` and `getCompletionEntryDetails` to the TS plugin language service
  - Diagnostic parity test suite exercising all 6 SFINAE rules
  - Zed extension workspace detection (only starts LSP for typesugar projects)

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

- 48b621b: PEP-052 Wave 5: `Show` method-sugar activation, and a latent
  `resolveTypeString` bug fix.
  - NEW: `Show`'s interface now carries `@typeclass`, and a new
    `@typesugar/fp/syntax/show` marker (`@syntax-methods Show`) activates
    `.show()` method sugar — mirroring how Eq/Ord's method syntax is gated.
    `Show` has no operator form, so there is only one activation tier.
  - FIXED: `resolveTypeString` (used by the instance scanner to resolve
    `@impl <TC><Type>` type strings) silently resolved the `symbol`/`unknown`/
    `object` keyword types to `any` on some `ts.TypeChecker` configurations
    (an unbound synthetic node quirk), which — because `any` is bidirectionally
    assignable to/from everything — could make two unrelated instances
    (e.g. `@impl Show<symbol>` and `@impl Show<number>`) spuriously report as
    "ambiguous" for every other type. Every keyword type string now resolves
    through the checker's internal intrinsic getter (`getESSymbolType`,
    `getUnknownType`, `getNonPrimitiveType`, etc.) instead of an unbound
    synthetic node, and the fallback path is hardened so any keyword resolving
    to `any` (other than `any` itself) is treated as unresolvable rather than
    silently wrong.
  - FIXED: `@typesugar/fp`'s `package.json` had `"sideEffects": false`, which
    could let an aggressive bundler drop the new marker's bare side-effect
    import. Flipped to `true`, matching `@typesugar/std`'s existing markers.

- 57d76a1: PEP-052 Wave 7: primitive typeclass intrinsics (`eqNumber.equals` → `===`,
  etc.) are no longer hand-written source strings — they're reflected from
  `primitives.ts`'s real, live implementations, so the two can never drift
  apart again.
  - FIXED: two real bugs found while auditing the hand-written strings against
    `primitives.ts`'s actual bodies. `showString.show` used an unescaped
    template literal instead of `JSON.stringify`, producing broken output for
    any string containing a quote or backslash. `ordString.compare` used
    `.localeCompare`, which is locale/ICU-dependent and non-deterministic
    across environments, instead of a plain lexicographic comparison.
  - CHANGED: `hashNumber`/`hashBigint` no longer inline to a crude stand-in
    (`a | 0`, a lossy bitmask) at compile time — their real implementations
    (NaN/Infinity-aware, guaranteed-unsigned hashes) call another primitive as
    a helper, which is only safe at runtime, not when inlined verbatim into a
    caller that doesn't have that helper in scope; a registration-time safety
    check now correctly declines to inline these, falling through to a real
    function call instead. `hashString` (self-contained) still inlines-eligible
    at registration but isn't inlined either, for the orthogonal reason its
    loop body is too complex for the existing inlining pass. Runtime behavior
    when not inlined was already correct; only the compile-time inlining
    optimization for these is affected.
  - REMOVED: `DictMethod.source` and `inlineMethod`'s string-parsing fallback
    — every registered method is now a real AST node.

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- 2fb4b62: Fix: `summonAll` is now importable. It is a registered macro that declares
  `module: "typesugar"` and is documented as public API, but it shipped with no
  runtime stub and no facade export — so `import { summonAll } from "typesugar"`
  failed to type-check and the feature was unusable.
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

- e0694af: `assert(p === q)` on a type with an `Eq` operator printed an empty diagram
  (`__powerAssertFail("p === q", [], …)`): the operator rewrite passes copies of
  the operands, which have no source position, so nothing was recorded. A copy
  is now drawn at the column of the source expression it copies, so the diagram
  shows `p` and `q`. That includes an in-file instance whose method is inlined
  (`p.x === q.x`): an inlined argument keeps its link to the caller's source
  node when that node is in the file being transformed.
- 95b6631: `typeInfo<Box<number>>()` reports an optional parameter written in terms of the type's parameter
  instantiated: `set(v?: T)`'s `v` is `"number"`, not `"T"` (an optional field `label?: T` is
  `"number"` too, without the `undefined` its optionality adds). `fieldNames<T>()` lists the fields
  `typeInfo<T>().fields` lists, without the type's methods (`fieldNames<Box<number>>()` was
  `["label", "value", "set", "get"]`). A method whose signature the type checker fails on is left out
  of `typeInfo<T>().methods` with a warning naming it, instead of silently.
- f471698: `typeInfo<T>()` drops the `undefined` an optional field or parameter's optionality adds from any
  union, not only when one other type is left: `typeInfo<Box<boolean>>()` reported `label?: T` as
  `"boolean | undefined"` and `Box<string | number>`'s as `"string | number | undefined"`, where the
  non-generic forms are `"boolean"` and `"string | number"`. An `undefined` the declaration writes
  itself (`maybe?: T | undefined`) is kept.
- 5da6803: `typeInfo<T>()` is typed as `TypeInfo`, the shape the macro emits: its runtime stub declared
  `{ name; fields: { name; type }[] }`, so `info.kind` and `field.optional` were type errors. An
  optional field's `type` is its declared type (`age?: number` is `"number"`, with
  `optional: true`), as the guide shows, not the `"number | undefined"` the checker gives an optional
  property under `strictNullChecks`; a field of a generic declaration (`value?: T`) still shows its
  instantiated type. The reflect examples run again (`validator<T>()` returns
  `{ success, value } | { success: false, errors }`).
- 51a72ca: `typesugar check` no longer hides real errors next to a rewritten operator. A
  `DiagnosticSuppressionRule` can now report `replacementDiagnostics` in place of a diagnostic it
  suppresses (identical ones are reported once; if computing them throws, the original is kept).
  `RewrittenOperatorResult` uses it to re-check the arguments after a rewritten `a * b`, since tsc
  reports only a call's first failing argument: `g(a * b, 5)` with a `string` parameter is now
  an error at `5`. `OperatorOverload` uses it to report a rewritten value used as a number, which
  TypeScript (typing `a * b` as `number`) accepts and which threw at run time:
  `(a * b).toFixed(2)` (TS2339), `const n: number = a * b` (TS2322, also for `+`), a `number`
  argument (TS2345), and `a * b > 0` when `>` isn't rewritten (TS2365).
- 616d213: `typesugar check` judges an overloaded call by all its overloads when an argument is a rewritten
  operator. TypeScript resolves `f(a * b)` against the overload that takes the `number` it sees,
  so with `f(x: number): string; f(x: Rational): Rational` check invented a TS2345 ("Rational is
  not assignable to number") and kept TypeScript's TS2322 for the `string` result, although the
  compiled `f(numericRational.mul(a, b))` is the `Rational` overload. Now a call some overload
  takes with its arguments as rewritten has no error (and has that overload's return type), a call
  none takes is TS2769 "No overload matches this call", and the re-check of the arguments after a
  rewritten one does the same.
- dca9c00: A type-checker failure while looking for a same-file `@derive` companion (a use above the
  declaration) is now a warning naming the declaration it skipped, instead of being swallowed.
- d7b3911: - `summon<Eq<X>>()` no longer resolves to a same-file `derived<Eq<X>>()` const
  whose derivation failed (it emitted `const s = m` with `m` the un-expanded
  stub). A failed `derived<...>()` is not an instance, wherever it is declared
  relative to the use.
  - Deriving finds the type by identity: the symbol the type reference resolves
    to, not a lookup of its name at the top of the file, so `summon<Eq<Point>>()`
    in a function with its own `interface Point` (or `Range`, beside the DOM's)
    derives that type, and `derived<Eq<geo.Point>>()` through a namespace import
    works.
  - One instance reached through two import bindings (`import { Vec }` from one
    module, `import { Vec as V2 }` from another that re-exports it) is one
    instance, not "Ambiguous Eq instance for type 'Vec': Vec.Eq, Vec.Eq".
- e40c7e3: `typesugar check` hides a TypeScript error only where the build rewrites the code:
  - The ExtensionMethodCall rule calls the transformer's own import-provider decision
    (`findImportedExtensionMatches`, now in `@typesugar/macros`) instead of its own copy, which
    lacked the checks for an unopted module namespace, a default-lib member (`.call`, `.bind`), a
    `declare global` stub and a typeclass instance for another type, and hid TS2339 on calls the
    build left as written (a TypeError at run time).
  - A union instance (`@impl Describe<Shape>`, `type Shape = Circle | Square`) serves a receiver
    narrowed to its members (`if (t.kind === "circle") t.describe()`); the call was left as written.
  - The OperatorOverload rule's TS2365 check is the rewrite's decision (`operatorRewriteResult`): a
    const bound to a rewritten operator (`const p = a * b; p + a`) and a narrowed operand of a
    union instance are no longer reported, and a primitive is decided by the type's flags, not its
    printed name. The rewrite and the filter try the same declared types for a narrowed operand.

- 0c9202a: `summon` and `implicit()` find a typeclass's own instances when the file
  reaches the typeclass through a re-export: `import type { Ord, Eq } from
"typesugar"` names `@typesugar/std`'s `Ord`, and `summon<Ord<number>>()` was
  TS9001 because the file doesn't import `@typesugar/std`, where `ordNumber`
  is. The package that declares the typeclass is now searched last, as if the
  file imported it, and the instance is imported from it. `implicit()` compares
  the typeclass by identity too (a renamed import, `Eq as Equal`, works).

  The TS9001 help no longer tells you to add `@derive(Eq)` to a primitive (it
  says the instance has to come from a module) or to import a typeclass the
  file already imports.

- 5cc34d9: With `import type { Show } from "typesugar"` (which is `@typesugar/fp`'s
  `Show`), `summon<Show<number>>()` and `implicit()` were TS9001: the search of
  the typeclass's own package scanned its root exports, and fp exports its
  instances only inside a namespace (`TC.ShowOps.showNumber`). That search now
  also enters the package's namespace re-exports (by symbol, up to three deep)
  when the root has no match, and imports the namespace (`TC`). The TS9001 help
  for a primitive no longer says only `@typesugar/std`'s typeclasses come with
  instances.
- 8204470: Fixes found with instances for types you don't own (Turf case study):
  - An instance whose method calls a macro (a recursive `clone: (t) => ({ ...t,
children: t.children.map((c) => summon<Clone<Tree>>().clone(c)) })`) was
    inlined at call sites from its unexpanded source, leaving the raw `summon`
    call in the output ("summon is not a function" at run time). Such a method
    is no longer inlined; it is called through its dictionary.
  - `implicit()` auto-specialization emitted the specialized copy's parameters
    without types (`a => ...`), so the expanded TypeScript failed
    `noImplicitAny`. An annotation that names a type parameter now gets the
    call's type (`(a: Feature): Feature => ...`), and each instantiation gets
    its own copy. The specialization cache is also keyed by a stable function
    identity, not the checker's lazily assigned `symbol.id`, which could change
    between two calls of one function (or be 0 for two different ones).
  - Derived `Eq` rejected a field typed with an alias of an array or tuple
    (`Position`, `BBox` from `@types/geojson`, F12), because the field check
    read the type's text. The check now runs the same code that generates the
    comparison, which compares arrays, tuples and unions of them element by
    element; a nullable field's exact instance (`Eq<GeoJsonProperties>`) is
    used when one is in scope; and a sum type's variant fields are compared
    through locals of the variant's type, so each comparison is type-checked.
  - A union-typed field with a `Clone` instance in scope (`derived<Clone<Geometry>>()`)
    is cloned through it instead of being re-derived inline.
  - Deriving for a type exported from the same file (`export class Box<T>`)
    found no type to derive from.

- c1e797e: `typeInfo<T>()` reports methods. `TypeInfo` declares `methods`, but the emitted literal had none,
  so `typeInfo<Calculator>().methods` was `undefined` and the methods were listed as fields. A
  class's methods and an interface's method signatures now go to `methods`, with each parameter's
  name, type and optionality and the return type as the type checker gives them (as the `@reflect`
  class metadata already does); a function-valued property stays a field.
- 6edd688: `validator<T>()` validates a primitive or literal `T`

  `validator<string | number>()` emitted an object validator: it failed any value
  that was not an object ("Expected object, got string") and then checked the
  apparent members `toString`, `valueOf` and `toLocaleString`, so it rejected
  every value the type allows. A `T` whose members are all primitives or
  literals (`string | number`, `"a" | "b"`, `boolean | undefined`, an enum) is
  now checked as a whole, failing with `Expected string | number, got object`.
  Object types are validated as before.

- 615d4c1: A chain of inlined typeclass operators (`a + b + c + d` on a product type) is one expression:
  `({ x: ((a.x + b.x) + c.x) + d.x, y: ... })`. Beyond the first level, each level used to be applied
  as an IIFE over the previous level's object (`((a, b) => ({ ... }))(({ ... }), c)`), because the
  inliner can't substitute an object literal its body reads twice. It now reads each property's
  initializer where the body reads `p.x`. A value read more than once (a rational's denominator)
  or an operand with side effects is bound to a `const` just before the statement when the chain
  is evaluated first in it; elsewhere that level stays a function call. Operands are still
  evaluated once, in order.
- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [4d4ce68]
- Updated dependencies [f8dcade]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [c5ebf64]
- Updated dependencies [d79d995]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7d84596]
- Updated dependencies [3460709]
- Updated dependencies [0435dc6]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [c9a1e3e]
- Updated dependencies [4b0d84d]
- Updated dependencies [977888e]
- Updated dependencies [283fe78]
- Updated dependencies [eb6e5a8]
- Updated dependencies [0780883]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [4f6ad83]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [563e46b]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [93ea406]
- Updated dependencies [51a72ca]
- Updated dependencies [cf7c08b]
- Updated dependencies [2f1744b]
  - @typesugar/core@0.2.0

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
