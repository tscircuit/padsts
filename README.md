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
- Normalize decoded coordinates to explicit nanometers while retaining source
  units and provenance.
- Inspect, validate, report conversion coverage, and produce Gerber-style SVG.

Native binary semantics remain partial. Every non-empty section is inventoried
as decoded, partial, or opaque; unverified route and via candidates remain
debug-only.

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

Inspect or validate from the command line:

```sh
padsts inspect board.asc
padsts inspect board.pcb --json
padsts validate board.asc
padsts validate board.asc --strict
padsts to-svg board.asc -o board.svg --layers F_Cu,B_Cu,Drill,Edge_Cuts
padsts to-svg board.asc -o detail.svg --viewbox 0,0,25000000,15000000
padsts to-svg board.asc -o detail.svg --viewbox 0,0,1000,600 --viewbox-source-units
padsts report board.pcb --strict
```

Exit code `0` means success, `1` means semantic/strict validation failed, and
`2` means usage, file I/O, or parsing failed.

Use the format-specific functions when the dialect is already known:

```ts
import { parsePadsAscii, parsePadsBinary } from "padsts"
```

Generate a physical/debug SVG directly from source bytes or from a parsed
document:

```ts
import { generateSvgFromPads } from "padsts"

const sourceBytes = await Bun.file("board.pcb").bytes()
const svg = generateSvgFromPads(sourceBytes)
await Bun.write("board.svg", svg)
```

The SVG contains supported decoded outlines, routes, vias, text, and placements
using Gerber-style normalized board coordinates, reusable aperture flashes, a
global Y-axis flip, and named fabrication-layer groups such as `F_Cu`, `B_Cu`,
`F_Silkscreen`, and `Edge_Cuts`. Copper layers use the same red/blue/internal
layer palette as tscircuit's Gerber snapshots. Resolved ASCII vias preserve
distinct top, inner, bottom, and specific-layer round or square pad apertures,
including partial layer spans. Basic ASCII part-decal terminals and round,
square, rectangular-finger, and oval-finger surface pads are resolved through
part types and transformed onto top or bottom copper. Mounted-side round and
slotted drills preserve plating, slot orientation and offset, and render in an
Excellon-style `Drill` group independently of offset copper fingers. Rounded
and chamfered square/rectangular pads are also preserved. Basic part-decal
`OPEN`, `CLOSED`, and `CIRCLE` graphics, including exact circular arcs, are
transformed through top and mirrored bottom placements. Layer names, types,
roles, and sides decoded from `LAYER` and nested `MISC` `LAYER DATA` records
place these graphics on front/back silkscreen, fabrication, mask, paste,
drill-drawing, or user-drawing groups without treating ordinary component
outlines as copper. Positive `COPCLS`, `COPOPN`, and `COPCIR` pieces preserve
pin and tag-group association and render on physical copper, mask, or paste
layers. `KPTCLS` and `KPTCIR` pieces retain their PADS restriction codes and
render as Gerber-style keepout artwork. Compound negative `COPCUT` and `COPCCO`
geometry uses per-layer SVG polarity masks so clear regions subtract from
positive copper on top and mirrored bottom placements. Experimental
native-binary route and via candidates are withheld from fabrication layers.

Parser diagnostics and decoded counts are retained in SVG metadata. Optional
binary section and unresolved-vertex overlays can be enabled explicitly:

```ts
const debugSvg = generateSvgFromPads(sourceBytes, {
  showBinarySectionSummary: true,
  showUnassignedVertices: true,
  showUnverifiedConnections: true,
  visibleGerberLayers: [
    "Dwgs_User",
    "Edge_Cuts",
    "Debug_Vertices",
    "Debug_Connections",
  ],
})
```

`visibleGerberLayers` can also produce single-layer, copper-only, or drill-only
inspection views without changing the parsed geometry.

Use `viewBox` to inspect a smaller window. Coordinates are normalized
nanometers by default. Set `viewBoxUnits: "source"` to copy coordinates
directly from a MILS, METRIC, INCHES, or BASIC PADS file. `x` and `y` are the
lower-left board-coordinate corner; the renderer applies unit normalization and
the SVG Y-axis conversion automatically:

```ts
const zoomedSvg = generateSvgFromPads(sourceBytes, {
  width: 1000,
  viewBox: {
    x: -10_500,
    y: -22_500,
    width: 18_000,
    height: 12_000,
  },
  viewBoxUnits: "source",
  visibleGerberLayers: ["F_Cu", "B_Cu", "Drill", "Edge_Cuts"],
  showPlacements: false,
  showText: false,
})
```

Artwork is clipped to the decoded board outline by default. Set
`clipArtworkToBoardOutline: false` when a coordinate window intentionally
inspects staged or off-board parts; the physical board substrate remains
outline-clipped.

## Inspection and validation reports

```ts
import {
  createPadsConversionReport,
  inspectPads,
  validatePads,
} from "padsts"

const inspection = inspectPads(sourceBytes)
console.log(inspection.sections, inspection.coverage)

const validation = validatePads(sourceBytes, { strict: true })
if (!validation.valid) console.error(validation.report.diagnostics)

const report = createPadsConversionReport(sourceBytes, { strict: true })
```

Inspection and report objects are JSON-serializable and schema-versioned.
Strict validation reports unsupported, malformed, approximate, inferred,
opaque, or unaccounted source data. Every report diagnostic includes source
provenance when available.

Circuit JSON conversion lives in
[`pads-to-circuit-json`](https://github.com/tscircuit/pads-to-circuit-json).
That adapter consumes the parsed document and normalized geometry from this
package while keeping target-specific mapping policy and visual comparisons out
of the lossless parser.

## Why lossless parsing comes first

PADS ASCII is documented well enough to decode section-by-section. Native
`.pcb` files are an undocumented, versioned binary format. A usable converter
therefore needs two properties before detailed decoding begins:

1. strict bounds checks, so malformed directory entries cannot produce unsafe
   reads; and
2. preservation of every unknown byte, so partial support does not destroy the
   source document.

See [CHECKLIST.md](CHECKLIST.md) for the detailed implementation status,
[docs/roadmap.md](docs/roadmap.md) for the staged conversion plan, and
[docs/compatibility.md](docs/compatibility.md) for the feature matrix. Public
API stability is documented in [docs/public-api.md](docs/public-api.md);
native evidence lives in
[docs/native-section-map.md](docs/native-section-map.md). Contributors should
also read [docs/reverse-engineering.md](docs/reverse-engineering.md),
[docs/interoperability.md](docs/interoperability.md), and
[SECURITY.md](SECURITY.md).

## Development

```sh
bun install
bun run check
```

Download the pinned real-world PADS fixtures and run their integration tests:

```sh
bun run test:download-assets
bun run test:assets
bun run test:svg
```

Downloaded files are verified and gitignored. See
[tests/assets/README.md](tests/assets/README.md) for the source manifest and the
optional RK3326 target fixture.

## License

MIT
