# Downloaded PADS test assets

Run:

```sh
bun run test:download-assets
bun run test:assets
```

The downloader writes verified files under `tests/assets/downloaded/`. That
directory is gitignored; the repository stores only the manifest, source links,
license links, expected byte lengths, and Git blob hashes.

The pinned KiCad QA corpus includes:

- two PADS ASCII fixtures;
- a native binary `0x2021` board;
- a native binary `0x2025` board;
- a native binary `0x2026` board; and
- a native binary `0x2027` board.

The complete manifest is in
[`scripts/test-assets.ts`](../../scripts/test-assets.ts).

## RK3326 target

The known `RK3326_LPDDR3.pcb` source requires paid access and does not expose a
stable, authorized direct download URL. After obtaining it legitimately, place
it at:

```text
tests/assets/downloaded/targets/rk3326-lpddr3.pcb
```

The integration suite discovers that path automatically and exercises format
detection, parsing, and byte-for-byte serialization.
