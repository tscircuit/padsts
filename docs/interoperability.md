# Interoperability notes

PADS ASCII and native PADS binary are distinct formats. A `.asc` export is the
lower-risk input for conversion because its record structure is textual and
easier to validate. A native `.pcb` file needs version-aware binary decoding.

KiCad documents its PADS ASCII import path and maintains both ASCII and binary
importer sources:

- <https://gitlab.com/kicad/code/kicad/-/tree/master/pcbnew/pcb_io/pads>
- <https://github.com/KiCad/kicad-source-mirror/tree/master/pcbnew/pcb_io/pads>

KiCad is GPL-licensed. `padsts` is an independent MIT implementation: do not copy
KiCad implementation code into this repository. Interoperability research should
be recorded as format observations and verified against independently generated
fixtures or files that contributors are permitted to use.

The native container observations currently implemented here are:

- magic bytes `00 FF`;
- little-endian format versions `0x2021`, `0x2025`, `0x2026`, and `0x2027`;
- a 10-byte header;
- 73 directory entries for `0x2021` and 74 for later known versions;
- 16 bytes per directory entry, with count and byte length in the first 8 bytes;
- a 46-byte footer containing a GUID-shaped marker and a stored size field.

Detailed entity decoding must be driven by multiple fixtures. A field should
remain opaque until its meaning, units, sign, version behavior, and reference
relationships have all been verified.
