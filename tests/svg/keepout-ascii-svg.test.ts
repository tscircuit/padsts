import { expect, test } from "bun:test"
import { extractPadsBoardGeometry, parsePads } from "../../lib"
import { getDownloadedTestAssetPath } from "../../scripts/test-assets"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-keepout-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders every focused ASCII keepout type",
  async () => {
    const sourceBytes = await Bun.file(
      getDownloadedTestAssetPath(asset),
    ).bytes()
    const geometry = extractPadsBoardGeometry(parsePads(sourceBytes))
    const keepoutPaths = geometry.paths.filter(
      (path) => path.kind === "keepout",
    )
    const svg = await renderDownloadedPadsAsset(asset)

    expect(keepoutPaths).toHaveLength(5)
    expect(keepoutPaths.map((path) => path.name)).toEqual([
      "KEEPOUT_RECT",
      "VIA_RESTRICT",
      "ROUTE_RESTRICT",
      "AREA_RESTRICT",
      "PLACEMENT_KO",
    ])
    expect(keepoutPaths.every((path) => path.closed)).toBe(true)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-gerber-layer="Keepout"')
    expect(svg).toContain('data-name="VIA_RESTRICT"')
    expect(svg).toContain('data-name="PLACEMENT_KO"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
  },
)
