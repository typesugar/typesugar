# Security & Trust Model

**Last updated:** 2026-07-11

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
- **Macro capabilities are advisory (F4)** and **macro output is not statically
  vetted for dangerous patterns (F5).** See `SECURITY-REVIEW.md`.

## If you only do three things

1. Pin and review your dependencies — especially anything that ships macros.
   Review a `typesugar approve-macros` prompt with the same scrutiny you'd
   give a new production dependency before approving it — it's the exact
   same grant.
2. Run `typesugar expand` on code paths you care about to see what was generated.
3. Keep untrusted code out of your build; if you must build it, do so in an
   isolated environment (a container/CI runner you can throw away), the same way
   you would for any untrusted `postinstall` script.

## Reporting a vulnerability

Please report suspected security issues privately to the maintainer rather than
opening a public issue. See the repository's contact details.
