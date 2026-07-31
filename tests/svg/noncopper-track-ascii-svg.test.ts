import { expect, test } from "bun:test"
import { extractPadsBoardGeometry, parsePads } from "../../lib"
import { getDownloadedTestAssetPath } from "../../scripts/test-assets"
import {
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-synthetic-noncopper-track-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "omits route records outside the copper stack",
  async () => {
    const sourceBytes = await Bun.file(
      getDownloadedTestAssetPath(asset),
    ).bytes()
    const geometry = extractPadsBoardGeometry(parsePads(sourceBytes))
    const routePaths = geometry.paths.filter((path) => path.kind === "route")
    const svg = await renderDownloadedPadsAsset(asset)

    expect(routePaths).toHaveLength(3)
    expect(routePaths.every((path) => path.layer === 1)).toBe(true)
    expect(geometry.diagnostics).toContain(
      "2 ASCII route segments on non-copper layers omitted from fabrication geometry",
    )
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-gerber-layer="F_Cu"')
    expect(svg).not.toContain('data-gerber-layer="B_Cu"')
    expect(svg).not.toContain('data-pads-layer="26"')
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
  },
)
