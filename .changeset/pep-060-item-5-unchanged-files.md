---
"@typesugar/transformer-core": patch
---

A file that no macro changes is now passed through as written instead of being reprinted. The
statement-list visitor rebuilt every source file and block from a fresh array even when nothing
in it had changed, so every file was reprinted by the TypeScript printer (blank lines dropped,
code reformatted) and the editor plugin had to map every position in every file through a source
map. A `@derive` decorator whose derives generate nothing is still removed from the declaration
(it is not valid TypeScript on an interface or type alias); the reprint used to drop it by
accident.
