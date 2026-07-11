# typesugar Templates

Starter project templates for different use cases.

## Available Templates

| Template       | Description          | Use Case                               |
| -------------- | -------------------- | -------------------------------------- |
| `app`          | Application starter  | Building apps with typesugar features  |
| `library`      | Library starter      | Publishing a library using typeclasses |
| `macro-plugin` | Macro plugin starter | Creating custom macros for typesugar   |

## Quick Start

```bash
# Create from template
npx typesugar create app my-app
npx typesugar create library my-lib
npx typesugar create macro-plugin my-macros

# Or manually copy a template directory
cp -r templates/app ./my-project
cd my-project
npm install
```

## Template Details

### App Template

A minimal Vite application demonstrating:

- `comptime()` for build info
- `@derive()` for generated methods
- `sql` tagged template for type-safe queries

**Stack:** Vite, TypeScript, typesugar

### Library Template

A publishable library with:

- Custom `Printable` typeclass
- Domain types with derives
- Generic functions using typeclasses
- Test setup with Vitest

**Stack:** tsup, TypeScript, Vitest, typesugar

### Macro Plugin Template

A custom macro package with:

- `logged()` expression macro
- `memo()` expression macro
- `@derive(Validation)` derive macro
- Complete test suite

**Stack:** tsup, TypeScript, Vitest, @typesugar/testing

## Customizing Templates

1. Copy the template
2. Update `package.json` with your package name
3. Modify source code as needed
4. Run `npm install && npm run build` to verify setup

## Adding to Your Project

If you're contributing a new template:

1. Create a new directory under `templates/`
2. Include: `package.json`, `tsconfig.json`, `README.md`
3. Include a working example in `src/`
4. Include tests if applicable
5. Document in this README
