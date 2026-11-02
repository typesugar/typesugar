---
"@typesugar/core": patch
---

A line's `// @ts-no-typesugar` marker is found after a template literal with a substitution. The
comment scanner read the `}` closing `${...}` as a plain brace and the template's closing backtick
as the start of a new template, which swallowed the comment, so ``grammar`a ${y}` // @ts-no-typesugar``
still expanded the macro.
