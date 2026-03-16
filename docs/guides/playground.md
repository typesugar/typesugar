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
const add = (a: number, b: number): number => a + b;
console.log('Sum:', add(2, 3));"
  mode=".ts"
  height="150px"
/>

### Read-Only Example

Use `readonly` for display-only examples that users can inspect but not modify:

<PlaygroundEmbed
  code="// This example demonstrates a simple pattern
const greet = (name: string): string => 'Hello, ' + name + '!';
console.log(greet('World'));"
  mode=".ts"
  height="150px"
  readonly
  title="Greeting function"
/>

### Compact Display

For simple examples, hide the output panel:

<PlaygroundEmbed
  code="// A pure function
const double = (n: number): number => n * 2;
const triple = (n: number): number => n * 3;"
  mode=".ts"
  height="100px"
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

::: tip
For code containing angle brackets (like generics), use the [full playground](/playground) or the "Open in Playground" button to expand embedded examples.
:::

## Open in Playground

Every embedded playground has an "Open in Playground" button that opens the code in the full playground page. This lets users:

- See the complete transformed output
- Run the code
- Modify and experiment further
- Share their changes

The code, file type, and settings are preserved when opening in the full playground.
