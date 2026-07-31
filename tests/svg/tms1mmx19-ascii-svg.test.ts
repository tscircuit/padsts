import { expect, test } from "bun:test"
import {
  expectBoardZoomSnapshotViews,
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  extractDownloadedPadsAssetGeometry,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-tms1mmx19-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the unrouted TMS ASCII reference board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const svg = await renderDownloadedPadsAsset(asset)
    expect(geometry.pads).toHaveLength(1_760)
    expect(geometry.holes).toHaveLength(66)
    expect(
      geometry.holes.filter((hole) => hole.width !== hole.height),
    ).toHaveLength(3)
    expect(geometry.holes.filter((hole) => hole.plated)).toHaveLength(58)
    expect(geometry.holes.filter((hole) => !hole.plated)).toHaveLength(8)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-kind="component-pad"')
    expect(svg).toContain('data-kind="component-drill"')
    expect(svg).not.toContain('data-kind="route"')
    expect(svg).toContain(
      "1202 unrouted ASCII connections omitted from fabrication geometry",
    )
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
    await expectBoardZoomSnapshotViews({
      asset,
      testFilePath: import.meta.path,
      views: [
        {
          name: "jm-horizontal-fine-pitch",
          viewBox: {
            x: 90_000_000,
            y: 103_000_000,
            width: 51_000_000,
            height: 13_000_000,
          },
        },
        {
          name: "jm-vertical-fine-pitch",
          viewBox: {
            x: 141_000_000,
            y: 115_000_000,
            width: 12_000_000,
            height: 36_000_000,
          },
        },
      ],
    })
  },
)
