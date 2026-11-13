---
"unplugin-typesugar": patch
---

Add the `unplugin-typesugar/rolldown` entry point, for Rolldown and tsdown builds. The plugin already handled Rolldown internally, but the package published no subpath for it, so tsdown configs had to reach for `unplugin.rolldown` from the package root.
