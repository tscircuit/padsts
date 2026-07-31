import { expect, test } from "bun:test"
import {
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
  const svg = await renderDownloadedPadsAsset(asset)
  expect(vias).toHaveLength(24)
  expect(vias.every((via) => via.radius === 300_000)).toBe(true)
  expect(vias.every((via) => via.drillRadius === 150_000)).toBe(true)
  expect(vias.every((via) => via.copperPads?.length === 2)).toBe(true)
  expect(vias.flatMap((via) => via.copperPads ?? [])).toHaveLength(48)
  expectGerberStyleSvg(svg)
  expect(svg).toContain('data-kind="outline"')
  expect(svg).toContain('data-kind="placement"')
  expect(svg).toContain('data-gerber-layer="F_Cu"')
  expect(svg).toContain(" A ")
  expect(svg).not.toContain("rendered as straight segments")
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
  await expectVisualSnapshotViews({
    asset,
    testFilePath: import.meta.path,
  })
})
