import { expect, test } from "bun:test"
import {
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
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-gerber-layer="F_Cu"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
  },
)
