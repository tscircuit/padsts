# padsts

TypeScript-first parsing and serialization for PADS PCB files.

`padsts` is being built as a lossless document library first. Conversion to
Circuit JSON or KiCad belongs in adapters layered on top of the parser, so the
source document remains inspectable and unsupported records are never silently
discarded.

## Current scope

- Detect PADS ASCII, native PADS binary, and unknown inputs.
- Parse PADS ASCII into ordered section objects.
- Preserve known and unknown ASCII sections byte-for-byte through `getString()`.
- Parse the native binary header, version-dependent section directory, section
  byte ranges, unassigned trailing bytes, and footer.
- Preserve a parsed binary file byte-for-byte through `getBytes()`.
- Reject truncated or out-of-bounds binary section tables.

The binary parser currently exposes safe opaque sections. Typed decoders for
layers, pad stacks, decals, placements, nets, routes, text, outlines, and pours
are the next milestones.

## Usage

```ts
import { parsePads } from "padsts"

const sourceBytes = new Uint8Array(await Bun.file("board.pcb").arrayBuffer())
const document = parsePads(sourceBytes)

if (document.kind === "binary") {
  console.log(document.version, document.directoryEntries.length)
} else {
  console.log(document.version, document.sections.map((section) => section.name))
}
```

Use the format-specific functions when the dialect is already known:

```ts
import { parsePadsAscii, parsePadsBinary } from "padsts"
```

## Why lossless parsing comes first

PADS ASCII is documented well enough to decode section-by-section. Native
`.pcb` files are an undocumented, versioned binary format. A usable converter
therefore needs two properties before detailed decoding begins:

1. strict bounds checks, so malformed directory entries cannot produce unsafe
   reads; and
2. preservation of every unknown byte, so partial support does not destroy the
   source document.

See [docs/roadmap.md](docs/roadmap.md) for the staged conversion plan and
[docs/interoperability.md](docs/interoperability.md) for implementation and
licensing boundaries.

## Development

```sh
bun install
bun run check
```

## License

MIT
