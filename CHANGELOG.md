# Changelog

All notable changes will be documented here. The project follows Semantic
Versioning once a public API is declared stable.

## Unreleased

- Add typed, lossless ASCII records with source spans and mutation helpers.
- Add nanometer coordinate normalization for BASIC, MILS, INCHES, and METRIC.
- Add checked binary field readers, section mutation, and a versioned section
  inventory.
- Add structured diagnostics, decode coverage, inspection, validation, strict
  conversion reports, and the `padsts` CLI.
- Add source-linked SVG IDs, normalized/source-unit board-coordinate zooms,
  compound copper polarity masks, and expanded visual snapshots.
- Move experimental Circuit JSON conversion into the dedicated
  `pads-to-circuit-json` adapter package.

## 0.0.1

- Initial lossless PADS ASCII and native-binary containers and Gerber-style SVG
  visualization.
