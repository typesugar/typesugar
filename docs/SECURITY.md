# Security & Trust Model

**Last updated:** 2026-06-21

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
  and have its macro participate in rewriting your code. There is currently no
  authentication or allowlisting that can stop this (see "Known limitations"
  below). A malicious or compromised dependency is in your build's trust
  boundary the moment it is imported at compile time.
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

## Known limitations (not yet enforced)

These are documented honestly rather than papered over with controls that would
imply a guarantee typesugar cannot currently keep:

- **No macro-registration allowlist (F1).** There is no reliable way today to
  restrict _which_ packages may register macros. The registry keys on a macro's
  self-declared `module` field, which a hostile package can simply set to any
  value it likes — so an allowlist built on it would be trivially bypassable
  ("security theater"). A real control requires deriving the registering
  package's identity from the module-resolution graph; that is tracked as future
  work, not shipped. Until then, the build-script trust model above is your
  boundary.
- **The `comptime` sandbox is not an isolation boundary (F3).** It uses Node's
  `vm` module, which is [explicitly not a security
  mechanism](https://nodejs.org/api/vm.html#vm_vm_createcontext_contextobject_options).
  Path access is restricted, but a determined `comptime` block can reach the host
  realm. Do not rely on the sandbox to contain untrusted code.
- **Macro capabilities are advisory (F4)** and **macro output is not statically
  vetted for dangerous patterns (F5).** See `SECURITY-REVIEW.md`.

## If you only do three things

1. Pin and review your dependencies — especially anything that ships macros.
2. Run `typesugar expand` on code paths you care about to see what was generated.
3. Keep untrusted code out of your build; if you must build it, do so in an
   isolated environment (a container/CI runner you can throw away), the same way
   you would for any untrusted `postinstall` script.

## Reporting a vulnerability

Please report suspected security issues privately to the maintainer rather than
opening a public issue. See the repository's contact details.
