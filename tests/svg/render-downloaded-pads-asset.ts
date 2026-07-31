import { expect } from "bun:test"
import {
  convertPadsCoordinateToNanometers,
  extractPadsBoardGeometry,
  type GeneratePadsSvgOptions,
  generateSvgFromPads,
  type PadsBoardGeometry,
  type PadsSvgBoardViewBox,
  parsePads,
} from "../../lib"
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
  options: GeneratePadsSvgOptions = {},
): Promise<string> => {
  const sourceBytes = await Bun.file(getDownloadedTestAssetPath(asset)).bytes()
  return generateSvgFromPads(sourceBytes, options)
}

export const extractDownloadedPadsAssetGeometry = async (
  asset: SvgTestAsset,
): Promise<PadsBoardGeometry> => {
  const sourceBytes = await Bun.file(getDownloadedTestAssetPath(asset)).bytes()
  return extractPadsBoardGeometry(parsePads(sourceBytes))
}

const COPPER_VIEW_LAYERS = [
  "F_Cu",
  "In1_Cu",
  "In2_Cu",
  "In3_Cu",
  "In4_Cu",
  "In5_Cu",
  "In6_Cu",
  "In7_Cu",
  "In8_Cu",
  "B_Cu",
  "Drill",
  "Edge_Cuts",
]

const visualSnapshotViews: {
  name: string
  options: GeneratePadsSvgOptions
}[] = [
  {
    name: "copper",
    options: {
      visibleGerberLayers: COPPER_VIEW_LAYERS,
      showPlacements: false,
      showText: false,
    },
  },
  {
    name: "drill",
    options: {
      visibleGerberLayers: ["Drill", "Edge_Cuts"],
      showPlacements: false,
      showText: false,
    },
  },
  {
    name: "structure",
    options: {
      visibleGerberLayers: [
        "Dwgs_User",
        "Keepout",
        "Edge_Cuts",
        "Debug_Vertices",
        "Debug_Connections",
      ],
      showPlacements: false,
      showText: false,
      showUnassignedVertices: true,
      showUnverifiedConnections: true,
    },
  },
  {
    name: "assembly",
    options: {
      visibleGerberLayers: [
        "F_Silkscreen",
        "B_Silkscreen",
        "F_Fab",
        "B_Fab",
        "Edge_Cuts",
      ],
    },
  },
]

export const expectVisualSnapshotViews = async ({
  asset,
  testFilePath,
}: {
  asset: SvgTestAsset
  testFilePath: string
}): Promise<void> => {
  for (const view of visualSnapshotViews) {
    const svg = await renderDownloadedPadsAsset(asset, view.options)
    expectGerberStyleSvg(svg, {
      allowBinarySectionSummary: view.options.showBinarySectionSummary === true,
    })
    await expect(svg).toMatchSvgSnapshot(testFilePath, view.name)
  }
}

export interface BoardZoomSnapshotView {
  name: string
  /** Zoom window in the downloaded file's declared source units. */
  viewBox: PadsSvgBoardViewBox
  visibleGerberLayers?: string[]
  clipArtworkToBoardOutline?: boolean
}

export const expectBoardZoomSnapshotViews = async ({
  asset,
  testFilePath,
  views,
}: {
  asset: SvgTestAsset
  testFilePath: string
  views: BoardZoomSnapshotView[]
}): Promise<void> => {
  const sourceBytes = await Bun.file(getDownloadedTestAssetPath(asset)).bytes()
  const document = parsePads(sourceBytes)
  const sourceUnits = document.kind === "ascii" ? document.units : "BASIC"
  if (sourceUnits === "unknown") {
    throw new RangeError(`Cannot normalize zoom units for ${asset.id}`)
  }
  const normalizeCoordinate = (coordinate: number): number =>
    convertPadsCoordinateToNanometers(coordinate, sourceUnits)

  for (const view of views) {
    const svg = await renderDownloadedPadsAsset(asset, {
      width: 1000,
      viewBox: {
        x: normalizeCoordinate(view.viewBox.x),
        y: normalizeCoordinate(view.viewBox.y),
        width: normalizeCoordinate(view.viewBox.width),
        height: normalizeCoordinate(view.viewBox.height),
      },
      visibleGerberLayers: view.visibleGerberLayers ?? COPPER_VIEW_LAYERS,
      clipArtworkToBoardOutline: view.clipArtworkToBoardOutline,
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    expect(svg).toContain("&quot;boardViewBox&quot;")
    await expect(svg).toMatchSvgSnapshot(testFilePath, `zoom-${view.name}`)
  }
}

export const expectGerberStyleSvg = (
  svg: string,
  {
    allowBinarySectionSummary = false,
  }: { allowBinarySectionSummary?: boolean } = {},
): void => {
  expect(svg).toContain('stroke-linecap="round"')
  expect(svg).toContain('fill-rule="evenodd"')
  expect(svg).toContain('transform="scale(1,-1)"')
  expect(svg).toContain('data-kind="negative-space"')
  if (!allowBinarySectionSummary) {
    expect(svg).not.toContain("BINARY SECTIONS")
  }
}
