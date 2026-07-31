import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-synthetic-multilayer-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the synthetic multilayer ASCII board",
  async () => {
    const svg = await renderDownloadedPadsAsset(asset)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-gerber-layer="Edge_Cuts"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
  },
)
