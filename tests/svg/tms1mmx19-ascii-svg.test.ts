import { expect, test } from "bun:test"
import {
  expectBoardZoomSnapshotViews,
  expectGerberStyleSvg,
  expectVisualSnapshotViews,
  extractDownloadedPadsAssetGeometry,
  getSvgTestAsset,
  isSvgTestAssetAvailable,
  renderDownloadedPadsAsset,
} from "./render-downloaded-pads-asset"

const asset = getSvgTestAsset("kicad-tms1mmx19-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the unrouted TMS ASCII reference board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const decalPaths = geometry.paths.filter((path) => path.reference)
    const decalCircles = geometry.circles.filter((circle) => circle.reference)
    const decalCopperPaths = decalPaths.filter(
      (path) => path.sourcePieceKind === "COPCLS",
    )
    const svg = await renderDownloadedPadsAsset(asset)
    expect(geometry.pads).toHaveLength(1_760)
    expect(geometry.holes).toHaveLength(66)
    expect(
      geometry.holes.filter((hole) => hole.width !== hole.height),
    ).toHaveLength(3)
    expect(geometry.holes.filter((hole) => hole.plated)).toHaveLength(58)
    expect(geometry.holes.filter((hole) => !hole.plated)).toHaveLength(8)
    expect(decalPaths).toHaveLength(1_425)
    expect(decalCircles).toHaveLength(101)
    expect(decalCopperPaths).toHaveLength(315)
    expect(
      decalCopperPaths.filter((path) => path.gerberLayer === "F_Cu"),
    ).toHaveLength(105)
    expect(
      decalCopperPaths.filter((path) => path.gerberLayer === "F_Mask"),
    ).toHaveLength(105)
    expect(
      decalCopperPaths.filter((path) => path.gerberLayer === "F_Paste"),
    ).toHaveLength(105)
    const u18Pin1Copper = decalCopperPaths.find(
      (path) =>
        path.reference === "U18" &&
        path.pinNumber === "1" &&
        path.gerberLayer === "F_Cu",
    )
    expect(u18Pin1Copper).toMatchObject({
      polarity: "positive",
    })
    expect(u18Pin1Copper?.points[0]).toEqual({
      x: 384_067_500,
      y: 114_685_500,
    })
    expect(
      u18Pin1Copper?.segments?.find((segment) => segment.kind === "arc"),
    ).toMatchObject({
      center: { x: 385_192_500, y: 114_460_500 },
      radius: 225_000,
      deltaAngle: -180,
    })
    expect(geometry.diagnostics).toEqual([
      "1202 unrouted ASCII connections omitted from fabrication geometry",
    ])
    expect(
      geometry.layers.find((layer) => layer.name === "Assembly Drawing Top"),
    ).toMatchObject({ role: "assembly", side: "top" })
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-kind="component-pad"')
    expect(svg).toContain('data-kind="component-drill"')
    expect(svg).not.toContain('data-kind="route"')
    expect(svg).toContain(
      "1202 unrouted ASCII connections omitted from fabrication geometry",
    )
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
    await expectVisualSnapshotViews({
      asset,
      testFilePath: import.meta.path,
    })
    await expectBoardZoomSnapshotViews({
      asset,
      testFilePath: import.meta.path,
      views: [
        {
          name: "jm-horizontal-fine-pitch",
          viewBox: {
            x: 90_000_000,
            y: 103_000_000,
            width: 51_000_000,
            height: 13_000_000,
          },
        },
        {
          name: "jm-vertical-fine-pitch",
          viewBox: {
            x: 141_000_000,
            y: 115_000_000,
            width: 12_000_000,
            height: 36_000_000,
          },
        },
        {
          name: "jm-horizontal-component-graphics",
          viewBox: {
            x: 90_000_000,
            y: 103_000_000,
            width: 51_000_000,
            height: 13_000_000,
          },
          visibleGerberLayers: [
            "F_Silkscreen",
            "B_Silkscreen",
            "F_Fab",
            "B_Fab",
            "Edge_Cuts",
          ],
        },
        {
          name: "u18-custom-copper",
          viewBox: {
            x: 382_000_000,
            y: 107_000_000,
            width: 11_000_000,
            height: 11_000_000,
          },
          visibleGerberLayers: ["F_Cu"],
          clipArtworkToBoardOutline: false,
        },
        {
          name: "u18-custom-mask-paste",
          viewBox: {
            x: 382_000_000,
            y: 107_000_000,
            width: 11_000_000,
            height: 11_000_000,
          },
          visibleGerberLayers: ["F_Mask", "F_Paste"],
          clipArtworkToBoardOutline: false,
        },
      ],
    })
  },
)
