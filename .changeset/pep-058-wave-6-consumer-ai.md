---
"@typesugar/transformer": minor
"typesugar": minor
---

PEP-058 Wave 6: `typesugar init` and `typesugar create` now scaffold AI-assistant
context into your project — an `AGENTS.md` (read natively by Cursor, Copilot,
Codex and Zed), a `CLAUDE.md` pointer, and a Claude Code skill. The content
ships inside the package, is marker-delimited, and re-running `init` refreshes
only that block, leaving everything you wrote around it untouched. New `--ai` /
`--no-ai` flags.
