import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-lcore2-binary-v2026")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the LCORE 2 v2026 binary board",
  async () => {
    const svg = await renderDownloadedPadsAsset(asset)
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-gerber-layer="Dwgs_User"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
  },
)
