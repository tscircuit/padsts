import { expect, test } from "bun:test"
import {
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixtureUrl = new URL("../fixtures/thermal-vias.asc", import.meta.url)
const document = parsePads(await Bun.file(fixtureUrl).bytes())

test("renders round and square thermal clearances, spokes, and antipads", async () => {
  const geometry = extractPadsBoardGeometry(document)

  expect(geometry.thermalReliefs).toMatchObject([
    {
      center: { x: 5_080_000, y: 5_080_000 },
      layer: 3,
      shape: "circle",
      rotation: 0,
      innerDiameter: 2_032_000,
      outerDiameter: 3_556_000,
      spokeWidth: 406_400,
      spokeCount: 4,
      viaName: "ROUND_THERMAL",
      netName: "GND",
    },
    {
      center: { x: 10_160_000, y: 5_080_000 },
      layer: 3,
      shape: "square",
      rotation: 45,
      innerDiameter: 2_235_200,
      outerDiameter: 3_810_000,
      spokeWidth: 355_600,
      spokeCount: 4,
      viaName: "SQUARE_THERMAL",
      netName: "GND",
    },
  ])
  expect(geometry.antipads).toMatchObject([
    {
      center: { x: 5_080_000, y: 5_080_000 },
      layer: 2,
      shape: "circle",
      diameter: 2_794_000,
      viaName: "ROUND_THERMAL",
      netName: "GND",
    },
    {
      center: { x: 10_160_000, y: 5_080_000 },
      layer: 2,
      shape: "square",
      diameter: 2_921_000,
      viaName: "SQUARE_THERMAL",
      netName: "GND",
    },
  ])

  const composite = generateSvgFromPads(document, {
    width: 900,
    showPlacements: false,
    showText: false,
  })
  expectGerberStyleSvg(composite)
  expect(composite.match(/data-kind="thermal-relief"/gu)).toHaveLength(2)
  expect(composite.match(/data-kind="thermal-clearance"/gu)).toHaveLength(2)
  expect(composite.match(/data-kind="antipad"/gu)).toHaveLength(2)
  await expect(composite).toMatchSvgSnapshot(import.meta.path, "composite")

  const views = [
    {
      name: "inner-1-antipads",
      layers: ["In1_Cu", "Edge_Cuts"],
      expectedKind: 'data-kind="antipad"',
      absentKind: 'data-kind="thermal-relief"',
    },
    {
      name: "inner-2-thermal-reliefs",
      layers: ["In2_Cu", "Edge_Cuts"],
      expectedKind: 'data-kind="thermal-relief"',
      absentKind: 'data-kind="antipad"',
    },
  ] as const

  for (const view of views) {
    const svg = generateSvgFromPads(document, {
      width: 900,
      viewBox: { x: 120, y: 110, width: 360, height: 180 },
      viewBoxUnits: "source",
      visibleGerberLayers: [...view.layers],
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    expect(svg).toContain(view.expectedKind)
    expect(svg).not.toContain(view.absentKind)
    await expect(svg).toMatchSvgSnapshot(import.meta.path, view.name)
  }
})
