import { expect } from "bun:test"
import { generateSvgFromPads } from "../../lib"
import {
  downloadableTestAssets,
  getDownloadedTestAssetPath,
  manualTestAssets,
} from "../../scripts/test-assets"

export interface SvgTestAsset {
  id: string
  relativePath: string
}

export const getSvgTestAsset = (id: string): SvgTestAsset => {
  const asset = [...downloadableTestAssets, ...manualTestAssets].find(
    (candidateAsset) => candidateAsset.id === id,
  )
  if (!asset) throw new Error(`Unknown SVG test asset ${id}`)
  return asset
}

export const isSvgTestAssetAvailable = async (
  asset: SvgTestAsset,
): Promise<boolean> => Bun.file(getDownloadedTestAssetPath(asset)).exists()

export const renderDownloadedPadsAsset = async (
  asset: SvgTestAsset,
): Promise<string> => {
  const sourceBytes = await Bun.file(getDownloadedTestAssetPath(asset)).bytes()
  return generateSvgFromPads(sourceBytes)
}

export const expectGerberStyleSvg = (svg: string): void => {
  expect(svg).toContain('stroke-linecap="round"')
  expect(svg).toContain('fill-rule="evenodd"')
  expect(svg).toContain('transform="scale(1,-1)"')
  expect(svg).toContain('data-kind="negative-space"')
  expect(svg).not.toContain("BINARY SECTIONS")
}
