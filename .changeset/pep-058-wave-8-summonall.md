---
"@typesugar/macros": patch
"typesugar": patch
---

Fix: `summonAll` is now importable. It is a registered macro that declares
`module: "typesugar"` and is documented as public API, but it shipped with no
runtime stub and no facade export — so `import { summonAll } from "typesugar"`
failed to type-check and the feature was unusable.
