---
"@typesugar/transformer": patch
---

`typesugar doctor` checks TypeScript against the supported range (`>=5.9.0 <7.0.0`): it fails on TypeScript 7 and warns below 5.9, reads the installed version before the declared one, and suggests `typescript@6` instead of `typescript@latest` (which installs TypeScript 7).
