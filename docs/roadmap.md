# PADS conversion roadmap

The parser and converters are deliberately separate. `padsts` should model the
source accurately; adapters can then emit Circuit JSON, KiCad, or diagnostic
reports without weakening round-trip behavior.

## Milestone 1: lossless containers

- Detect ASCII and native binary files.
- Parse ASCII sections without normalizing whitespace or line endings.
- Parse native binary headers and section directories with bounds checks.
- Preserve unknown ASCII records and binary sections exactly.

## Milestone 2: board setup and inspection

- Decode units, origin, layer count, and layer names.
- Decode the binary string pool.
- Add human-readable and JSON inspection, validation, and strict reports.

## Milestone 3: library and placement

- Decode pad stacks.
- Decode part decals and footprint definitions.
- Decode parts, reference designators, placement, side, and rotation.

## Milestone 4: connectivity and geometry

- Decode net names and pin membership.
- Decode route vertices, traces, and vias.
- Decode board outlines, lines, and text.

## Milestone 5: copper and rules

- Decode copper pours and cutouts.
- Represent unsupported design rules as explicit diagnostics.
- Compare generated geometry against reference screenshots and independent
  importer output.

## Milestone 6: conversion adapters

- Implement PADS-to-Circuit JSON mapping in the separate
  [`pads-to-circuit-json`](https://github.com/tscircuit/pads-to-circuit-json)
  package.
- Optionally add a KiCad adapter through `kicadts`.
- Emit a conversion report listing every skipped or approximate source record.

The RK3326 target must only be added when its redistribution license permits it.
Until then, it remains a local gitignored target and cannot be a public release
gate.
