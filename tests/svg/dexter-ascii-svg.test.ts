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

const asset = getSvgTestAsset("kicad-dexter-motor-control-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the Dexter ASCII reference board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const vias = geometry.circles.filter((circle) => circle.kind === "via")
    const svg = await renderDownloadedPadsAsset(asset)
    expect(vias).toHaveLength(796)
    expect(vias.every((via) => via.drillRadius !== undefined)).toBe(true)
    expect(vias.every((via) => via.name === "STANDARDVIA")).toBe(true)
    expect(vias.every((via) => via.copperPads?.length === 8)).toBe(true)
    expect(vias.flatMap((via) => via.copperPads ?? [])).toHaveLength(6_368)
    expect(geometry.pads).toHaveLength(918)
    expect(geometry.holes).toHaveLength(95)
    expect(geometry.holes.filter((hole) => hole.plated)).toHaveLength(90)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-kind="component-pad"')
    expect(svg).toContain('data-kind="component-drill"')
    expect(svg).toContain('data-gerber-layer="F_Cu"')
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
          name: "j7-through-hole-bank",
          viewBox: {
            x: 4_000_000,
            y: 99_000_000,
            width: 10_500_000,
            height: 69_000_000,
          },
        },
        {
          name: "lower-fine-pitch",
          viewBox: {
            x: 14_000_000,
            y: 20_000_000,
            width: 55_000_000,
            height: 34_000_000,
          },
        },
      ],
    })
  },
)
