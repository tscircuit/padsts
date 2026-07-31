# Reverse-engineering contribution guide

Native PADS decoding must be evidence-driven and legally clean.

## Evidence for a field

A proposed field meaning should include:

1. at least two independently varied fixtures, preferably across versions;
2. the exact section, record size, offset, width, endianness, and signedness;
3. a controlled source edit and the corresponding byte difference;
4. physical-unit and coordinate-sign reasoning;
5. valid/invalid reference-index behavior;
6. focused assertions and a visual snapshot when geometry changes; and
7. a confidence label: unknown, experimental, strong candidate, or verified.

Avoid assigning meaning from a single visually plausible number. Keep
unverified output in debug geometry and preserve all trailing bytes.

## Fixtures and licensing

Only commit fixtures that are independently created or clearly redistributable.
For external fixtures, record the source URL, immutable revision, license,
expected byte length, and cryptographic/blob hash. Private or purchased boards
must remain local and gitignored; add only a local expected-results manifest
when redistribution is prohibited.

The downloader must pin immutable sources and verify hashes after every cache
restore. A hash mismatch is a hard failure.

## Clean-room boundary

Do not copy GPL implementation code, structure, comments, or generated tables
from KiCad or other incompatible projects. Public documentation and black-box
interoperability observations may inform an independent implementation. Record
facts and experiments in this repository, not another program's expression of
them. See [interoperability.md](interoperability.md).

## Submitting changes

Keep lossless round trips green, add checked reads for every new binary field,
attach source provenance, inventory unknown bytes, add semantic assertions, and
use `toMatchSvgSnapshot(import.meta.path)` for each focused visual test file.
Run `bun run check` before requesting review.
