# HKT Encoding Compile-Time Benchmark

Measures **type-checking time** (`tsc --noEmit`) for different HKT encoding approaches.

## Run the Benchmark

```bash
pnpm tsx tests/benchmarks/hkt-perf/measure.ts --iterations 10
```

## Encodings Compared

### 1. `typesugar-encoding/`

typesugar's approach: `Kind<F, A> = F & { __kind__: A }` with `Apply<F, A>` for resolution.

- Uses phantom intersection type
- Requires `Apply<>` or preprocessor to resolve to concrete types
- Simple encoding, minimal type-level computation

### 2. `effect-encoding/`

Effect-TS's approach: `TypeLambda` with `this`-type unification.

- Uses `Kind<F, In, Out2, Out1, Target>` (5 type parameters)
- Explicit variance positions for soundness
- More type parameters = more type-level computation per application

### 3. `preprocessed/`

What typesugar compiles to: concrete types only, no HKT.

- Direct `Option<number>`, `Array<string>`, etc.
- Specialized functions instead of generic HKT functions
- Represents optimal type-checking performance (baseline)

## Results Summary

On small benchmarks (~200 lines each), all three encodings type-check in similar time:

| Encoding     | Median Time | vs Baseline |
| ------------ | ----------- | ----------- |
| preprocessed | ~780ms      | (baseline)  |
| typesugar    | ~760ms      | ~same       |
| effect       | ~755ms      | ~same       |

**Key finding:** At this scale, the HKT encoding choice has minimal impact on compile time. Most time is `tsc` startup overhead.

## Implications

1. **For small files:** Choose based on ergonomics and type safety, not performance
2. **For large codebases:** HKT overhead compounds, but typesugar's preprocessor eliminates it
3. **typesugar's value proposition:** Write ergonomic HKT syntax, compile to concrete types

## The typesugar Advantage

typesugar gives you the best of both worlds:

- **Source code:** Ergonomic `Kind<F, A>` syntax with full HKT polymorphism
- **Type-checked code:** Preprocessor rewrites to concrete types before `tsc` sees it
- **Result:** HKT expressiveness with concrete-type performance

```typescript
// You write:
function map<F>(F: Functor<F>): <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;

// Preprocessor emits (for concrete uses):
function mapOption<A, B>(fa: Option<A>, f: (a: A) => B): Option<B>;
```

## Scaling Considerations

To measure HKT overhead at scale:

1. **More type applications:** The benchmark has ~50 type applications. Real codebases have thousands.
2. **Deeper nesting:** More nested `Kind<F, Kind<G, Kind<H, A>>>` increases computation.
3. **More type parameters:** Effect's 5-arity Kind vs typesugar's 2-arity.

A more realistic benchmark would:

- Generate 1000+ type applications
- Include complex generic function chains
- Measure incremental type-checking (after edits)
