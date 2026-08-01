import { expect, test } from "bun:test"
import {
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixtureUrl = new URL("../fixtures/decal-text.asc", import.meta.url)
const document = parsePads(await Bun.file(fixtureUrl).bytes())

test("renders transformed static part-decal text on both board sides", async () => {
  const geometry = extractPadsBoardGeometry(document)
  expect(geometry.texts).toHaveLength(4)
  expect(
    geometry.texts.map((text) => ({
      content: text.content,
      reference: text.reference,
      gerberLayer: text.gerberLayer,
      mirrored: text.mirrored,
      rotation: text.rotation,
    })),
  ).toEqual([
    {
      content: "PIN 1",
      reference: "U1",
      gerberLayer: "F_Silkscreen",
      mirrored: false,
      rotation: 20,
    },
    {
      content: "POL +",
      reference: "U1",
      gerberLayer: "F_Silkscreen",
      mirrored: true,
      rotation: 110,
    },
    {
      content: "PIN 1",
      reference: "U2",
      gerberLayer: "B_Silkscreen",
      mirrored: true,
      rotation: 160,
    },
    {
      content: "POL +",
      reference: "U2",
      gerberLayer: "B_Silkscreen",
      mirrored: false,
      rotation: 70,
    },
  ])
  expect(geometry.diagnostics).toEqual([])

  const composite = generateSvgFromPads(document, {
    width: 900,
    showPlacements: false,
  })
  expectGerberStyleSvg(composite)
  expect(composite.match(/data-reference="U[12]"/gu)).toHaveLength(4)
  await expect(composite).toMatchSvgSnapshot(import.meta.path, "composite")

  for (const view of [
    {
      name: "top-text-zoom",
      viewBox: { x: 70, y: 90, width: 140, height: 120 },
      layers: ["F_Silkscreen", "Edge_Cuts"],
      expectedReference: "U1",
      absentReference: "U2",
    },
    {
      name: "bottom-text-zoom",
      viewBox: { x: 290, y: 90, width: 140, height: 120 },
      layers: ["B_Silkscreen", "Edge_Cuts"],
      expectedReference: "U2",
      absentReference: "U1",
    },
  ] as const) {
    const svg = generateSvgFromPads(document, {
      width: 900,
      viewBox: view.viewBox,
      viewBoxUnits: "source",
      visibleGerberLayers: [...view.layers],
      showPlacements: false,
    })
    expectGerberStyleSvg(svg)
    expect(svg).toContain(`data-reference="${view.expectedReference}"`)
    expect(svg).not.toContain(`data-reference="${view.absentReference}"`)
    await expect(svg).toMatchSvgSnapshot(import.meta.path, view.name)
  }
})
