# Native PADS section map

This map records observations, not vendor documentation. All unknown bytes are
preserved. Confidence must only increase when multiple licensed fixtures and
field invariants agree.

## Container

| Field | Observation | Confidence |
| --- | --- | --- |
| Bytes 0–1 | `00 FF` magic | Verified |
| Bytes 2–3 | Little-endian version | Verified |
| Header size | 10 bytes | Verified |
| Directory entry | 16 bytes; count at +0, byte length at +4 | Verified |
| Directory count | 73 for 0x2021, 74 for 0x2025–0x2027 | Verified |
| Footer | 46 bytes; GUID text at +4, stored body size at +42 | Verified |

The parser checks every section end against the footer and reports fixed-record
size mismatches where a layout is known. Section mutation recomputes byte
lengths, offsets derived from directory order, and the stored footer size.

## Observed non-empty sections

| Section | Working name | Status | Evidence currently used |
| ---: | --- | --- | --- |
| 1 | Board setup | Partial | Candidate layer count at +16; origin at +60/+64 |
| 8 | Text | Experimental | Plausibility-gated fields plus section 57 strings |
| 12 | Vertices | Strong candidate | Fixed 12-byte records; signed X/Y candidates |
| 21 | Drawing objects | Experimental | 0x2026 candidate outline relationship |
| 22 | Placements | Experimental | Reference, position, rotation after 0x2021 |
| 24 | Connections | Experimental | Debug-only candidate relationships |
| 57 | String pool | Partial | Printable ASCII recovery |
| 59 | Route endpoints/vias | Experimental | Debug-only positions; no invented aperture |
| 60 | Route vertices | Experimental | Debug-only paths |
| Other | Unknown | Opaque | Counted and preserved losslessly |

`getPadsBinarySectionRegistry(version, sectionCount)` is the executable form of
this table. `inspectPads()` inventories every non-empty section and classifies
its byte length as decoded, partial, or opaque.

## Version discipline

No field is considered verified merely because it looks plausible in one
fixture. Record offsets, signedness, units, references, flags, and version
differences require independent evidence. Candidate routes and vias remain in
debug layers and cannot silently become fabrication copper.
