# Security & Trust Model

**Last updated:** 2026-10-22

This document states typesugar's trust model in plain terms. It is the
authoritative statement of what typesugar does and does **not** protect against.
For the full vulnerability inventory and the longer-term hardening roadmap, see
[`SECURITY-REVIEW.md`](./SECURITY-REVIEW.md).

## The one thing to understand

> **Compiling code with typesugar executes that code's macros.** A macro is
> ordinary JavaScript that runs at build time, in your build process, with the
> full privileges of whoever runs the compiler — it can read files, spawn
> processes, and reach the network.
>
> **Treat any macro-bearing dependency exactly like a build script** (an npm
> `postinstall`, a Babel plugin, a Vite plugin). If you would not run a
> package's install script on your machine, do not compile code that imports its
> macros.

This is the same trust model as every other compile-time metaprogramming system
in the JS ecosystem (Babel plugins, SWC plugins, Vite/Rollup plugins,
`ts-patch` transformers). typesugar is not more dangerous than those — but it is
not less dangerous either, and it is easy to forget that "it's just a type-level
helper" still means "it runs code during your build."

## What this means concretely

- **A transitive dependency can register a macro.** Any package imported during
  compilation — however deep in the tree — can call `globalRegistry.register()`
  and have its macro participate in rewriting your code. A malicious or
  compromised dependency is in your build's trust boundary the moment it is
  imported at compile time. **Partial mitigation since PEP-055** (see "What
  _is_ enforced" below): the compiler only proactively `require()`s a
  dependency's macro-time code if that dependency declares
  `typesugar.macros` in its own `package.json` — for anything outside the
  `@typesugar/` npm scope, that now requires one-time, explicit,
  committed-to-your-repo approval. This narrows, but does not close, the
  gap: it gates the compiler's own discovery path, not the
  `globalRegistry.register()` API itself — a package your build already
  imports for an unrelated reason can still call it directly as a side
  effect of being loaded, same as always. See "Known limitations" (F1)
  below for exactly what remains unenforced.
- **Macros see your source.** A macro has access to the TypeScript program,
  including the text and paths of your source files.
- **`comptime` and `include*` touch the filesystem.** These read files at build
  time. Their access is restricted to the project root (see "What _is_
  enforced"), but within that boundary they read whatever you point them at, and
  the contents are embedded into your build output.

## What _is_ enforced

These are real, tested boundaries — not advisory guidance:

- **File access is confined to the project root.** `includeStr`, `includeBytes`,
  `includeJson`, and `comptime({ fs })` reject absolute paths and `..` traversal
  that would escape the project directory. Attempting to escape fails the build
  with a diagnostic rather than reading the file. (Red-team tests:
  `tests/include.test.ts` → "security: path traversal (F2)".)
- **`comptime` is opt-in for IO.** A `comptime()` block has no filesystem or
  network access unless you explicitly grant it (`comptime({ fs: 'read' }, …)`).
- **Built-in macro names cannot be silently overridden.** The registry rejects a
  second registration for an already-registered built-in macro name.
- **You can see what macros did.** `typesugar expand <file> [--diff]` prints the
  post-expansion output. No macro can hide its rewrite from this — the expanded
  code is the ground truth. Use it to audit what a dependency's macros produce.
- **Non-first-party macro packages require explicit, committed consent
  (PEP-055).** A package declares where its macro-time code lives via a
  `typesugar.macros` field in its own `package.json` — the compiler will not
  `require()` that code otherwise. Packages published under the `@typesugar/`
  scope are auto-trusted (this repo's own publishing org, already
  unconditionally trusted the moment you depend on `@typesugar/transformer`
  at all). Anything else fails the build the first time it's encountered,
  with a diagnostic pointing at `typesugar approve-macros` — that command
  lists exactly what's new, prompts for confirmation, and writes the
  decision to `typesugar.config.ts`'s `security.allowedMacroPackages`
  (meant to be committed, so the trust decision shows up in your PR diffs
  for reviewers to scrutinize alongside the dependency itself, the same way
  pnpm's `approve-builds` mechanism works for lifecycle scripts). See the
  ["Getting discovered"](./guides/authoring-libraries.md#getting-discovered)
  section of the library-authoring guide for the package-author side of this.
  The gate applies to dependencies (packages inside `node_modules`); code in
  your own repository is not gated. See
  [What typesugar trusts](#what-typesugar-trusts).

## What typesugar trusts

Macros run code when you build and while you edit. That code can come from
someone you didn't mean to trust in three ways. Each one is covered by the
layer that can actually stop it.

### A malicious npm dependency, including a transitive one

This is what the PEP-055 gate above is for. A macro package inside a
`node_modules` directory is a dependency, and its macros load only if it is
`@typesugar/*` (or `typesugar`) or listed in `security.allowedMacroPackages`.
The gate matters even where install scripts are blocked (pnpm 10's default,
`npm install --ignore-scripts`): a dependency whose install script never ran
would otherwise still get to run code on every build.

- **Which package an import names** is decided the way Node decides it, from
  the importing file's location. pnpm's per-package `node_modules`, nested
  installs and workspace links work as they do for Node.
- **A relative path into `node_modules`** (`"../node_modules/x/index.js"`)
  counts as a bare import of the package its path names (`x`), and is gated
  the same way. The name comes from the path, not from that package's own
  `package.json` `name`, so `node_modules/x` calling itself
  `@typesugar/official` is still `x`.
- **A dependency's own files are never scanned.** The imports of a file inside
  `node_modules` never load macro packages, even when your code imports that
  file directly; only your project's files decide what loads.
- **Importing a workspace package by its name** (`import "@acme/macros"`)
  goes through `node_modules` (a workspace link), so it is a dependency import,
  and a name outside `@typesugar/*` needs approval. Importing the same package
  by a relative path is project code (see [Files written into your own repository](#files-written-into-your-own-repository)).

### Files written into your own repository

**The project tree is trusted.** A macro package reached by a relative import
whose real path is not inside a `node_modules` directory is project code: a
vendored directory, a workspace sibling imported by path, a nested project, a
package's own `../src`. It loads whatever its `package.json` calls itself,
with no approval and no warning. Config files in the tree
(`typesugar.config.*`, `.typesugarrc*`, `package.json` `"typesugar"`) are
project code too. A host reads the nearest one walking up from the
tsconfig's directory (or the current directory, when there is no tsconfig),
stopping at the repository root (the directory with `.git`).

Project code is loaded by its real path, never under the name it claims, so
a directory whose `package.json` says `@typesugar/std` runs as itself and
does not stand in for the real `@typesugar/std`.

**The accepted risk:** someone who can write files into your repository can
run code when you build it, as they can with every config file your tools
run (`vite.config.ts`, `eslint.config.js`, `package.json` scripts).
typesugar doesn't try to defend the repository against itself: that only
adds friction. Review vendored code before you commit it, as you would any
other code.

### Opening an untrusted repository in your editor

The language-service plugin expands macros as you type, so opening a
repository runs its macros and its `typesugar.config`. The layer for this is
your editor's trust prompt: in VS Code, [Workspace
Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust).

- **The typesugar VS Code extension does not run in Restricted Mode.** It
  declares `"untrustedWorkspaces": { "supported": false }`, so in a folder you
  haven't trusted it is disabled, and the TypeScript server plugin it
  contributes is not registered. It turns on when you trust the folder.
- **VS Code 1.130 and later** (July 2026): VS Code's own TypeScript extension
  does not run in Restricted Mode either, so no TypeScript server starts and
  no plugin of any kind loads until you trust the folder.
- **VS Code 1.85 to 1.129:** the TypeScript extension runs in Restricted Mode
  with VS Code's bundled TypeScript only. It ignores the workspace's
  `typescript.tsdk` and `typescript.tsserver.pluginPaths`, and passes the
  TypeScript server the plugins of enabled extensions only. A `tsconfig.json`
  `compilerOptions.plugins` entry is looked up next to the TypeScript that
  runs the server (for the bundled TypeScript, VS Code's own install, not the
  repository's `node_modules`) and in those extensions' directories, so
  typesugar's plugin is not loaded. One gap in those versions: if the
  workspace's settings turn on `typescript.enablePromptUseWorkspaceTsdk`, VS
  Code offers to switch to the workspace's TypeScript without asking for
  trust first. Don't accept that prompt in a folder you don't trust: the
  workspace's TypeScript loads `tsconfig.json` plugins from the repository's
  own `node_modules`.
- **VS Code forks** (Cursor, Windsurf, VSCodium) behave like the VS Code
  version they are built on (Help → About).
- **Other editors are not covered by this.** Neovim, Zed, Sublime Text,
  Helix and Emacs (through `typescript-language-server` or `vtsls`) and
  JetBrains IDEs run the TypeScript server from the project's
  `node_modules/typescript` and load `tsconfig.json` plugins from the
  project's `node_modules`, with no trust check typesugar can rely on. (We
  have not checked whether JetBrains' Safe Mode for untrusted projects stops
  TypeScript service plugins.) Open a repository you don't trust in a
  container or VM, or don't open it in an editor with the plugin configured.

## Known limitations (not yet enforced)

These are documented honestly rather than papered over with controls that would
imply a guarantee typesugar cannot currently keep:

- **No identity verification behind the PEP-055 consent gate (F1, revised).**
  The `typesugar approve-macros` gate above controls whether the compiler
  attempts to load a package's macro-time code at all — a real, tested
  boundary (see above) — but it is still consent to a **self-declared name**,
  not a cryptographic or otherwise verified identity claim. Approving
  `my-org-macros` once does not re-verify that every future install of that
  exact name is the same publisher; a supply-chain compromise or a
  typosquatted package that gets approved by mistake is not caught by this
  mechanism. It also does not constrain `globalRegistry.register()` itself —
  a package your build already imports for an unrelated (non-macro) reason
  can still call it directly at module scope; the registry keys on a macro's
  self-declared `module` field for its own internal bookkeeping, which a
  hostile package can set to any value it likes. A real fix for that
  narrower piece requires deriving the registering package's identity from
  the module-resolution graph; that remains tracked as future work (see
  `SECURITY-REVIEW.md`, issue #14), not shipped. Until then: review what
  you approve as carefully as a new production dependency, the same
  build-script trust model described above.
- **The `comptime` sandbox is not an isolation boundary (F3).** It uses Node's
  `vm` module, which is [explicitly not a security
  mechanism](https://nodejs.org/api/vm.html#vm_vm_createcontext_contextobject_options).
  Path access is restricted, but a determined `comptime` block can reach the host
  realm. Do not rely on the sandbox to contain untrusted code.
- **Macro capabilities are not enforced at all (F4).** The `MacroCapabilities`
  types and `createRestrictedContext()` exist in `@typesugar/core`, but nothing
  attaches capabilities to macro definitions or applies the restriction, so a
  macro can read files, environment variables and the network whatever it
  declares. **Macro output is not statically vetted for dangerous patterns
  (F5).** See `SECURITY-REVIEW.md`.

## If you only do three things

1. Pin and review your dependencies — especially anything that ships macros.
   Review a `typesugar approve-macros` prompt with the same scrutiny you'd
   give a new production dependency before approving it — it's the exact
   same grant.
2. Run `typesugar expand` on code paths you care about to see what was generated.
3. Keep untrusted code out of your build; if you must build it, do so in an
   isolated environment (a container/CI runner you can throw away), the same way
   you would for any untrusted `postinstall` script. Open a repository you don't
   trust in VS Code's Restricted Mode (or a container), not in an editor that
   loads its `tsconfig.json` plugins.

## Reporting a vulnerability

Please report suspected security issues privately to the maintainer rather than
opening a public issue. See the repository's contact details.
