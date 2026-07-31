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

const asset = getSvgTestAsset("kicad-lcore2-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)("renders the LCORE 2 ASCII board", async () => {
  const geometry = await extractDownloadedPadsAssetGeometry(asset)
  const vias = geometry.circles.filter((circle) => circle.kind === "via")
  const decalPaths = geometry.paths.filter((path) => path.reference)
  const decalCircles = geometry.circles.filter((circle) => circle.reference)
  const svg = await renderDownloadedPadsAsset(asset)
  expect(vias).toHaveLength(24)
  expect(vias.every((via) => via.radius === 300_000)).toBe(true)
  expect(vias.every((via) => via.drillRadius === 150_000)).toBe(true)
  expect(vias.every((via) => via.copperPads?.length === 2)).toBe(true)
  expect(vias.flatMap((via) => via.copperPads ?? [])).toHaveLength(48)
  expect(geometry.pads).toHaveLength(69)
  expect(geometry.holes).toHaveLength(4)
  expect(geometry.holes.every((hole) => !hole.plated)).toBe(true)
  expect(decalPaths).toHaveLength(45)
  expect(decalCircles).toHaveLength(5)
  expect(
    geometry.layers.find((layer) => layer.name === "Silkscreen Top"),
  ).toMatchObject({ role: "silkscreen", side: "top" })
  expectGerberStyleSvg(svg)
  expect(svg).toContain('data-kind="outline"')
  expect(svg).toContain('data-kind="placement"')
  expect(svg).toContain('data-kind="component-pad"')
  expect(svg).toContain('data-kind="component-drill"')
  expect(svg).toContain('data-gerber-layer="F_Cu"')
  expect(svg).toContain(" A ")
  expect(svg).not.toContain("rendered as straight segments")
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
        name: "dense-components",
        viewBox: {
          x: -10_500_000,
          y: -22_500_000,
          width: 18_000_000,
          height: 12_000_000,
        },
      },
      {
        name: "mechanical-holes",
        viewBox: {
          x: 5_500_000,
          y: -31_500_000,
          width: 9_000_000,
          height: 8_000_000,
        },
      },
      {
        name: "dense-component-graphics",
        viewBox: {
          x: -10_500_000,
          y: -22_500_000,
          width: 18_000_000,
          height: 12_000_000,
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
})
