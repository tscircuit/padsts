import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("rk3326-lpddr3-target")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)("renders the RK3326 target board", async () => {
  const svg = await renderDownloadedPadsAsset(asset)
  expectGerberStyleSvg(svg)
  expect(svg).toStartWith("<svg")
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
  await expectVisualSnapshotViews({
    asset,
    testFilePath: import.meta.path,
  })
})
