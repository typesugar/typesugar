# @typesugar/preprocessor

Lexical preprocessor for typesugar syntax extensions.

This package provides a lexical preprocessing layer that transforms custom syntax (`F<_>` HKT, `|>` pipeline, `::` cons) into valid TypeScript before the macro transformer runs.

## Installation

```bash
npm install @typesugar/preprocessor
```

## Usage

```typescript
import { preprocess } from "@typesugar/preprocessor";

const source = `
  interface Functor<F<_>> {
    map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
  }

  const result = x |> f |> g;
`;

const { code, changed, sourceMap } = preprocess(source);
// code is now valid TypeScript with F<A> rewritten to Kind<F, A>
// and |> rewritten to __binop__ calls
```

## Syntax Extensions

### HKT Syntax (`F<_>`)

Higher-kinded type parameters are rewritten using the `Kind<F, A>` encoding:

```typescript
// Input
interface Functor<F<_>> {
  map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}

// Output
interface Functor<F> {
  map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>;
}
```

### Pipeline Operator (`|>`)

The pipeline operator is rewritten to `__binop__` calls for resolution:

```typescript
// Input
const result = x |> f |> g;

// Output
const result = __binop__("|>", __binop__("|>", x, f), g);
```

### Cons Operator (`::`)

List construction syntax for functional data structures:

```typescript
// Input
const list = 1 :: 2 :: 3 :: nil;

// Output
const list = __binop__("::", 1, __binop__("::", 2, __binop__("::", 3, nil)));
```

## API

### `preprocess(source, options?)`

Preprocess source code, applying all syntax extensions.

- `source`: The TypeScript source code
- `options.fileName`: File name for JSX detection (`.tsx` files get JSX-aware tokenization)
- `options.sourceMap`: Whether to generate source maps (default: `true`)

Returns `{ code, changed, sourceMap }`.

### `tokenize(source, options?)`

Tokenize source code into a stream of tokens.

### `TokenStream`

A stream wrapper for efficient token consumption with lookahead.

## License

MIT
