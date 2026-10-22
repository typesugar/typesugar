---
"typesugar-vscode": patch
---

The extension declares `"untrustedWorkspaces": { "supported": false }`: in a folder you haven't
trusted (Restricted Mode) it stays off, and the TypeScript server plugin it contributes is not
registered, because the plugin runs the workspace's macro packages and `typesugar.config`. Trust
the folder to turn it on. SECURITY.md describes what VS Code's own TypeScript support does in
Restricted Mode, and other editors.
