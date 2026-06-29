# @typesugar/codec

> 📖 **Full documentation:** [Versioned Codecs guide](https://typesugar.org/guides/codec). The microsite is the canonical reference; this README is a quickstart.

> 🧊 **Frozen ([PEP-048](../../peps/PEP-048-package-triage.md)).** Not under active development and excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

Versioned codec generation with schema evolution and automatic migration chains -- serde + protobuf for TypeScript.

## Installation

```bash
npm install @typesugar/codec
```

## Quick Start

```typescript
import { schema } from "@typesugar/codec";

const userCodec = schema<{ name: string; email: string; theme: string }>("UserProfile", 3)
  .field("name", "string")
  .field("email", "string", { since: 2, defaultValue: "" })
  .field("theme", "string", { since: 3, defaultValue: "light" })
  .buildCodec();

const json = userCodec.encode({ name: "Alice", email: "alice@example.com", theme: "dark" });

// Decode v1 data -- migrations apply automatically
const bob = userCodec.decodeAny('{"__v": 1, "name": "Bob"}');
// { name: "Bob", email: "", theme: "light" }
```

## Documentation

- [Versioned Codecs guide](https://typesugar.org/guides/codec) -- full reference
- [`@typesugar/validate`](https://typesugar.org/guides/validate) -- validate decoded data
- [`@typesugar/derive`](https://typesugar.org/guides/derive) -- auto-derive codec instances
