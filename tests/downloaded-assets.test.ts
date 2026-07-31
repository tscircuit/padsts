import { describe, expect, test } from "bun:test"
import { detectPadsFormat, parsePads } from "../lib"
import {
  calculateGitBlobSha,
  downloadableTestAssets,
  getDownloadedTestAssetPath,
  manualTestAssets,
} from "../scripts/test-assets"

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
