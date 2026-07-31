# padsts implementation checklist

This is the detailed source of truth for work required to turn `padsts` from a
lossless container parser and visualization aid into a reliable PADS conversion
library.

Checkbox meanings:

- `[x]` is implemented and covered by the current test suite.
- `[ ]` is incomplete. A parent remains unchecked until every nested acceptance
  item is complete.
- **Partial** means the current code is useful for investigation but must not be
  treated as a verified format decoder.

The central completion rule is:

> Every source record and binary byte range must either map to a typed,
> source-linked entity or appear in a structured conversion diagnostic.

## P0: correctness foundations

### Lossless document containers

- [x] Detect PADS ASCII input.
- [x] Detect native PADS binary input by magic bytes.
- [x] Return `unknown` for arbitrary input.
- [x] Preserve PADS ASCII source text byte-for-byte through `getString()`,
  including preamble text, whitespace, and mixed line endings.
- [x] Preserve native binary files byte-for-byte through `getBytes()`.
- [x] Preserve unknown ASCII sections.
- [x] Preserve opaque native binary sections and trailing bytes.
- [x] Report parse errors with source offsets.
- [ ] Add mutation-aware serialization.
  - [ ] Permit typed ASCII records to be added, edited, and removed.
  - [ ] Re-emit changed records without normalizing unrelated source text.
  - [ ] Permit supported binary fields to be edited without losing opaque
    fields or sections.
  - [ ] Recalculate binary directory lengths, record counts, offsets, footer
    size, and checks when a binary document changes.
  - [ ] Add parse → edit → serialize → parse tests for every mutable entity.
- [ ] Add a shared source-provenance model.
  - [ ] Give every decoded ASCII record a section, line, and byte span.
  - [ ] Give every decoded binary record a section, record index, and byte
    range.
  - [ ] Preserve stable source IDs through normalized geometry and conversion.
  - [ ] Include source provenance in all warnings and conversion diagnostics.

### Units and coordinates

- [x] Read `BASIC`, `MILS`, and `METRIC` from an ASCII file header.
- [x] Read a candidate binary origin from setup section 1.
- [x] Read a candidate binary layer count from setup section 1.
- [ ] Define one explicit internal coordinate unit.
- [ ] Verify the scale and sign of every binary coordinate version by version.
- [ ] Convert `BASIC`, `MILS`, and `METRIC` ASCII coordinates without relying on
  renderer-specific assumptions.
- [ ] Model file origin, board origin, and local decal origins separately.
- [ ] Define and test top-view/bottom-view rotation and mirroring conventions.
- [ ] Reject or diagnose non-finite, implausible, or overflowed coordinates.
- [ ] Add coordinate round-trip tests with negative values, large values, and
  each supported unit system.

### Structured diagnostics and coverage

- [x] Report binary footer marker and stored-size mismatches.
- [x] Attach geometry-decoder notes to SVG metadata.
- [ ] Replace free-form geometry diagnostic strings with typed diagnostic
  objects.
  - [ ] Define stable diagnostic codes and severities.
  - [ ] Include source provenance and affected entity IDs.
  - [ ] Distinguish unsupported, malformed, approximate, and inferred data.
  - [ ] Make diagnostics serializable as JSON.
- [ ] Track semantic decode coverage.
  - [ ] Count decoded, partially decoded, skipped, and malformed ASCII records.
  - [ ] Count decoded, partially decoded, and opaque binary records by section.
  - [ ] Account for every byte in every binary record.
  - [ ] Fail strict conversion when unreported source data would be dropped.
  - [ ] Include coverage totals in the inspection CLI and conversion report.

## P0: PADS ASCII semantic parser

The current ASCII document parser is lossless, but the geometry extractor
re-parses raw section text with lightweight token heuristics. Replace that path
with a typed ASCII AST.

### Section hierarchy and tokenization

- [ ] Distinguish true top-level sections from nested markers such as
  `*SIGNAL*` and `*REMARK*`.
- [ ] Add all known top-level names to the typed section registry, including
  `ROUTE`, `VIA`, `NET`, `LAYER`, and `TESTPOINT`.
- [ ] Preserve unknown top-level and nested records without accidentally
  splitting their parent sections.
- [ ] Implement quoted strings, embedded spaces, escaped text, blank fields,
  continuation records, comments, and version-specific field counts.
- [ ] Give each parsed line a typed record kind or an explicit unknown-record
  node.
- [ ] Validate required section ordering and the `*END*` terminator without
  preventing lossless inspection of malformed files.
- [ ] Add focused fixtures for each header form and nested marker.

### Board setup and layers

- [ ] Parse `PCB` setup records into typed fields.
  - [ ] Units and coordinate precision.
  - [ ] Origin and extents.
  - [ ] Maximum layer count.
  - [ ] Default trace, via, clearance, and grid settings.
  - [ ] Any version or application metadata.
- [ ] Parse `LAYER` records.
  - [ ] Layer number, name, type, electrical role, and side.
  - [ ] Layer stack ordering.
  - [ ] Plane, routing, mask, paste, silkscreen, assembly, and mechanical roles.
  - [ ] Explicit mapping to normalized fabrication layer names.

### Lines, outlines, and text

- [x] Extract straight `LINES` paths and simple circle pieces for visualization.
- [x] Identify `BOARD`, copper, and keepout line objects heuristically.
- [x] Extract basic free-text position, rotation, layer, height, stroke width,
  and mirror flag.
- [ ] Parse every line-piece kind into typed geometry.
  - [ ] Open and closed polylines.
  - [ ] Circles.
  - [x] Arc-annotated `LINES` vertices with exact center, radius, direction, and
    sweep.
  - [ ] Curves or other version-specific primitives.
  - [ ] Board cutouts and nested contours.
  - [ ] Copper and keepout contours.
- [x] Stop rendering arc-annotated `LINES` vertices as straight segments.
- [ ] Decode line styles, widths, restrictions, ownership, and layer semantics.
- [ ] Parse text alignment, font, justification, visibility, ownership, and
  multiline content.
- [ ] Convert text to deterministic stroke geometry when fabrication output
  requires it.

### Via and pad-stack library

- [ ] Parse `VIA` definitions.
  - [ ] Via name and type.
  - [ ] Drill diameter and plating.
  - [ ] Start and end layers.
  - [ ] Per-layer pad shape and dimensions.
  - [ ] Thermal, clearance, and antipad definitions.
  - [ ] Blind, buried, microvia, and through-via distinctions.
- [ ] Parse reusable pad stacks independently of placed vias.
- [ ] Resolve every routed via instance to its library definition.
- [ ] Remove hard-coded visualization diameters and drill sizes.

### Footprints, parts, and placements

- [x] Extract basic `PART` reference, footprint name, position, rotation, and a
  candidate bottom-side flag for visualization.
- [x] Accept numeric footprint names such as `0402` and `0805` without
  misclassifying part text records as placements.
- [ ] Parse `PARTDECAL` footprint definitions.
  - [ ] Decal origin and units.
  - [ ] Pads and terminals.
  - [ ] Pad-stack references.
  - [ ] Silkscreen, assembly, courtyard, and fabrication graphics.
  - [ ] Reference/value text templates.
  - [ ] Copper, keepout, and placement-outline primitives.
- [ ] Parse `PARTTYPE` definitions.
  - [ ] Part type name and decal alternatives.
  - [ ] Gate and pin definitions.
  - [ ] Pin numbers, names, swaps, and electrical types where present.
- [ ] Parse complete `PART` instances.
  - [ ] Reference, value, part type, and selected decal.
  - [ ] Position, rotation, side, lock state, and visibility.
  - [ ] Attributes and variant data.
  - [ ] Pin instances transformed into board coordinates.
- [ ] Resolve part → part type → decal → pad-stack references.
- [ ] Render actual footprint geometry instead of placement crosses.

### Nets, routes, and test points

- [x] Extract basic ASCII route segments and net names heuristically.
- [x] Detect some inline via markers heuristically.
- [x] Omit layer-0 ratlines from fabrication geometry.
- [x] Require an explicit via name instead of treating thermal flags as vias.
- [ ] Parse `NET` and nested `SIGNAL` records.
  - [ ] Net names and stable IDs.
  - [ ] Part/pin membership.
  - [ ] Unconnected pins and no-connect markers.
  - [ ] Net classes and constraints where present.
- [ ] Parse `ROUTE` records exactly.
  - [ ] Segment endpoints and path continuity.
  - [ ] Layer transitions.
  - [ ] Width and width changes.
  - [ ] Via references and flags.
  - [ ] Arc segments.
  - [ ] Teardrops, tuning, or other route annotations.
- [ ] Validate that routed endpoints resolve to pins, vias, or other route
  vertices.
- [ ] Parse `TESTPOINT` records and associate them with nets and placed pads.

### Copper, reuse, and rules

- [ ] Parse `POUR` objects.
  - [ ] Outer contours and cutouts.
  - [ ] Layer, net, priority, clearance, and fill style.
  - [ ] Thermal relief and spoke settings.
  - [ ] Hatch and island behavior.
- [ ] Parse reusable blocks in `REUSE`.
- [ ] Parse relevant `MISC` records and design rules.
- [ ] Preserve unsupported rules as typed records and explicit diagnostics.
- [ ] Add ASCII AST serializers for every supported section.

## P0: native PADS binary semantic parser

The current native parser safely exposes the container. Entity decoding is
partial and based on a small number of observed record offsets.

### Container and version handling

- [x] Support container versions `0x2021`, `0x2025`, `0x2026`, and `0x2027`.
- [x] Parse the 10-byte header.
- [x] Parse 73 directory entries for `0x2021` and 74 for later known versions.
- [x] Bounds-check section lengths against the footer.
- [x] Preserve directory entry bytes, sections, trailing bytes, and footer.
- [ ] Document every known header and directory-entry field.
- [ ] Validate record count and byte length combinations.
  - [ ] Diagnose non-integral record sizes where fixed-size records are
    expected.
  - [ ] Guard every offset and multiplication against unsafe integer overflow.
  - [ ] Detect impossible empty/non-empty count and length combinations.
- [ ] Add an opt-in opaque-container mode for unknown future versions.
- [ ] Build a versioned section registry rather than scattering numeric section
  IDs and offsets through geometry code.
- [ ] Document a section map for every supported version with confidence levels
  and fixture evidence.

### Shared binary decoding infrastructure

- [ ] Promote `BinarySectionReader` into a tested reusable module.
- [ ] Add checked reads for signed/unsigned 8-, 16-, 32-, and 64-bit values,
  floats if present, flags, fixed strings, and string references.
- [ ] Return structured field-level errors instead of silently returning
  `undefined`.
- [ ] Define version-specific record layouts declaratively.
- [ ] Validate reference indices before resolving them.
- [ ] Add a two-pass decoder so records can be parsed before cross-section
  references are resolved.
- [ ] Keep unknown fields and per-record trailing bytes available to callers.

### Setup, layers, and strings

- [x] Read candidate origin coordinates at setup-section offsets 60 and 64.
- [x] Read a candidate layer count at setup-section offset 16.
- [x] Resolve basic printable ASCII strings from section 57.
- [ ] Verify setup-section layouts independently for `0x2021`, `0x2025`,
  `0x2026`, and `0x2027`.
- [ ] Decode units, precision, board origin, layer stack, and layer names.
- [ ] Decode layer types and top/bottom/internal fabrication roles.
- [ ] Decode all setup and design-rule fields that affect conversion.
- [ ] Decode the complete string-pool format.
  - [ ] Encoding and non-ASCII text.
  - [ ] Empty, shared, and invalid references.
  - [ ] Version-specific offsets or pool organization.
  - [ ] Ownership and lifetime of string references.

### Vertices, outlines, and drawing primitives

- [x] Read candidate X/Y values from 12-byte section-12 records.
- [x] Display section-12 points as optional unresolved debug vertices.
- [ ] Decode every section-12 record field, including flags and reference
  relationships.
- [ ] Determine whether section 12 mixes vertices for outlines, decals, pours,
  text, or other entities.
- [ ] Decode exact arc and curve records.
- [ ] Decode board outlines for all supported versions.
- [ ] Verify the meaning of section 21.
  - [ ] Replace the current `0x2026` candidate-path heuristic.
  - [ ] Identify vertex start/count semantics without assuming sequential
    consumption.
  - [ ] Decode width, layer, closure, object type, and ownership.
  - [ ] Distinguish board edges, cutouts, drawings, copper, and keepouts.
- [ ] Validate contour closure and nesting before using outlines as SVG clips.

### Text

- [x] Partially read section-8 text using strings from section 57.
- [ ] Verify section-8 layouts for each supported version.
- [ ] Decode text ownership, layer, position, height, stroke width, rotation,
  mirroring, alignment, font, visibility, and content.
- [x] Reject implausible field combinations instead of rendering garbage text.
- [ ] Fix the `0x2021` fixture's incorrect text position, rotation, and content.
- [ ] Add entity-count and field-value assertions for known text fixtures.

### Library, pad stacks, and decals

- [ ] Identify and decode via and pad-stack sections.
- [ ] Decode per-layer pad shapes, sizes, offsets, rotations, drill sizes,
  plating, antipads, and thermals.
- [ ] Identify and decode footprint/decal definitions.
- [ ] Decode decal primitives, pads, terminal numbers, text templates, and
  local origins.
- [ ] Identify and decode part-type and pin-definition records.
- [ ] Resolve library references across sections with stable IDs.

### Placements

- [x] Partially read reference, X/Y, and rotation from section 22 for versions
  after `0x2021`.
- [ ] Verify section-22 layouts for every supported version.
- [ ] Decode `0x2021` placement Y coordinates.
- [ ] Decode footprint/decal and part-type references.
- [ ] Decode top/bottom side, mirroring, lock state, visibility, and attributes.
- [ ] Validate reference strings and reject false-positive records.
- [ ] Transform footprint pads and graphics into board coordinates.
- [ ] Assert known placement counts and representative coordinates per fixture.

### Nets, route vertices, traces, and vias

- [x] Experimentally read candidate connection records from section 24.
- [x] Experimentally read candidate route vertices from section 60.
- [x] Experimentally read candidate via/end-point positions from section 59.
- [x] Keep unverified route/via candidates out of fabrication layers and expose
  them only through an opt-in debug layer.
- [ ] Replace route-marker scanning with verified versioned record layouts.
- [ ] Verify whether route indices are zero-based, one-based, global, or scoped.
- [ ] Decode connection ownership and endpoint types.
- [ ] Decode net IDs and resolve net names.
- [ ] Decode actual copper layer IDs instead of assigning all binary routes to
  layer 0 / `F_Cu`.
- [ ] Decode exact trace widths instead of trusting one unverified offset.
- [ ] Decode multi-vertex paths and path ordering.
- [ ] Decode arc segments, flags, tuning, teardrops, and other route features.
- [ ] Decode vias using referenced pad stacks.
  - [ ] Position.
  - [ ] Drill and annular geometry.
  - [ ] Plating.
  - [ ] Start/end layers.
  - [ ] Net.
  - [ ] Via type.
- [x] Remove hard-coded binary via radius and annular width from fabrication
  geometry.
- [x] Eliminate the long spurious segments from EMS4 and TMS fabrication SVG
  snapshots by quarantining unverified candidates in the debug view.
- [ ] Add route invariants.
  - [ ] Referenced vertex indices exist.
  - [ ] Segment endpoints are within credible board bounds.
  - [ ] Layer transitions have a valid via or transition record.
  - [ ] Widths and coordinates are physically plausible.
  - [ ] Every decoded connection belongs to a net or has an explicit reason not
    to.
- [ ] Decode native routes for `0x2021`.

### Copper, rules, and remaining sections

- [ ] Identify and decode net, pin-membership, and connectivity sections.
- [ ] Identify and decode pour, cutout, thermal, and hatch sections.
- [ ] Identify and decode keepout and rule-area sections.
- [ ] Identify and decode test-point records.
- [ ] Identify and decode reuse-block records.
- [ ] Identify and decode design rules and constraints.
- [ ] Inventory every non-empty section in every fixture.
- [ ] Require each non-empty section to have a decoder, an opaque typed wrapper,
  or an explicit unsupported-section diagnostic.

## P1: normalized board model

- [x] Expose a small visualization model containing paths, circles, text,
  placements, layer metadata, and diagnostics.
- [ ] Create a conversion-grade board model independent of ASCII/binary layout.
- [ ] Model the complete layer stack with stable layer IDs and fabrication
  roles.
- [ ] Model components, footprint definitions, footprint instances, pads,
  terminals, and holes.
- [ ] Model nets, pin membership, traces, vias, and connectivity.
- [ ] Model exact lines, arcs, circles, polygons, and polygons with holes.
- [ ] Model round, rectangular, rounded-rectangle, oval/pill, polygon, and
  custom pads.
- [ ] Model plated and non-plated holes, slots, offsets, and layer spans.
- [ ] Model copper pours, cutouts, thermals, keepouts, and rule areas.
- [ ] Model silkscreen, fabrication, assembly, courtyard, dimensions, and free
  text.
- [ ] Model test points, reuse blocks, variants, and source attributes where
  present.
- [ ] Attach source provenance and confidence to every normalized entity.
- [ ] Preserve unknown source records alongside normalized entities.
- [ ] Validate referential integrity and geometry before conversion.
- [ ] Make the SVG renderer consume only the normalized model; remove duplicate
  raw ASCII tokenization from visualization code.

## P1: SVG and visual verification

- [x] Generate SVG from a parsed document, string, or byte array.
- [x] Use native-coordinate `viewBox` values and one global Y-axis flip.
- [x] Group artwork into Gerber-style `F_Cu`, internal copper, `B_Cu`,
  silkscreen, drill, and edge-cut layers.
- [x] Use reusable SVG aperture definitions for via flashes.
- [x] Render explicit drill holes.
- [x] Clip artwork to a decoded board outline when available.
- [x] Preserve diagnostics and decoded counts in SVG metadata.
- [x] Keep binary section and unresolved-vertex overlays opt-in.
- [x] Snapshot every downloaded fixture with
  `toMatchSvgSnapshot(import.meta.path)`.
- [x] Render exact circular arcs.
- [ ] Render other curve primitives.
- [ ] Render footprint pads and graphics from decoded decals.
- [ ] Render verified pad-stack shapes and drill geometry.
- [ ] Render correct binary layer assignments.
- [ ] Render verified board edges and cutouts for every binary version.
- [ ] Add solder-mask, solder-paste, fabrication, assembly, courtyard, and
  keepout layers when the source contains them.
- [ ] Render pours with cutouts and thermal reliefs.
- [ ] Make bottom-side mirroring match fabrication conventions.
- [ ] Convert fabrication text to deterministic vector strokes so snapshots do
  not depend on system fonts.
- [ ] Make bounds robust against corrupt or partially decoded entities.
  - [x] Prevent pathological intrinsic sizes such as the very tall `0x2021`
    snapshot.
  - [ ] Report excluded outliers rather than silently trimming them.
  - [ ] Prefer verified board edges over placements and text.
- [ ] Add selectable render modes.
  - [x] Arbitrary single or multiple fabrication layers.
  - [ ] Top composite.
  - [ ] Bottom composite.
  - [x] Full copper overlay.
  - [x] Debug/coverage view.
- [ ] Use stable, source-linked element IDs and `data-*` attributes.
- [ ] Add semantic assertions alongside image snapshots.
  - [ ] Expected layer names.
  - [ ] Expected entity counts.
  - [ ] Representative coordinates and dimensions.
  - [ ] No unexpected decoder diagnostics.
- [ ] Compare rendered geometry with an independent importer, not only prior
  `padsts` snapshots.

## P1: conversion and inspection APIs

### Inspection

- [ ] Add a public structured inspection API.
- [ ] Add a `padsts inspect <file>` CLI command.
  - [ ] Format, version, units, origin, and layer stack.
  - [ ] Section and record summary.
  - [ ] Entity counts.
  - [ ] Decode coverage.
  - [ ] Diagnostics with source locations.
  - [ ] JSON output mode.
- [ ] Add a `padsts validate <file>` command with meaningful exit codes.
- [ ] Add a `padsts to-svg <file>` command with layer and debug options.

### Circuit JSON

- [ ] Implement `toCircuitJson(document)`.
- [ ] Map board outline and cutouts.
- [ ] Map layer stack.
- [ ] Map components, footprints, pads, holes, and text.
- [ ] Map nets, ports/pins, traces, vias, and connectivity.
- [ ] Map pours, keepouts, and supported rule data.
- [ ] Preserve PADS source IDs in Circuit JSON metadata.
- [ ] Emit warnings for every approximation or skipped entity.
- [ ] Validate generated Circuit JSON against the current schema.
- [ ] Render generated Circuit JSON and compare it with the PADS SVG.
- [ ] Generate Gerber/Excellon files from converted Circuit JSON and compare
  them with known-good fabrication output.

### KiCad and fabrication adapters

- [ ] Decide and document whether KiCad export is in this package or a separate
  adapter package.
- [ ] If implemented, convert through `kicadts` without coupling the source AST
  to KiCad's model.
- [ ] Add a Gerber/Excellon export path through the normalized model or Circuit
  JSON.
- [ ] Keep conversion adapters separate from lossless source parsing.

### Conversion reports

- [ ] Define a machine-readable conversion report schema.
- [ ] List every skipped, approximate, inferred, or unsupported source entity.
- [ ] Include source provenance, diagnostic severity, and output entity IDs.
- [ ] Include per-section/record/byte decode coverage.
- [ ] Support a strict mode that refuses lossy conversion.

## P1: fixtures and verification

- [x] Pin downloadable fixtures to a source commit.
- [x] Verify downloaded fixtures with expected byte lengths and Git blob hashes.
- [x] Cover five ASCII boards and native binary versions `0x2021`, `0x2025`,
  `0x2026`, and `0x2027`.
- [x] Keep same-board ASCII references for the Dexter, EMS4, LCORE2, and TMS
  native binary fixtures.
- [x] Keep downloaded fixture contents gitignored.
- [x] Run parse and byte-for-byte round-trip tests for downloaded fixtures.
- [x] Run SVG snapshot tests for downloaded fixtures.
- [ ] Add a typed expected-results manifest for every fixture.
  - [ ] Units and layer count.
  - [ ] Board extents.
  - [ ] Component, pad, net, trace, via, text, outline, and pour counts.
  - [ ] Representative named entities and coordinates.
  - [ ] Expected diagnostics and decode coverage.
- [ ] Add small synthetic ASCII fixtures for every record type and edge case.
- [ ] Add minimal synthetic binary fixtures for every versioned record layout.
- [ ] Add malformed-record tests inside sections, not only malformed container
  tests.
- [ ] Add property and fuzz tests for both format detectors and parsers.
- [ ] Add memory and runtime limits for large or hostile files.
- [ ] Verify behavior on macOS, Linux, and Windows.
- [ ] Obtain the RK3326 target legitimately and add its local expected-results
  manifest.
  - [ ] Confirm version and file integrity.
  - [ ] Confirm byte-for-byte round trip.
  - [ ] Decode board setup and layer stack.
  - [ ] Decode the board outline and cutouts.
  - [ ] Decode the RK3326 and LPDDR3 footprints, pad stacks, and placements.
  - [ ] Decode nets, escape routing, vias, and copper layers.
  - [ ] Generate and review Gerber-style SVG snapshots.
  - [ ] Generate Circuit JSON and a complete conversion report.
- [ ] Add at least one independently created redistributable fixture for each
  supported binary version.
- [ ] Compare representative outputs against PADS itself or another independent
  importer when licensing and access permit.

## P2: documentation, CI, and release readiness

### Documentation

- [x] Document the lossless-first architecture.
- [x] Document the GPL interoperability boundary.
- [x] Record the currently known native container structure.
- [x] Document fixture sources, licenses, and manual RK3326 placement.
- [ ] Publish the versioned native section map and field observations.
- [ ] Document every public AST and normalized-model type.
- [ ] Document supported and unsupported PADS features in a compatibility
  matrix.
- [ ] Add end-to-end examples for inspect, SVG, Circuit JSON, and strict
  conversion.
- [ ] Add a reverse-engineering contribution guide.
  - [ ] Evidence requirements for assigning field meaning.
  - [ ] Fixture and licensing requirements.
  - [ ] Rules against copying GPL implementation code.
  - [ ] How to record confidence and version differences.
- [ ] Add a security policy for malformed/untrusted PCB files.

### Continuous integration

- [x] Install dependencies and download verified fixtures in GitHub Actions.
- [x] Run the Bun test suite in GitHub Actions.
- [ ] Run `bun run check` in CI so formatting, typechecking, tests, and build are
  all required.
- [ ] Use a pinned Bun version instead of `latest`.
- [ ] Add a frozen-lockfile install check.
- [ ] Upload SVG diff images when visual tests fail.
- [ ] Add a fixture-download cache that never bypasses hash verification.
- [ ] Add a cross-platform or at least Linux/macOS matrix for SVG dependencies.
- [ ] Add package tarball validation with `npm pack`.

### Package release

- [x] Export parser, geometry, and SVG APIs from the package entry point.
- [x] Generate ESM output and TypeScript declarations.
- [ ] Define the stability boundary between experimental decoders and supported
  public APIs.
- [ ] Add API-level tests against the built package.
- [ ] Add changelog and release notes.
- [ ] Add semantic-versioning and npm publication workflow.
- [ ] Verify package contents, license, provenance, and reproducible install
  before the first release.

## Completion gates

### Reliable visualization

- [ ] Every rendered entity comes from a typed record with source provenance.
- [ ] No hard-coded physical sizes remain.
- [ ] All supported arcs, pads, drills, layers, and cutouts render accurately.
- [ ] Every fixture has semantic assertions and reviewed SVG snapshots.
- [ ] Visual output contains no known spurious route segments or garbage text.

### Safe lossless conversion

- [ ] Every input record/byte range is decoded or explicitly reported.
- [ ] Strict mode produces no unreported loss.
- [ ] Parse and serialization remain byte-for-byte stable when no edits are
  made.
- [ ] Generated Circuit JSON validates and preserves connectivity.
- [ ] Gerber/Excellon output matches independently verified board geometry.

### RK3326 reference conversion

- [ ] The authorized RK3326 source file passes all fixture checks.
- [ ] Board outline, stackup, parts, pads, nets, routes, vias, and pours are
  decoded without heuristic placeholders.
- [ ] The generated visual is reviewed against the source tool or an independent
  importer.
- [ ] The conversion report has no unexplained records or binary byte ranges.
- [ ] Circuit JSON and fabrication outputs pass schema and geometry checks.
