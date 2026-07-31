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

const asset = getSvgTestAsset("kicad-ems4-rev2-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the EMS4 ASCII reference board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const vias = geometry.circles.filter((circle) => circle.kind === "via")
    const decalPaths = geometry.paths.filter((path) => path.reference)
    const decalCircles = geometry.circles.filter((circle) => circle.reference)
    const svg = await renderDownloadedPadsAsset(asset)
    expect(vias).toHaveLength(1074)
    expect(vias.every((via) => via.drillRadius !== undefined)).toBe(true)
    expect(vias.filter((via) => via.shape === "square")).toHaveLength(455)
    const viaPads = vias.flatMap((via) => via.copperPads ?? [])
    expect(viaPads).toHaveLength(6_444)
    expect(viaPads.filter((pad) => pad.shape === "square")).toHaveLength(2_730)
    expect(geometry.pads).toHaveLength(1_279)
    expect(geometry.holes).toHaveLength(44)
    expect(geometry.holes.filter((hole) => !hole.plated)).toHaveLength(40)
    expect(decalPaths).toHaveLength(409)
    expect(decalCircles).toHaveLength(2)
    expect(
      geometry.layers.find((layer) => layer.name === "Silkscreen Top"),
    ).toMatchObject({ role: "silkscreen", side: "top" })
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
          name: "u1-u3-fine-pitch",
          viewBox: {
            x: -32_000_000,
            y: -12_000_000,
            width: 26_000_000,
            height: 27_000_000,
          },
        },
        {
          name: "u10-u11-fine-pitch",
          viewBox: {
            x: 18_000_000,
            y: -2_000_000,
            width: 12_000_000,
            height: 15_000_000,
          },
        },
        {
          name: "upper-left-mount",
          viewBox: {
            x: -44_000_000,
            y: 22_000_000,
            width: 10_000_000,
            height: 11_000_000,
          },
        },
        {
          name: "u1-u3-component-graphics",
          viewBox: {
            x: -32_000_000,
            y: -12_000_000,
            width: 26_000_000,
            height: 27_000_000,
          },
          visibleGerberLayers: [
            "F_Silkscreen",
            "B_Silkscreen",
            "F_Fab",
            "B_Fab",
            "Edge_Cuts",
          ],
        },
      ],
    })
  },
)
