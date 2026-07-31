import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-lcore2-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)("renders the LCORE 2 ASCII board", async () => {
  const svg = await renderDownloadedPadsAsset(asset)
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
