# Findings: fp (packages/fp/src)

(Reviewer could not write the file itself; transcribed from its report. Repros in this folder: io1.cjs, io2.cjs, console.mjs.)

1. CRITICAL confirmed — io/io.ts:673-684 Async case runs `current = f(result.right)` inline in callback outside interpreter try; a throw after any async step escapes as uncaughtException and runIO never settles. Callback can fire twice. Also breaks Deferred (completer's complete() rejects with waiter's error, other waiters hang). Fix: in callback set current=IO.pure(v)/raise and schedule loop(); add done guard.
2. CRITICAL confirmed — io.ts:724-735 (async Attempt), 797-829 (sync HandleError/Attempt): try wraps stack.pop()+f(result), so a throw in the continuation is treated as failure of the guarded IO -> swallowed as Left / handler runs out of scope. `runIOSync(flatMap(handleError(pure(1),h), x=>{throw}))` calls h, returns 99. Affects bracket/guarantee/onError/redeem/redeemWith. Fix: only inner IO inside try; pop/apply continuation outside.
3. CRITICAL confirmed — io/resource.ts:38-57 map->combineWith->flatMap->map infinite sync recursion; `Resource.pure(1).map(x=>x)` RangeError. map acquires twice; flatMap release re-runs f(a). Fix: direct map; flatMap capture inner release at acquire time.
4. HIGH confirmed — data/list.ts:180,199,604-621; nonempty-list.ts:402-420: Nil is null and Option is A|null so Some(Nil)===None. List.tail(List.of(1)) -> None; List.traverse(Nil,f) -> None; NEL.traverse(singleton) -> None. Fix: tail/init return List|undefined; traverse uses internal failure sentinel.
5. HIGH confirmed — io/console.ts:175-179 readValidated checks r.\_tag==="Left" but Either is {left}/{right}; invalid input returns undefined. Fix: isLeft(r).
6. HIGH confirmed — io/console.ts:107 bare require("readline") in ESM dist -> "require is not defined". Fix: import("node:readline") via IO.fromPromise or createRequire.
7. HIGH confirmed — io.ts:367-371,535-540,673 timeout/race never cancel the loser; returned cancel unused; header claims "Cancellation support". timeout(pure(1),4000) keeps process alive 4s. Fix: track cancel fns, call loser's cancel (clearTimeout for sleep), or remove the claim.
8. HIGH confirmed — src/index.ts:230-231, zero-cost/option.ts:12-13,419, zero-cost/result.ts: root barrel re-exports zero-cost/\* which import `typescript` and register macros at load; importing @typesugar/fp at runtime loads typescript+core+cosmiconfig; sideEffects true. Fix: move macro defs to @typesugar/fp/macros subpath; keep plain ops objects in runtime barrel.
9. HIGH confirmed — package.json exports["./effect"] points at dist/effect but tsup excludes src/effect -> ERR_MODULE_NOT_FOUND. Fix: build it (effect optional peer) or drop export+docs.
10. HIGH confirmed — typeclasses/monad-error.ts:84-110,166-171; alternative.ts separate: use private {\_tag,value} Either. fromEither(eitherMonadError())(Right(1)) -> Left(undefined). Fix: use real Either/Option from ../data.
11. MEDIUM confirmed — io/deferred.ts:258-273,296-309 MVar: pending read() registered as taker swallows put(); queued take() deadlocks. Fix: separate readers queue.
12. MEDIUM confirmed — io/resource.ts:292-329 ResourcePool maxSize not enforced (counts idle, not outstanding); drain() destroys without clearing pool. Fix: created counter; splice before draining.
13. MEDIUM confirmed — stack overflow at 20k: data/state.ts:28-33,155-178 (traverse, whileM), reader.ts same, nonempty-list.ts:308-311 reduceRight, io.ts:712,726,800,814 nested runIO per Attempt/HandleError (20k nested guarantee overflows; README promises stack-safe IO). Fix: trampoline or document; reduceRight = reverse+foldLeft; handler frames on IO stack.
14. MEDIUM confirmed — typeclasses/traverse.ts traverseFilter returns nested arrays [[1],[],[3]] cast to F<B>.
15. MEDIUM confirmed — typeclasses/monad.ts mfilter uses F.map(fa,()=>a) not pure(a): [1,2,3] -> [2,2,2,3,3,3].
16. MEDIUM confirmed — typeclasses/semigroupal.ts product3/4/5 return nested tuples typed as flat.
17. MEDIUM confirmed — typeclasses/eq.ts:306,328-335 eqNumber eqv(NaN,NaN)=false but compare(NaN,x)=EQ; own ordLaws fail. Fix: NaN equal to itself, NaN last in compare; document -0.
18. MEDIUM confirmed — io.ts:682,697,719,732 every async boundary via setTimeout(0) (~1.1ms each). Fix: resume sync when re-entrant else queueMicrotask.
19. MEDIUM confirmed(expand) — zero-cost/option.ts:157-322 chain macro duplicates prev twice per step (16 copies of load() for 4 steps) and object-form match left unchanged. May never fire anyway. Fix: hygienic temps, or delete macro.
20. MEDIUM confirmed — typeclasses/semigroup.ts semigroupRecord uses `key in result` -> inherited members (constructor) combined; **proto** risk. Fix: hasOwnProperty + null-proto result.
21. MEDIUM confirmed — syntax/do.ts:164-190 For.from placeholder exported: map ignores f, flatMap calls f(undefined). Fix: remove or throw.
22. LOW confirmed — quadratic [...acc,x] in instances.ts:362-369 arrayTraverse, io.ts:336-341, validated.ts:517-527, state/reader/writer traverse, remote-data sequence, resource traverse, applicative replicateA, monad whileM/untilM, nonempty-list.ts:132-140 init, ref.ts Queue.offer.
23. LOW — syntax/pipe.ts memoize keys on JSON.stringify (NaN/null/undefined collide), unbounded.
24. LOW — io/io-app.ts:70-75,209-224 IOApp.main ignores AppError.exitCode.
25. LOW confirmed — nonempty-list.ts:124-127, deferred.ts:27,121,206: null value reads as empty (Deferred.complete(null) then waiters hang, second complete succeeds). Fix: explicit {set,value}.
26. LOW — data/option.ts:36-42 docs claim Option<null> is a compile error; it isn't.

## 1.0 gaps

- AlternativeOps.many/some and TraverseOps.flatTraverse exported but always throw.
- README advertises monad transformers; only a ReaderT stub (no map/flatMap/lift).
- No tailRecM; monadStackSafetyLaws mislabelled.
- No fiber/cancellation model; Resource.both is sequential.
- Semaphore.acquire / Queue.take busy-poll every 10ms.
- fileResource / FileHandle are mocks exported as public API.
- Root exports Console/Ref/Deferred/ResourceIO/IOApp as namespaces -> Console.Console.putStrLn.
- Two different IODo exports at root (io.ts and syntax/do.ts).
- hkt.ts IdF via alias Id<A>=A while package exports Id class.
- Decide whether src/effect ships in 1.0.
- RemoteData map2 vs ap disagree on Loading/Failure precedence (applicative law).
- IO.memoize has no in-flight dedupe.
- No tests cover Resource combinators, timeout/race, Console input, throws after async/attempt, List/NEL traverse on empty tail, MonadError/Semigroupal/Traverse derived ops.
