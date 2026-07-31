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

const asset = getSvgTestAsset("kicad-ems4-rev2-ascii")
const isAvailable = await isSvgTestAssetAvailable(asset)

test.skipIf(!isAvailable)(
  "renders the EMS4 ASCII reference board",
  async () => {
    const geometry = await extractDownloadedPadsAssetGeometry(asset)
    const vias = geometry.circles.filter((circle) => circle.kind === "via")
    const decalPaths = geometry.paths.filter((path) => path.reference)
    const decalCircles = geometry.circles.filter((circle) => circle.reference)
    const decalCopperPaths = decalPaths.filter(
      (path) => path.sourcePieceKind === "COPCLS",
    )
    const decalKeepoutPaths = decalPaths.filter(
      (path) => path.sourcePieceKind === "KPTCLS",
    )
    const svg = await renderDownloadedPadsAsset(asset)
    expect(vias).toHaveLength(1074)
    expect(vias.every((via) => via.drillRadius !== undefined)).toBe(true)
    expect(vias.filter((via) => via.shape === "square")).toHaveLength(455)
    const viaPads = vias.flatMap((via) => via.copperPads ?? [])
    expect(viaPads).toHaveLength(6_444)
    expect(viaPads.filter((pad) => pad.shape === "square")).toHaveLength(2_730)
    expect(geometry.pads).toHaveLength(1_279)
    expect(geometry.holes).toHaveLength(44)
    expect(geometry.holes.filter((hole) => !hole.plated)).toHaveLength(40)
    expect(decalPaths).toHaveLength(428)
    expect(decalCircles).toHaveLength(2)
    expect(decalCopperPaths).toHaveLength(4)
    expect(
      decalCopperPaths.filter((path) => path.gerberLayer === "F_Cu"),
    ).toHaveLength(2)
    expect(
      decalCopperPaths.filter((path) => path.gerberLayer === "B_Cu"),
    ).toHaveLength(2)
    expect(decalCopperPaths.map((path) => path.pinNumber).sort()).toEqual([
      "1",
      "1",
      "2",
      "2",
    ])
    expect(decalKeepoutPaths).toHaveLength(15)
    expect(
      decalKeepoutPaths.every(
        (path) => path.gerberLayer === "Keepout" && path.restrictions === "R",
      ),
    ).toBe(true)
    const l5Pin1Copper = decalCopperPaths.find(
      (path) => path.reference === "L5" && path.pinNumber === "1",
    )
    const l6Pin1Copper = decalCopperPaths.find(
      (path) => path.reference === "L6" && path.pinNumber === "1",
    )
    expect(l5Pin1Copper).toMatchObject({
      gerberLayer: "F_Cu",
      polarity: "positive",
    })
    expect(l5Pin1Copper?.points[0]).toEqual({
      x: 7_836_000,
      y: 14_650_500,
    })
    expect(
      l5Pin1Copper?.segments?.find((segment) => segment.kind === "arc"),
    ).toMatchObject({
      center: { x: 11_811_000, y: 13_525_500 },
      radius: 2_784_107,
      deltaAngle: 125.5,
    })
    expect(l6Pin1Copper).toMatchObject({
      gerberLayer: "B_Cu",
      polarity: "positive",
    })
    expect(l6Pin1Copper?.points[0]).toEqual({
      x: 10_312_500,
      y: 7_638_000,
    })
    expect(
      l6Pin1Copper?.segments?.find((segment) => segment.kind === "arc"),
    ).toMatchObject({
      center: { x: 14_287_500, y: 8_763_000 },
      radius: 2_784_107,
      deltaAngle: -125.5,
    })
    expect(geometry.diagnostics).toEqual([
      "530 unrouted ASCII connections omitted from fabrication geometry",
    ])
    expect(
      geometry.layers.find((layer) => layer.name === "Silkscreen Top"),
    ).toMatchObject({ role: "silkscreen", side: "top" })
    expectGerberStyleSvg(svg)
    expect(svg).toContain('data-kind="outline"')
    expect(svg).toContain('data-kind="placement"')
    expect(svg).toContain('data-kind="component-pad"')
    expect(svg).toContain('data-kind="component-drill"')
    expect(svg).toContain('data-gerber-layer="F_Cu"')
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
          name: "u1-u3-fine-pitch",
          viewBox: {
            x: -32_000_000,
            y: -12_000_000,
            width: 26_000_000,
            height: 27_000_000,
          },
        },
        {
          name: "u10-u11-fine-pitch",
          viewBox: {
            x: 18_000_000,
            y: -2_000_000,
            width: 12_000_000,
            height: 15_000_000,
          },
        },
        {
          name: "upper-left-mount",
          viewBox: {
            x: -44_000_000,
            y: 22_000_000,
            width: 10_000_000,
            height: 11_000_000,
          },
        },
        {
          name: "u1-u3-component-graphics",
          viewBox: {
            x: -32_000_000,
            y: -12_000_000,
            width: 26_000_000,
            height: 27_000_000,
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
          name: "l5-front-custom-copper",
          viewBox: {
            x: 6_000_000,
            y: 9_000_000,
            width: 11_000_000,
            height: 10_000_000,
          },
          visibleGerberLayers: ["F_Cu"],
        },
        {
          name: "l6-back-custom-copper",
          viewBox: {
            x: 9_000_000,
            y: 3_000_000,
            width: 11_000_000,
            height: 11_000_000,
          },
          visibleGerberLayers: ["B_Cu"],
        },
        {
          name: "c61-component-keepout",
          viewBox: {
            x: 17_000_000,
            y: -500_000,
            width: 3_000_000,
            height: 2_000_000,
          },
          visibleGerberLayers: ["Keepout"],
        },
      ],
    })
  },
)
