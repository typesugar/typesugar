# @typesugar/lsp-common

🧊 Shared IDE infrastructure for the typesugar language tooling.

This is an **internal support package**: it carries the position-mapping,
AST-helper, and code-action utilities shared by
[`@typesugar/lsp-server`](https://github.com/typesugar/typesugar/tree/main/packages/lsp-server),
[`@typesugar/ts-plugin`](https://github.com/typesugar/typesugar/tree/main/packages/ts-plugin),
and [`@typesugar/transformer`](https://github.com/typesugar/typesugar/tree/main/packages/transformer).

You should not need to depend on this package directly — it is published
because the packages above depend on it at runtime.

## What's inside

- **Position helpers** — offset/line-column conversions shared by the LSP
  server and the TS language-service plugin.
- **Position mapping** — translating diagnostic positions between original
  and macro-expanded source.
- **AST helpers** — small `ts.Node` utilities used by IDE features.
- **Code actions** — shared quick-fix construction.

## Documentation

typesugar's user-facing documentation lives at
**[typesugar.org](https://typesugar.org)**. For editor setup, see the
[editor setup guide](https://typesugar.org/getting-started/editor-setup).

## License

MIT
