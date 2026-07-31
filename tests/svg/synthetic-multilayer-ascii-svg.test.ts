import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  extractDownloadedPadsAssetGeometry,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-synthetic-multilayer-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the synthetic multilayer ASCII board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const svg = await renderDownloadedPadsAsset(asset)
    expect(geometry.circles.filter((circle) => circle.kind === "via")).toEqual(
      [],
    )
    expect(geometry.unverifiedViaLocations).toHaveLength(3)
    expect(geometry.diagnostics).toContain(
      "3 ASCII via instances reference missing pad-stack definitions (VIA1X2, VIA4X5, VIA_THRU)",
    )
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-gerber-layer="Edge_Cuts"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
  },
)
