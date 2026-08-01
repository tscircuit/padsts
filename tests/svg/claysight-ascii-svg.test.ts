import { expect, test } from "bun:test"
import {
  expectBoardZoomSnapshotViews,
  expectGerberStyleSvg,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-claysight-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the ClaySight board and its circular cutouts",
  async () => {
    const svg = await renderDownloadedPadsAsset(asset, {
      showPlacements: false,
      showText: false,
    })

    expectGerberStyleSvg(svg)
    expect(svg.match(/data-kind="outline"/gu)).toHaveLength(9)
    expect(svg).toContain('fill-rule="evenodd" clip-rule="evenodd"')
    expect(svg).toContain('data-source-piece-kind="BRDCIR"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)

    await expectBoardZoomSnapshotViews({
      asset,
      testFilePath: import.meta.path,
      views: [
        {
          name: "upper-mounting-cutouts",
          viewBox: {
            x: 120_000_000,
            y: 174_000_000,
            width: 38_000_000,
            height: 40_000_000,
          },
          visibleGerberLayers: ["F_Cu", "B_Cu", "Drill", "Edge_Cuts"],
        },
      ],
    })
  },
)
