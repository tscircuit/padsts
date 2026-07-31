import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-tms1mmx19-binary-v2027")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)("renders the TMS v2027 binary board", async () => {
  const svg = await renderDownloadedPadsAsset(asset)
  expectGerberStyleSvg(svg)
  expect(svg).toContain('data-kind="placement"')
  expect(svg).not.toContain('data-gerber-layer="F_Cu"')
  expect(svg).not.toContain('data-kind="unverified-connection"')
  expect(svg).toContain(
    "native binary route and via candidates are withheld from fabrication layers",
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
  await expectVisualSnapshotViews({
    asset,
    testFilePath: import.meta.path,
  })
})
