# Interactive Playground

typesugar includes an interactive playground that lets you try code directly in your browser without installing anything.

## Full Playground

The [full playground](/playground) provides a complete development environment with:

- Side-by-side input and output editors
- File type toggle (`.ts` for JSDoc macros, `.sts` for custom syntax)
- TypeScript version selection
- Code execution with console output
- Share URLs for collaboration
- Example presets to explore features

## Embedded Playgrounds

You can also embed smaller playgrounds directly in documentation pages. These are great for interactive examples and tutorials.

### Basic Example

Here's a simple embedded playground:

<PlaygroundEmbed
  code="// Try editing this code!
const greet = (name: string) => `Hello, ${name}!`;
console.log(greet('World'));"
  mode=".ts"
  height="180px"
/>

### Read-Only Example

Use `readonly` for display-only examples that users can inspect but not modify:

<PlaygroundEmbed
code="/\*_ @typeclass _/
interface Eq<T> {
equals(a: T, b: T): boolean;
}

/\*_ @impl _/
const EqNumber: Eq<number> = {
equals: (a, b) => a === b,
};"
mode=".ts"
height="220px"
readonly
title="Typeclass definition"
/>

### Sugar TypeScript (.sts) Example

The `.sts` mode enables custom syntax like the pipeline operator:

<PlaygroundEmbed
code="// Pipeline operator chains transformations
const result = [1, 2, 3, 4, 5]
|> (nums => nums.filter(n => n % 2 === 0))
|> (nums => nums.map(n => n \* 2))
|> (nums => nums.reduce((a, b) => a + b, 0));

console.log('Result:', result); // 12"
mode=".sts"
height="200px"
title="Pipeline operator"
/>

### Compact Display

For simple examples, hide the output panel:

<PlaygroundEmbed
code="import { staticAssert } from 'typesugar';

staticAssert(1 + 1 === 2);
staticAssert<string extends unknown, true>();"
mode=".ts"
height="120px"
hideOutput
/>

## Component API

The `<PlaygroundEmbed>` component accepts these props:

| Prop         | Type                | Default   | Description              |
| ------------ | ------------------- | --------- | ------------------------ |
| `code`       | `string`            | Required  | Initial code content     |
| `mode`       | `".ts"` \| `".sts"` | `".ts"`   | File type / syntax mode  |
| `readonly`   | `boolean`           | `false`   | Prevent editing          |
| `height`     | `string`            | `"300px"` | Editor panel height      |
| `hideOutput` | `boolean`           | `false`   | Hide the output panel    |
| `title`      | `string`            | `""`      | Optional title in header |

## Usage in Markdown

To add an embedded playground to your documentation:

```vue
<PlaygroundEmbed code="// Your code here" mode=".ts" height="200px" />
```

Or with all options:

```vue
<PlaygroundEmbed
  code="const x = 42;"
  mode=".ts"
  height="250px"
  readonly
  hideOutput
  title="Example"
/>
```

## Open in Playground

Every embedded playground has an "Open in Playground" button that opens the code in the full playground page. This lets users:

- See the complete transformed output
- Run the code
- Modify and experiment further
- Share their changes

The code, file type, and settings are preserved when opening in the full playground.
