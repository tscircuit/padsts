import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-ems4-rev2-binary-v2025")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)("renders the EMS4 v2025 binary board", async () => {
  const svg = await renderDownloadedPadsAsset(asset)
  expectGerberStyleSvg(svg)
  expect(svg).toContain('data-kind="placement"')
  expect(svg).toContain('data-gerber-layer="F_Cu"')
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
