---
"@typesugar/transformer": minor
"typesugar": minor
---

`typesugar init` gains a non-interactive mode: `--yes` (accept every default),
`--persona <end-user|app-developer|extension-author>`. Without a TTY and
without `--yes`, `init` and `create` now fail immediately with an actionable
message instead of hanging forever on a prompt nobody can answer — which is
what happened in CI, and to any AI assistant trying to set typesugar up.
