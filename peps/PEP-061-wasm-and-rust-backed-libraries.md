# PEP-061: WebAssembly Interop and Rust-Backed Libraries

**Status:** Draft (2026-10-20) — exploration, on the backlog. Nothing is
implemented. Not a 1.0 item.
**Date:** 2026-10-20
**Author:** Claude (with Dean Povey)
**Related:** [PEP-060](PEP-060-architecture-for-1.0.md) (1.0 architecture),
[PEP-042](PEP-042-fusion-kernels.md) (fusion kernels),
[PEP-048](PEP-048-package-triage.md) (package triage), the Turf case study
([typesugar/turf-typesugar](https://github.com/typesugar/turf-typesugar))

## Context

TypeScript reaches a WebAssembly module through generated JavaScript glue and a
`.d.ts`: wasm-bindgen (and `tsify`) for Rust, embind for Emscripten, AssemblyScript's
own bindings, or napi-rs for native Node addons. Numbers cross the boundary cheaply.
Anything structured is either serialized (often JSON or serde through
`serde-wasm-bindgen`) or written into the module's linear memory as bytes at
offsets. The recurring costs:

1. **Marshalling.** Serializing structs across the boundary dominates small calls.
2. **Hand-written memory layout.** Reading a struct out of linear memory means offset
   arithmetic over `Float64Array`/`DataView` views: fast, but error-prone and
   unreadable.
3. **Boundary-crossing overhead.** One call per operation (`a.add(b).mul(c)`) costs
   more than the work for small values.
4. **Manual lifetimes.** WASM-side objects must be `free()`d by hand.
5. **Drift.** Nothing checks at build time that the `.d.ts` matches what the module
   really exports.

typesugar can't make the WASM code faster. It can make the TypeScript side of the
boundary cost what hand-written code costs, while reading like ordinary typed code.
That is the same promise typesugar makes elsewhere, applied to a place where the
hand-written version is particularly painful.

## Use cases

### 1. Zero-cost typed views over linear memory (the strongest fit)

```typescript
/** @derive(WasmLayout) */
interface Particle {
  x: number; // f64
  y: number; // f64
  mass: number; // f32 (via a field annotation)
  alive: boolean; // u8
}

const ps = ParticleArray.view(memory, ptr, count); // generated
ps[i].x += ps[i].vx * dt;
// compiles to: f64[(ptr >> 3) + i * 4 + 0] += f64[(ptr >> 3) + i * 4 + 2] * dt
```

A derive computes the layout (offsets, alignment, padding, array-of-structs or
struct-of-arrays) at compile time and rewrites field access to typed-array
indexing. It would also emit the matching Rust `#[repr(C)]` struct, or check
against one, so both sides agree.

**Pitfall the design must handle:** `memory.grow()` detaches the old
`ArrayBuffer`, so cached views go stale silently. Generated code must re-derive
views after any call that can grow memory, or read through a buffer getter that
the optimizer can hoist.

### 2. Build-time binding checks

`includeBytes` already embeds a `.wasm` file at build time. A `comptime` step
could parse the module's export and import sections and fail the build when the
TypeScript declarations don't match the module (names, arity, value types). It
could also generate the declarations.

### 3. Batching boundary crossings

fusion's expression templates can turn `a * b + c` on WASM-backed vectors into one
call to a fused kernel instead of one crossing per operator, the way Blitz++ and
Eigen fuse loops in C++.

### 4. Lifetimes

`@derive(Disposable)` for WASM handles, so `using v = Vec3.new(...)` frees on scope
exit, with a `FinalizationRegistry` fallback that warns on leaks in development.

## Rust-backed libraries with typesugar interfaces

Dean's addition: typesugar-enabled packages that wrap good Rust crates behind
idiomatic TypeScript, using typesugar for the interface:

- **Operators.** `@op` instances so `a + b` and `m * v` work on WASM-backed
  vectors and matrices (e.g. over `glam` or `nalgebra`).
- **Typeclass instances.** `Eq`, `Ord`, `Show`, `Hash`, `Numeric` for the wrapped
  types, so they work with `summon`, `@derive` on user types that contain them, and
  the rest of the typeclass ecosystem.
- **Layouts.** Use case 1 for bulk data (point clouds, meshes, particle systems,
  time series).
- **Lifetimes.** Use case 4.

Candidate crates, in rough order of how well they show off the idea:

| Crate                         | Package idea                           | Why                                                                                        |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `glam` / `nalgebra`           | vector and matrix types                | operator overloading plus fused kernels; easy to benchmark against gl-matrix               |
| `geo`                         | geometry (area, simplify, boolean ops) | compare directly with the Turf case study's pure-TS numbers                                |
| `regex` / `fancy-regex`       | linear-time regex                      | no ReDoS, same API shape as a tagged template                                              |
| `rapier`                      | physics                                | bulk layouts and per-step batching (rapier already ships WASM bindings to compare against) |
| `image` / `fast_image_resize` | image ops                              | large buffers through zero-copy views                                                      |

The question each one answers: when the TypeScript side uses typesugar, does a
WASM-backed library beat (a) a pure-TypeScript library and (b) the same crate
behind plain wasm-bindgen glue, for realistic call sizes?

## Exploration plan

1. **Survey (read-only).**
   - wasm-bindgen, tsify, serde-wasm-bindgen, embind, AssemblyScript, napi-rs: how
     each passes structs, what `.d.ts` it generates, its loading story (sync vs async
     instantiation, bundler support, Node vs browser), and the known pain points.
   - Measure the boundary cost on this Mac for a few call shapes.
2. **Prototype `WasmLayout`.**
   - One crate-free Rust module with a `#[repr(C)]` particle struct, a TypeScript
     side using the derive, and benchmarks against:
     - hand-written views;
     - serde across the boundary;
     - a pure-TS array of objects.
   - Success: generated access within noise of hand-written views, and measurably
     faster than serde for bulk data.
3. **Prototype the build-time binding check** on the same module.
4. **Pilot one Rust-backed library**, probably vectors over `glam`, with operators,
   typeclass instances and a fused kernel. Benchmark against gl-matrix and plain
   wasm-bindgen.
5. **Decide** whether this becomes a supported package family, a guide plus examples,
   or nothing.

## Open questions

- Packaging: ship `.wasm` inside npm packages (size; bundler and loader
  differences), or let users bring the module?
- Async instantiation: top-level `await` constrains how a library can initialise.
- Threads and `SharedArrayBuffer`: views over shared memory, and the cross-origin
  isolation requirement in browsers.
- Should `WasmLayout` also target `DataView` for unaligned or mixed-endian data
  (file formats, network protocols)? That is a separate use with no WASM involved.
- napi-rs (native Node addons) has the same interface problem without linear memory.
  Is it in scope?
- How much of this fits typesugar's activation model (PEP-052)? Layout access
  rewriting is a new kind of property-access rewrite and needs its own opt-in.

## Not in scope

Compiling TypeScript to WASM, or running typesugar macros inside AssemblyScript
source.
