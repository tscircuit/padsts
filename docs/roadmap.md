# PADS conversion roadmap

The parser and converters are deliberately separate. `padsts` should model the
source accurately; adapters can then emit Circuit JSON, KiCad, or diagnostic
reports without weakening round-trip behavior.

## Milestone 1: lossless containers

- Detect ASCII and native binary files.
- Parse ASCII sections without normalizing whitespace or line endings.
- Parse native binary headers and section directories with bounds checks.
- Preserve unknown ASCII records and binary sections exactly.

## Milestone 2: board setup

- Decode units, origin, layer count, and layer names.
- Decode the binary string pool.
- Add a human-readable inspection CLI.

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

- Add `toCircuitJson(document)` after the AST is stable enough to describe the
  supported board features without lossy shortcuts.
- Optionally add a KiCad adapter through `kicadts`.
- Emit a conversion report listing every skipped or approximate source record.

The first real native `.pcb` fixture should be added only when its redistribution
license permits it. Until then, tests should use minimal synthetic containers
and user-provided files locally.
