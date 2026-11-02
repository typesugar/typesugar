# Round-2 needs ledger (docs-arch-1.0)

Routed to running agents:

- std (a810…): fp static do-instance receiver import in let-yield/par-yield + flip it.fails; preprocessor drops `const x =` on failure; `x << (None as Option<number>)` mangled; optional same-pass @service typing, Cons brand.
- transformer-core (ac79…): JSDoc `@schema` tag; `@deriving` decorator + warning; duplicate summon revisit; fromJson via method sugar (needs json syntax import).
- tooling (a65a…): pipeline.ts createPipeline passes tsconfigPath as configFileName.

For the integration pass (me):

- macros/src/diagnostic-suppression-rules.ts Rule 3 NewtypeAssignment: likely dead after the Newtype fix; update or remove + comment.
- Done: Builder leftovers (red-team test, manifests, vscode manifest test).
- Optional: TS9105 (Builder sum-type) descriptor is now meaningless — reserved-marking covers it.

PEP-060 / 1.0 gaps (not fixing now):

- Instances imported from a package's dist are never specialized and no warning says so (validate nativeSchema, fp optionFunctor).
- `wrap` erases to the bare literal, giving strictOutput warnings at newtype call sites.
- erased: emitted eraseWith(...) lacks the capability type argument (strictOutput warning).
- EFFECT002/003/010/011/021/030/040 defined but not emitted.

After integration:

- BREAKING for users: unplugin include/exclude strings are now globs. Existing substring configs (e.g. exclude: ["tests"]) silently stop matching — exactly what broke our own vitest.config.ts. Consider: strings with no glob characters keep substring meaning (with a deprecation warning), or at least a warning when a pattern matches nothing. Changeset must call it out.
- NewtypeAssignment rule: legacy; deletion is a decision (public export createNewtypeAssignmentRule).
- Json derive leaks class leading JSDoc into generated body (cosmetic).
- Infra: vitest 2.1.9 ignores root test.projects; package vitest configs are dead in root runs (needs `workspace` or vitest ≥3.2). PEP-059 P1 candidate.
- Order-dependence: relative imports into a package's src expand only if an earlier file loaded that package's macros by name (PEP-060 item 6 territory).

Code bugs left open by docs agents (round-3 candidates):

- par: over fp Option/Either emits 1..map(...).ap(2) (no ParCombine for fp) — should error, not emit.
- ||/?? fallback on fp Option emits flatMapOption.orElse(...) which doesn't exist — should error.
- strictOutput warnings on fp Option comprehensions (instance params typed Option<A>, values erased).
- @impl FlatMap<Task> companion emits `as FlatMap<Task>` without type import / type arg.
- Derive markers from `typesugar` are values only: summon<Eq<User>>() TS2749 under plain tsc; no single import is clean (PEP-060 item 13).
- Show/Semigroup/Monoid derive markers missing from the umbrella; Show type only in fp.
- (guides-c) `= implicit()` filled but not specialized (pipeline order).
- (guides-c) sql andTyped/orTyped/whereAndTyped mixed param tuples → strictOutput TS2345 (typed-fragment.ts:353-372, 519).
- (guides-c) sql Write.tuple contravariance TS2345 (typeclasses.ts:884).
- (guides-c) staticAssert rejects `as const` property reads (TS9219).
- (guides-c) units Unit.toString prints SI value with display symbol ("1000 km") — real bug (types.ts:450).
- (guides-c) reflect validator<T>() / validate is<T>() emit value.x on `object` (strictOutput TS2339).
- (guides-c) playground api/compile.ts doesn't preload validate/reflect macros.
- (guides-b) Binary @op ignores right operand type: `v + 5` on Vec2 emits `5..x` silently — should check/diagnose.
- (guides-b) Unary @op not dispatched (-v).
- (guides-b) Object-form match() output has strict errors (kind on never; zero-param handlers).
- (guides-b) /\*_ @contract _/ not in JSDOC_MACRO_TAGS though validTargets include function.
- (guides-b) No user path for custom/derived match extractors (registerCustomExtractor internal).
- (guides-b) stateMachine states/events typed string.
- (guides-b) Many user errors use generic TS9999 (tailrec, derive failure, non-exhaustive match); CLI never uses renderDiagnosticCLI.
- (authoring) Range variable from a chained call not rewritten: `const r3 = (0).to(100).step(10); r3.toArray()` TypeError.
- (authoring) createMacroTestContext garbles quote() output when printed (testing/src/macro-context.ts:88-110).
- (authoring) failing staticAssert still emits `// staticAssert: "…" ✓` comment.
- (authoring) @impl companion `as FlatMap<Box>` doesn't type-check (same as guides-a Task).
- (authoring) derived Eq companion leaks a trailing user comment into generated code (same family as Json JSDoc leak).
- (authoring) ts-plugin/src/index.ts:8 header claims |> / :: support.
- (authoring) package.json descriptions start with 🧊.
- (r3) Macro name clash: validate and testing both register expression macro 'assert' → can't load both in one process (playground). PEP-060 item 8 (module::export keys).
- (r3) units .to() results aren't SI-based: meters(1000).to(kilometers).add(meters(1)) gives '2 km' (pre-existing; ~30 tests assert current .to()).

decisions-1.0 integration (me, after TS + registry agents):

- pnpm install to refresh lockfile (vscode dropped vscode-languageclient + lsp-server deps; TS peer ranges).
- examples/{basic,implicits,standalone/hello-world}: add @typesugar/transformer devDependency so editors resolve the plugin under pnpm.
- Rebuild transformer + lsp-server dist; full build.
- Wrap in comptime refactor still gated on typesugar.manifest.json (undocumented).
