import { describe, expect, test } from "bun:test"
import {
  detectPadsFormat,
  extractPadsBoardGeometry,
  inspectPads,
  parsePads,
} from "../lib"
import {
  calculateGitBlobSha,
  downloadableTestAssets,
  getDownloadedTestAssetPath,
  manualTestAssets,
} from "../scripts/test-assets"
import { expectedResultsByAssetId } from "./assets/expected-results"

const downloadableAssetAvailability = await Promise.all(
  downloadableTestAssets.map(async (asset) => ({
    asset,
    isAvailable: await Bun.file(getDownloadedTestAssetPath(asset)).exists(),
  })),
)

const manualAssetAvailability = await Promise.all(
  manualTestAssets.map(async (asset) => ({
    asset,
    isAvailable: await Bun.file(getDownloadedTestAssetPath(asset)).exists(),
  })),
)

describe("downloaded PADS fixtures", () => {
  for (const { asset, isAvailable } of downloadableAssetAvailability) {
    test.skipIf(!isAvailable)(
      `${asset.id} parses and round-trips`,
      async () => {
        const assetPath = getDownloadedTestAssetPath(asset)
        const sourceBytes = await Bun.file(assetPath).bytes()

        expect(sourceBytes.byteLength).toBe(asset.expectedByteLength)
        expect(calculateGitBlobSha(sourceBytes)).toBe(asset.gitBlobSha)
        expect(detectPadsFormat(sourceBytes)).toBe(asset.format)

        const document = parsePads(sourceBytes)
        expect(document.kind).toBe(asset.format)

        const expected = expectedResultsByAssetId[asset.id]
        expect(expected).toBeDefined()
        if (expected) {
          const geometry = extractPadsBoardGeometry(document)
          const inspection = inspectPads(document)
          const actualBounds = inspection.bounds
            ? [
                inspection.bounds.minimumX,
                inspection.bounds.minimumY,
                inspection.bounds.maximumX,
                inspection.bounds.maximumY,
              ]
            : undefined
          expect({
            units: geometry.sourceUnits,
            layerCount: geometry.layerCount,
            ...(actualBounds ? { bounds: actualBounds } : {}),
            counts: {
              components: geometry.placements.length,
              pads: geometry.pads.length,
              holes: geometry.holes.length,
              nets: new Set(
                geometry.paths
                  .map(({ netName }) => netName)
                  .filter((netName): netName is string => Boolean(netName)),
              ).size,
              traces: geometry.paths.filter(({ kind }) => kind === "route")
                .length,
              vias: geometry.circles.filter(({ kind }) => kind === "via")
                .length,
              texts: geometry.texts.length,
              outlines: geometry.paths.filter(({ kind }) => kind === "outline")
                .length,
              pours: 0,
            },
            diagnosticCount: inspection.diagnostics.length,
            coverage: {
              sourceRecords: inspection.coverage.sourceRecordCount,
              partiallyDecodedRecords:
                inspection.coverage.partiallyDecodedSourceRecords,
              skippedRecords: inspection.coverage.skippedSourceRecords,
              binaryBytes: inspection.coverage.binaryByteLength,
              partiallyDecodedBytes:
                inspection.coverage.partiallyDecodedBinaryBytes,
              opaqueBytes: inspection.coverage.opaqueBinaryBytes,
            },
          }).toEqual(expected)
        }

        if (asset.format === "binary" && document.kind === "binary") {
          expect(document.version).toBe(asset.expectedVersion)
          expect(document.getBytes()).toEqual(sourceBytes)
        } else if (document.kind === "ascii") {
          expect(document.getString()).toBe(
            new TextDecoder().decode(sourceBytes),
          )
        }
      },
    )
  }
})

describe("manual target PADS fixtures", () => {
  for (const { asset, isAvailable } of manualAssetAvailability) {
    test.skipIf(!isAvailable)(
      `${asset.id} parses and round-trips`,
      async () => {
        const sourceBytes = await Bun.file(
          getDownloadedTestAssetPath(asset),
        ).bytes()

        expect(detectPadsFormat(sourceBytes)).toBe(asset.format)
        const document = parsePads(sourceBytes)
        expect(document.kind).toBe(asset.format)

        if (document.kind === "binary") {
          expect(document.getBytes()).toEqual(sourceBytes)
        } else {
          expect(document.getString()).toBe(
            new TextDecoder().decode(sourceBytes),
          )
        }
      },
    )
  }
})
