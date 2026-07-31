import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/decal-graphics.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)

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
  expect(geometry.paths).toHaveLength(5)
  expect(geometry.circles).toHaveLength(2)
  expect(geometry.pads).toHaveLength(2)
  expect(geometry.diagnostics).toEqual([])

  const topArcPath = geometry.paths.find(
    (path) => path.reference === "U1" && path.gerberLayer === "F_Silkscreen",
  )
  expect(topArcPath).toMatchObject({
    layer: 26,
    reference: "U1",
    decalName: "GRAPHIC_DECAL",
    segments: [
      {
        kind: "arc",
        start: { x: 110, y: 150 },
        end: { x: 190, y: 150 },
        center: { x: 150, y: 150 },
        radius: 40,
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
    segments: [
      {
        kind: "arc",
        start: { x: 450, y: 190 },
        end: { x: 450, y: 110 },
        center: { x: 450, y: 150 },
        radius: 40,
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
  ]
  for (const view of views) {
    const svg = generateSvgFromPads(document, {
      width: 1000,
      viewBox: { x: 75, y: 70, width: 450, height: 160 },
      visibleGerberLayers: view.layers,
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    await expect(svg).toMatchSvgSnapshot(import.meta.path, view.name)
  }
})
