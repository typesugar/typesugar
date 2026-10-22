---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
---

TS9602 (auto-specialization skipped) is in the diagnostic catalog, with an explanation and a
docs/errors page: it was the only typesugar code emitted as a bare "[TS9602]" string. The warning's
text is unchanged.
