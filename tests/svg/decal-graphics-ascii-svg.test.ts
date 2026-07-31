import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  convertPadsCoordinateToNanometers,
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/decal-graphics.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)
const mils = (coordinate: number): number =>
  convertPadsCoordinateToNanometers(coordinate, "MILS")

test("renders transformed part-decal graphics on physical board layers", async () => {
  const geometry = extractPadsBoardGeometry(document)
  expect(geometry.layers).toEqual([
    {
      number: 1,
      name: "Top",
      type: "ROUTING",
      role: "copper",
      side: "top",
    },
    {
      number: 2,
      name: "Bottom",
      type: "ROUTING",
      role: "copper",
      side: "bottom",
    },
    {
      number: 21,
      name: "Solder Mask Top",
      type: "SOLDER_MASK",
      role: "solder-mask",
      side: "top",
    },
    {
      number: 23,
      name: "Paste Mask Top",
      type: "PASTE_MASK",
      role: "paste-mask",
      side: "top",
    },
    {
      number: 26,
      name: "Silkscreen Top",
      type: "SILK_SCREEN",
      role: "silkscreen",
      side: "top",
    },
    {
      number: 27,
      name: "Assembly Drawing Top",
      type: "ASSEMBLY",
      role: "assembly",
      side: "top",
    },
    {
      number: 29,
      name: "Silkscreen Bottom",
      type: "SILK_SCREEN",
      role: "silkscreen",
      side: "bottom",
    },
    {
      number: 30,
      name: "Assembly Drawing Bottom",
      type: "ASSEMBLY",
      role: "assembly",
      side: "bottom",
    },
  ])
  expect(geometry.paths).toHaveLength(11)
  expect(geometry.circles).toHaveLength(6)
  expect(geometry.pads).toHaveLength(2)
  expect(geometry.diagnostics).toEqual([])
  expect(
    geometry.paths.filter(
      (path) =>
        path.kind === "copper" &&
        ["F_Cu", "B_Cu"].includes(path.gerberLayer ?? ""),
    ),
  ).toHaveLength(2)
  expect(
    geometry.paths.filter(
      (path) =>
        path.kind === "copper" &&
        ["F_Paste", "B_Paste"].includes(path.gerberLayer ?? ""),
    ),
  ).toHaveLength(2)
  expect(
    geometry.circles.filter(
      (circle) =>
        circle.kind === "copper" &&
        ["F_Mask", "B_Mask"].includes(circle.gerberLayer ?? ""),
    ),
  ).toHaveLength(2)
  expect(geometry.paths.filter((path) => path.kind === "keepout")).toHaveLength(
    2,
  )
  expect(
    geometry.circles.filter((circle) => circle.kind === "keepout"),
  ).toHaveLength(2)
  expect(
    geometry.paths
      .filter((path) => path.sourcePieceKind === "COPCLS")
      .map((path) => path.pinNumber),
  ).toEqual(["1", "1", "1", "1"])
  expect(
    geometry.paths
      .filter((path) => path.sourcePieceKind === "KPTCLS")
      .map((path) => path.restrictions),
  ).toEqual(["RV", "RV"])

  const topArcPath = geometry.paths.find(
    (path) => path.reference === "U1" && path.gerberLayer === "F_Silkscreen",
  )
  expect(topArcPath).toMatchObject({
    layer: 26,
    reference: "U1",
    decalName: "GRAPHIC_DECAL",
    sourcePieceKind: "OPEN",
    groupId: "U1:GRAPHIC_DECAL:tag-1",
    segments: [
      {
        kind: "arc",
        start: { x: mils(110), y: mils(150) },
        end: { x: mils(190), y: mils(150) },
        center: { x: mils(150), y: mils(150) },
        radius: mils(40),
        startAngle: 180,
        deltaAngle: -180,
      },
    ],
  })
  const bottomArcPath = geometry.paths.find(
    (path) => path.reference === "U2" && path.gerberLayer === "B_Silkscreen",
  )
  expect(bottomArcPath).toMatchObject({
    layer: 26,
    reference: "U2",
    groupId: "U2:GRAPHIC_DECAL:tag-1",
    segments: [
      {
        kind: "arc",
        start: { x: mils(450), y: mils(190) },
        end: { x: mils(450), y: mils(110) },
        center: { x: mils(450), y: mils(150) },
        radius: mils(40),
        startAngle: 90,
        deltaAngle: 180,
      },
    ],
  })

  const views = [
    {
      name: "composite",
      layers: [
        "F_Cu",
        "B_Cu",
        "F_Silkscreen",
        "B_Silkscreen",
        "F_Fab",
        "B_Fab",
        "F_Mask",
        "B_Mask",
        "F_Paste",
        "B_Paste",
        "Keepout",
        "Edge_Cuts",
      ],
    },
    {
      name: "front-silkscreen",
      layers: ["F_Silkscreen", "Edge_Cuts"],
    },
    {
      name: "back-silkscreen",
      layers: ["B_Silkscreen", "Edge_Cuts"],
    },
    {
      name: "fabrication",
      layers: ["F_Fab", "B_Fab", "Edge_Cuts"],
    },
    {
      name: "front-copper-mask-paste",
      layers: ["F_Cu", "F_Mask", "F_Paste", "Edge_Cuts"],
    },
    {
      name: "back-copper-mask-paste",
      layers: ["B_Cu", "B_Mask", "B_Paste", "Edge_Cuts"],
    },
    {
      name: "keepout",
      layers: ["Keepout", "Edge_Cuts"],
    },
  ]
  for (const view of views) {
    const svg = generateSvgFromPads(document, {
      width: 1000,
      viewBox: {
        x: mils(75),
        y: mils(70),
        width: mils(450),
        height: mils(160),
      },
      visibleGerberLayers: view.layers,
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    await expect(svg).toMatchSvgSnapshot(import.meta.path, view.name)
  }
})
