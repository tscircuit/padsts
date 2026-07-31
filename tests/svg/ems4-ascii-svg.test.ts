import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  extractDownloadedPadsAssetGeometry,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-ems4-rev2-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the EMS4 ASCII reference board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const vias = geometry.circles.filter((circle) => circle.kind === "via")
    const svg = await renderDownloadedPadsAsset(asset)
    expect(vias).toHaveLength(1074)
    expect(vias.every((via) => via.drillRadius !== undefined)).toBe(true)
    expect(vias.filter((via) => via.shape === "square")).toHaveLength(455)
    const viaPads = vias.flatMap((via) => via.copperPads ?? [])
    expect(viaPads).toHaveLength(6_444)
    expect(viaPads.filter((pad) => pad.shape === "square")).toHaveLength(2_730)
    expect(geometry.pads).toHaveLength(1_235)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-kind="component-pad"')
    expect(svg).toContain('data-gerber-layer="F_Cu"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
  },
)
