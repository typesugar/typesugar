# @typesugar/transformer-core

## 0.2.0

### Minor Changes

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

- 3709f72: Macro identity is (module, export name); validate's `assertType<T>()`; `is<T>(value)`
  - **`@typesugar/core`** (behaviour change, PEP-060 item 8): a macro that declares a `module`
    is now identified in the registry by its kind, `module` and `exportName ?? name`, not by
    its bare name. Two packages can register macros with the same name and both stay loaded.
    Before, the second registration threw "… is already registered" (or, between two
    `@typesugar/*` modules, was silently dropped), so whichever package loaded second lost
    that macro and every macro it registered after it. Registering the same definition again
    (an ESM/CJS or src/dist copy) is still a no-op. A different definition under one identity
    still throws, and so do two different module-less macros of one name and two macros
    claiming one labeled-block label. The bare-name getters (`getExpression(name)` and the
    others) return the module-less macro of that name, else the only macro of that name,
    else `undefined` when several modules provide it. They no longer return whichever loaded
    first. New: `getCandidates(name, kind)` and an optional `kind` argument on
    `getByModuleExport`. `getAll()` lists each macro once.
  - **`@typesugar/transformer-core`**: a call resolves to the macro of the module its import is
    declared in (named, aliased and namespace imports). The import-literal fallback for
    synthetic or detached nodes now picks by the import's module and imported name, and an
    import from `typesugar` that matches two packages' macros is left unexpanded with a
    warning rather than picking one. `@derive` names, JSDoc tags and decorator expand-order
    lookups use the file's imports when several modules provide a name
    (`lookupMacroByName`). `resolveModuleSpecifier` reads the package from the last
    `node_modules/` segment, so pnpm store paths (`node_modules/.pnpm/…/node_modules/@scope/pkg`)
    map to the package and not to `.pnpm`.
  - **`@typesugar/transformer`**: a `__typesugar_macros__` package with one conflicting macro
    still registers the rest and reports the conflict as a load warning.
  - **`@typesugar/validate`**: its macros now declare `module: "@typesugar/validate"`, so
    `assert<T>()` coexists with `@typesugar/testing`'s `assert(cond)` (also on the
    playground, which now preloads validate). New `assertType<T>()`, an alias of
    `assert<T>()` (the typescript-is and typia name), for files that import testing's
    `assert` as well. `is<T>(value)`, `assert<T>(value)`, `assertType<T>(value)` and
    `validate<T>(value)` now check `value` immediately (typia's form). Before, the argument
    was silently dropped and the call returned the checker function, so `if (is<T>(x))` was
    always true. More than one argument is a compile-time error.

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

- e274769: PEP-052 Wave 8: unified the two pipelines' JSDoc/decorator macro dispatch —
  `@typesugar/transformer` now delegates to `@typesugar/transformer-core`'s
  shared implementation instead of keeping its own ~875-line copy.
  - FIXED: `@typesugar/transformer-core` silently ignored `@deriving`/`@derive`
    JSDoc tags ("unknown JSDoc macro tag" warning) and silently no-op'd real
    `@derive(...)` decorators — PEP-032 deleted the standalone `derive`
    attribute macro, and neither of transformer-core's dispatchers had the
    special case routing it to the real derive registry instead. Both fixed.
    `@adt` is now recognized as a JSDoc tag too (it was missing from the tag
    map entirely).
  - FIXED (transformer-core only, found while porting): `expandDeriveDecorator`
    was missing the `TS9101`/`TS9103`/`TS9104` diagnostic checks (non-derivable
    field types, union without discriminant, empty types) and source-map
    preservation for derive-generated statements that `@typesugar/transformer`
    already had. `extractTypeInfo` was missing a method/accessor skip check,
    so it could incorrectly count a class's methods as derivable data fields.
    Both ported into the shared implementation.
  - REMOVED: `@typesugar/transformer`'s private copies of the JSDoc tag map,
    dispatcher, decorator parsing/sorting, and derive-expansion logic — all
    now delegate to `@typesugar/transformer-core`.

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

- 855eb1f: PEP-053 Wave 3: one specialization pipeline. The legacy transformer's private
  clone of the specialization pass (~700 lines) is deleted in favor of the
  shared implementation in `@typesugar/transformer-core`, now exported from its
  package index. Production paths (ts-patch, unplugin, CLI, LSP) and the
  playground run the same code.

  Unification deltas (all in the direction of correctness): hoisted
  specializations of generic functions no longer carry parameter type
  annotations that reference stripped type parameters; void-returning functions
  no longer emit a spurious `[TS9602] no return statement` skip warning; inlined
  derived-instance calls strip comment trivia in both pipelines (previously
  legacy-only).

### Patch Changes

- de93aa3: Macros inside `assert(...)` expand. The argument used to be instrumented before the macros in
  it ran, so `assert(showAll(xs, summon<Show<number>>()) === "…")` compiled to
  `(values[i] = summon)()` and threw "summon() must be processed by the typesugar transformer" at
  run time, and `extend(x).m()` / extension methods inside it were skipped. Expression macros can
  now set `expandArgumentsFirst: true` to receive their arguments already expanded; `assert` does,
  and instruments the expanded expression (the diagram still shows the values of the parts of the
  source the expansion kept).
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
- 2543157: A left-nested binary chain deeper than about 2,000 levels (a long string
  concatenation or arithmetic line, as generated code has) failed with
  "Transform failed: RangeError: Maximum call stack size exceeded": the macro
  visitor recursed once per level, as did hygiene's binding scan, the pipeline's
  source-map walk and its scratch-token pass. They now walk such chains with a
  loop (same steps, same order, same output), and the operator rewrite rejects an
  arithmetic operand before the checks that walk up the node's ancestors. A
  20,000-term concatenation transforms in well under a second; plain tsc handles
  that depth too. `@typesugar/core` exports the iterative walker,
  `forEachDescendant`. In a file with a macro expansion
  too: the import cleanup's reference scans and the source map's output-token pass recursed
  once per level and overflowed on such a chain.
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

- d79d995: `/** @derive(Eq) */` on an `enum` was silently ignored; it is now TS9102, like
  `@derive` on a `const` or a function (another macro tag on an enum warns that it
  was ignored).

  Documentation that mentions `@derive` no longer trips TS9102: on a declaration
  `@derive` can't apply to (a derive macro's own `const`), a `@derive(X)` line
  followed by prose (`@derive(Read) — derives a Read instance`) is documentation,
  and a macro tag after an `@example` tag (`@example` then `@derive(Validation)` on
  its own line) is example code, like one in a fenced example. A bare
  `@derive(Eq)` line on a `const` is still TS9102.

- 0b5bcf8: `@derive` on something that is not an interface, class or type alias is error TS9102 at the tag,
  with help that points at `derived<TC<T>>()` for a variable. A JSDoc `@derive` on a `const` used to
  be ignored without a word, and one on a function only warned.
- a070a0c: Every reader of a `@derive` / `@deriving` JSDoc tag uses one parser, `deriveTagNames` (exported
  from `@typesugar/core`), so they agree with the derive macro on what a type derives. Method syntax
  matched the typeclass name anywhere in the tag's comment: with `@derive(Eq)` and a description
  line that mentioned "Show", `p.show()` became `Point.Show.show(p)`, a companion that never
  exists. The TS2339 suppression rule took every word of the comment as a derive name, the
  auto-derive check and std's `Destructure` planner had the same kind of match, and the instance
  scanner dropped the last name of `@derive Eq, Clone` when a description line followed. Tags in
  prose or fenced examples no longer count in any of them.
- 16bf668: A `/** @derive(Meta) ... */` tag followed by description lines derives just its list: a JSDoc
  tag's comment runs to the next tag, so the prose became part of the list ("Unknown derive:
  '(Meta)\nUser table schema ...'"). Only the parenthesized list, or the comma-separated names that
  start the tag, are read.
- d8d3736: Docs: the recommended build paths are a bundler plugin (`unplugin-typesugar`, or
  `withTypesugar()` from `typesugar/tsup`), `typesugar build` in place of `tsc`, and
  `node --import typesugar/register` for running files. ts-patch is documented as an
  alternative for a plain `tsc`, not as a required step. The transformer README and
  the AI-assistant context `typesugar init` installs (`ai/AGENTS.md`, the typesugar
  skill) say so; the transformer-core README no longer calls the transformer a
  ts-patch plugin.
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

- eb77b03: `extend(value).method(args)` falls back to the ordinary method-call rewrite when no typeclass
  instance or registered extension matches: it used to emit a new `value.method(args)` node that the
  visitor never rewrote, so `extend(150).clamp(0, 100)` with std's import-scoped `clamp` became
  `150..clamp(0, 100)` and threw at run time. On an unconstrained type parameter it is now an error
  that says to take the instance as a parameter (`S: Show<T> = implicit()`), instead of a silent
  `x.show()`. `const e = extend(x)` stays an error by design (extend() compiles to a direct call, so
  there is no wrapper value), and its message now names the value and method and says what to write
  instead. Import-scoped extensions are also found for a call a macro rebuilt with `factory.update*`.
- 80d05b4: A comprehension that fails to expand (for example `let: { a << 42; } yield: a + nope;`, where
  `42` has no type constructor) keeps its `yield:` / `pure:` / `return:` continuation in the
  output. The continuation used to be dropped, so the language service, which checks the expanded
  text, never reported the errors in it (here, `Cannot find name 'nope'`) while `typesugar check`
  did. A `const x = let` held for the merge goes back in its original place too.
- bec2d2b: An inlined operator chain no longer moves a side effect in front of an earlier read. In
  `pv + (bump() + bump())`, the two `bump()` calls were bound to `const`s before the statement
  while `pv` was read in it, after them, so a `bump()` that reassigned `pv` changed the result
  (`{ x: 1000, y: 1000 }` instead of `{ x: 1, y: 10 }`; likewise `this.pos + (this.step() +
this.step())`). An operand with side effects is now hoisted only when nothing in the statement
  is evaluated before it except literals, `this` and `const` names (checked through the type
  checker); otherwise that level is applied as a function call in place. Hoisted `const`s also
  go after the statement's leading comments now, with a JSDoc comment staying on the statement.
- c9a1e3e: A call that `= implicit()` completes with an instance from a package's `.d.ts` (std's `ordNumber`, a
  library's `Point.Eq`) warns TS9602, as the same call with the instance written out already did: the
  declaration has no method bodies, so the call keeps dictionary passing. It used to fall back without
  a word, and the specialization guide said a specialized copy was made.
- e0ba26b: An imported typeclass instance is an extension provider only for its own type: with a numeric
  enum `Color` and `import { showColor }` (an `@impl Show<Color>`), `n.show()` on `n: number`
  became `showColor.show(n)`, because `number` is assignable to `Color`. The receiver must now be
  the instance's type by identity (literal receivers such as `Color.Red` are widened first); other
  imported objects are unaffected. `InstanceScanner.scanValueDeclaration` reads one value
  declaration as an instance, and `isTypeclassDeclared` is exported.
- 9dcc681: An exported declaration initialized by an inlined instance call keeps the type the source gives it
  in the `.d.ts`. The declarations are emitted from the expansion, where `mapArr.map([1, 2], f)` is
  the method's body: `export const r` was declared `number[]`, though the source's `r` is `unknown`
  (the typeclass member's return type), so the declarations changed with whether a call was inlined.
  As for `@opaque` types, such a declaration (a const, a class property, `export default`, or a
  function or method whose body has an inlined call) is now annotated with the source's type, unless
  that is `any`. A type that can't be written
  at the declaration (a class local to the function, or a class expression's own `typeof Cls`) is not
  written there: that declaration keeps the type the expansion infers.
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
- 977888e: An `@impl` method whose body uses a class as a value (`make: (n) => new Pt(n)`) is no longer
  inlined where the call site imports that class only as a type (`import { isPt, type Pt }`,
  `import type { Pt }`, or through an `export type` re-export). It compiled to `new Pt(3)` with no
  binding for `Pt`, a ReferenceError at run time, and the build exited 0. Such a call now goes
  through the instance and warns TS9602 naming the identifier; a plain value import still inlines.
- ac891d1: An inlined `@impl` method no longer writes `any` for a type the call site can't name.
  `mkP.make(1)`, where the call site doesn't import `P`, inlined as `({ x: 1 }) as any`, so the
  emitted `.d.ts` said `p: any` (the source says `P`) and the expanded type check saw nothing. Such
  a type is now written through an import type (`import("./ord.js").P`), and the method's own type
  parameter as the call instantiates it (`o as unknown as number`); one that can't be named at the
  call site (a type private to the instance's module) keeps the call going through the instance. An argument narrower than its parameter (`extract(Nil)`) that
  the body reads more than once is no longer asserted as `any` either: that call goes through the
  instance.
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
- 0411491: No runtime import of a typeclass marker left behind by `summon`

  `import { summon, Clone } from "typesugar"; summon<Clone<P>>()` expands to an
  instance literal, but only `summon` was removed from the import. tsc and
  esbuild elide the unused `Clone`, except under `verbatimModuleSyntax`, where the
  emitted JS kept `import { Clone } from "typesugar"`: a runtime dependency on
  the macro package. A non-macro specifier in an import that also brought in a
  macro is now removed when the file used it and the expanded code no longer does
  (as a value or a type). A specifier the file never used is left alone.

- ef7164e: Typeclass method syntax works on a literal receiver: `(7).show()`, `const n = 3; n.show()`,
  `"a".show()` and `true.show()` were left as plain method calls (a run-time "is not a function")
  because the checker types them as the literal types `7`, `3`, `"a"`, `true`, which no
  `@impl Show<number>` is declared for. When no instance matches the literal type, the instance is
  now looked up for its base type (`number`, `string`, `boolean`), widened by the checker. The
  prefix-unary operator rewrite now decides that an operand is primitive by its type flags, as the
  binary form does.
- 8b0526f: A type or `@opaque` companion declared in a `.mts`/`.cts` file is named with the extension
  TypeScript's module resolution expects: `.mjs`/`.cjs` (or the file's own `.mts`/`.cts` where
  the project writes TypeScript extensions, `allowImportingTsExtensions` /
  `rewriteRelativeImportExtensions`), not `.js`. `typeToPortableTypeNode` wrote
  `import("./lib/shapes.js").Shape` for a type in `shapes.mts` -- TS2307 under `--strict`, an
  `any` read inside a fluent `match()` that asserts its scrutinee to it, and a wrong inferred
  `@opaque` annotation in emitted declarations -- and an erased `@opaque` method call imported its
  companion function from `./opt.js` for an `opt.mts`, which fails at run time. Both use
  `sourceSpecifierExtension` (exported from `@typesugar/core`). An extensionless (bundler)
  import of a `.mts`/`.cts` file gets its `.mjs`/`.cjs` extension, which extensionless
  resolution needs.
- 6f70351: `@opaque` annotations are kept as written in every position, and expanded code is checked against
  the runtime view of opaque types (`opaqueTypesAsUnderlying`: `Option<number>` is `number | null`).
  Annotation stripping covered only a variable or parameter default initialized by an erased
  constructor of a same-project type, so `function fo(o: Option<number>)` called as `fo(Some(2))`
  (now `fo(2)`) and `const a: Option<number> = Some(3)` with fp's `Option` failed `strictOutput`, and
  the declarations emitted from the expanded program lost the opaque type where it did strip.
  `strictOutput` and `typesugar build --strict` serve every file in that view.
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
- 8d5b6e3: A typeclass operator whose left operand had no instance borrowed the right
  operand's declared type without checking the left: `a === b` with `a: Foo`
  and `b: Bar` (Bar derives Eq) compiled to `Bar.Eq.equals(a, b)`. An operand's
  declared type is now tried only when both operands are assignable to it, so
  that comparison stays native.
- cb87742: `a === b` (or another activated operator) on a type that declares
  `@derive(Eq)` but has no instance, because its derive failed (a generic
  `Box<T>`, which `@derive` doesn't support yet), is TS9001 at the operator, as
  `summon<Eq<Box<number>>>()` is, instead of silently staying a reference
  comparison.
- 0e5a1de: Typeclass comparison operators are safe on nullable operands and find a
  narrowed union's instance:
  - `c === p` with `c: P | undefined` compiled to `P.Eq.equals(c, p)`, which
    threw when `c` was `undefined`. A comparison (`===`, `!==`, `==`, `!=`, `<`,
    `<=`, `>`, `>=`) with an operand whose type admits `null`/`undefined` now
    gives the native result when that operand is nullish:
    `c == null ? c === p : P.Eq.equals(c, p)`. Operands are evaluated once (a
    call or property read goes through an arrow's parameters). Non-null operands
    still compile to the plain call. Nullability is read from the checker, so
    this needs `strictNullChecks`.
  - `s1 === s2` where `s1: Shape` (a derived union) was assigned one variant
    stayed a reference comparison, with no diagnostic: the checker narrows `s1`
    to that variant, which has no instance. The operands' declared types (by
    symbol) are now tried after the narrowed type, for the rewrite and for TS9804.

- 38a89d0: A typeclass comparison with a nullable operand compiled to
  `c == null ? c === p : P.Eq.equals(c, p)`, which loses TypeScript's narrowing:
  `if (c === p) return c.x;` was TS18048 in the expanded code, so
  `typesugar build --strict` / `check --strict` failed on ordinary code. The
  expansion is now `c === p || (c != null && P.Eq.equals(c, p))` (`!==`:
  `c !== p && (c == null || P.Eq.notEquals(c, p))`), which TypeScript narrows
  as it narrowed the original, with the same results; an ordering operator
  (`<`, `<=`, `>`, `>=`) with a nullish operand is `false`. A property read
  (`this.p === o`) is no longer moved into an arrow, so it narrows too.
- ef5be91: A long arithmetic chain (`1 + 1 + ... + 1`, 10,000 terms) took tens of minutes to
  transform: the operator rewrite asked the type checker for each `+`'s left
  operand, and the checker re-checks the whole subtree below a binary expression
  every time it is asked (cubic overall). An operand that is itself an arithmetic,
  bitwise or comparison expression is typed number, bigint, string, boolean or
  `any` by TypeScript's rules, so it can't dispatch to an instance; it is now
  skipped without the checker, and the right operand's type is only computed when
  the left one can dispatch. The same line now takes well under a second.
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

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- c352805: A macro that hands back the call unchanged (for example `comptime(...)` while comptime evaluation
  is off in the editor) is no longer recorded as an expansion of itself. The editor showed the call
  again as its inlay hint (`comptime(() => 6 * 7)  = comptime(() => 6 * 7)`); it now shows nothing
  until there is a value.
- 56e1acf: Editor position fixes in the TypeScript plugin, for files whose macros expand:
  - Go-to-definition (and go-to-implementation) lands on the right line after a `@derive` or other
    expansion that adds lines above the target. tsserver converts the result to line/column with
    the language service's `toLineColumnOffset`, which read the expanded code; the plugin now
    converts on the source text.
  - TypeScript's quick fixes are offered in expanded files, with their edits on the source text.
    The error's span is mapped into the expanded code, and a fix that would edit generated code is
    not offered. "Fix all" (combined code fixes) is mapped the same way.
  - TypeScript's own inlay hints are shown when the requested span starts or ends in a comment
    (as a whole-file request always does): the span is mapped as a range.
  - Rename, find-references and document highlights no longer return locations in generated code.
    A `@derive` companion's references to the type were mapped onto the `@derive` tag, so renaming
    the type would have edited "@de" of the comment five times. A location is kept only when it is
    the same text in the source.
  - A file the transform leaves unchanged maps positions by identity.

  `@typesugar/lsp-common` adds `mapSourceSpanToOriginal` (a span that must be the user's own text)
  and `mapTextSpanToTransformed` (a request span mapped as a range). Position-to-line lookups in
  the `@typesugar/transformer-core` position mapper are now a binary search.

- 4b8ef70: A file that no macro changes is now passed through as written instead of being reprinted. The
  statement-list visitor rebuilt every source file and block from a fresh array even when nothing
  in it had changed, so every file was reprinted by the TypeScript printer (blank lines dropped,
  code reformatted) and the editor plugin had to map every position in every file through a source
  map. A `@derive` decorator whose derives generate nothing is still removed from the declaration
  (it is not valid TypeScript on an interface or type alias); the reprint used to drop it by
  accident.
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

- cf7c08b: `typesugar check --strict` / `build --strict` type-check the expansion the build itself makes (the
  code it emits, and the declarations come from), and filter its diagnostics against that expanded
  program. It used to expand detached copies of every file first, where the macros asked the checker
  about nodes it never bound: some calls expanded wrongly or not at all (fp's `case Some(v)` in a
  `match: switch`), errors such as "Cannot find name 's'" for a parameter leaked into the source's own
  diagnostics, and the expanded program's diagnostics were filtered against the source as written,
  whose text their positions don't refer to. An error the source already reports is not repeated at
  its expanded position.

  A prose "@opaque" in a JSDoc comment ("a call on an @opaque type") is no longer read as an `@opaque`
  tag: typesugar's own `index.d.ts` got a syntax error in the `--strict` view of `@opaque` types, and
  a library's `.d.ts` could register an interface as opaque.

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

- 2f1744b: TS9602 (auto-specialization skipped) is in the diagnostic catalog, with an explanation and a
  docs/errors page: it was the only typesugar code emitted as a bare "[TS9602]" string. The warning's
  text is unchanged.
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
- Updated dependencies [7d84596]
- Updated dependencies [592d66b]
- Updated dependencies [3460709]
- Updated dependencies [eb77b03]
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
- Updated dependencies [0c9202a]
- Updated dependencies [5cc34d9]
- Updated dependencies [8204470]
- Updated dependencies [c1e797e]
- Updated dependencies [6edd688]
- Updated dependencies [615d4c1]
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/macros@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/macros@0.1.1-rc.0
