# Public API and stability

## Stable lossless APIs

- `detectPadsFormat`, `parsePads`, `parsePadsAscii`, `parsePadsBinary`
- `PadsAsciiDocument#getString()` and `PadsBinaryDocument#getBytes()`
- ASCII section/record traversal and immutable mutation helpers
- binary section byte mutation helpers
- source-provenance and structured diagnostic shapes

Unchanged documents round trip exactly. Mutation helpers preserve unrelated
ASCII text and opaque binary bytes.

## Supported inspection APIs

- `inspectPads(source)` returns a JSON-serializable inventory.
- `validatePads(source, { strict })` returns a result and CLI-compatible exit
  code.
- `createPadsConversionReport(source, { strict })` reports semantic loss.

The report schema is versioned independently with `schemaVersion: "1"`.
Diagnostic codes are machine-readable; messages remain explanatory text.

## Experimental semantic APIs

- `extractPadsBoardGeometry`
- `generateSvgFromPads` / `generateSvgFromPadsGeometry`
- native section definitions whose confidence is not `verified`

These APIs are usable and tested but may gain fields or stricter validation
before 1.0. Experimental binary entities never enter fabrication layers by
default.

## Coordinates

Normalized geometry uses nanometers. Source units remain available as
`sourceUnits`; normalized geometry declares `coordinateUnit: "nanometer"`.
SVG `viewBox` windows use normalized board coordinates, with `x`/`y` describing
the lower-left board corner before the single SVG Y-axis flip. Set
`viewBoxUnits: "source"` to express that window in the original PADS file's
units; the renderer converts it to normalized nanometers before clipping and
rendering.

`BASIC` is exactly 2/3 nanometer per database unit, `MILS` is 25,400 nanometers,
`INCHES` is 25,400,000 nanometers, and `METRIC` is 1,000,000 nanometers per
source value.

## Source provenance

ASCII provenance includes section, line, and byte span. Binary provenance
includes section, optional record index, and byte span. Normalized entities and
SVG elements retain stable source IDs. `PadsBoardGeometry.documentSource`
provides a whole-document fallback for aggregate diagnostics that cannot be
assigned to one verified record. Inspection and validation reports therefore
attach provenance to every diagnostic. Target-specific conversion diagnostics
and output identity belong in separate adapter packages such as
[`pads-to-circuit-json`](https://github.com/tscircuit/pads-to-circuit-json).
