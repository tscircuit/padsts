import { expect, test } from "bun:test"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
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
    expect(svg).not.toContain('data-kind="board-text"')
    expect(svg).toContain(
      "1 binary text candidates rejected because decoded fields are implausible",
    )
    const intrinsicHeight = Number(/ height="([^"]+)"/u.exec(svg)?.[1])
    expect(intrinsicHeight).toBeLessThanOrEqual(2400)
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
  },
)
