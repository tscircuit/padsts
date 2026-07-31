import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-dexter-motor-control-binary-v2021")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the Dexter v2021 binary structure",
  async () => {
    const svg = await renderDownloadedPadsAsset(asset)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-gerber-layer="F_Silkscreen"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
  },
)
