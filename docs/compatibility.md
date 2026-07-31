# PADS compatibility

`padsts` separates lossless parsing from semantic decoding. “Preserved” means
the original bytes survive round-trip serialization; it does not imply that the
record can be fabricated or converted.

| Area | PADS ASCII | Native PADS binary |
| --- | --- | --- |
| Container round trip | Supported | Supported for 0x2021, 0x2025, 0x2026, 0x2027 |
| Typed records/source spans | Supported per line | Partial for observed records |
| Units | BASIC, MILS, INCHES, METRIC | BASIC candidate; version scale not independently verified |
| Layer metadata | Simple `LAYER` and `MISC` layer data | Candidate count only |
| Board outline | Straight and circular-arc `LINES` | Experimental 0x2026 candidate |
| Routes | Straight segments and exact circular arcs | Debug-only candidates |
| Vias | Named round/square stacks, drills, layer spans | Debug-only positions |
| Components | Placements and resolved basic decals | Candidate placements |
| Pads/holes | Round, square, rectangular, oval, rounded/chamfered; round/slot drills | Not decoded |
| Decal graphics | Lines, circles, arcs, positive/negative copper, keepouts | Not decoded |
| Text | Basic board text | Experimental candidate |
| Nets/connectivity | Net names on supported routes | Not verified |
| Pours/thermals | Preserved, not conversion-grade | Preserved, opaque |
| Circuit JSON | Experimental exact subset | Experimental candidate subset |

## Reliability labels

- **Supported**: tested semantic behavior with source provenance.
- **Partial**: useful decoded fields coexist with preserved unknown fields.
- **Experimental**: an evidence-backed candidate kept away from fabrication
  output unless explicitly selected.
- **Opaque**: safely preserved without semantic meaning.

Strict conversion fails when records are skipped, malformed, approximate,
inferred, opaque, or missing provenance. Native binary conversion is therefore
expected to fail strict mode until the remaining section layouts are verified.

KiCad export belongs in a separate adapter (preferably through `kicadts`) so
PADS source parsing never depends on KiCad's model. Gerber/Excellon generation
should similarly consume validated Circuit JSON or a future conversion-grade
normalized model.
