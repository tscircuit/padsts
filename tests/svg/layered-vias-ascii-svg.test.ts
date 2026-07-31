import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/layered-vias.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)

test("renders distinct top, inner, bottom, and specific-layer via pads", async () => {
  const geometry = extractPadsBoardGeometry(document)
  const vias = geometry.circles.filter((circle) => circle.kind === "via")

  expect(vias).toHaveLength(3)
  expect(vias[0]?.copperPads).toEqual([
    { layer: 1, radius: 25, shape: "circle" },
    { layer: 2, radius: 40, shape: "circle" },
    { layer: 3, radius: 40, shape: "circle" },
    { layer: 4, radius: 30, shape: "square" },
  ])
  expect(vias[1]?.copperPads).toEqual([
    { layer: 2, radius: 17.5, shape: "square" },
    { layer: 3, radius: 12.5, shape: "circle" },
  ])
  expect(vias[2]?.copperPads).toEqual([
    { layer: 1, radius: 22.5, shape: "circle" },
    { layer: 2, radius: 37.5, shape: "square" },
    { layer: 3, radius: 27.5, shape: "circle" },
    { layer: 4, radius: 22.5, shape: "circle" },
  ])
  expect(geometry.diagnostics).toEqual([])

  const compositeSvg = generateSvgFromPads(document)
  expectGerberStyleSvg(compositeSvg)
  await expect(compositeSvg).toMatchSvgSnapshot(import.meta.path, "composite")

  for (const layerName of ["F_Cu", "In1_Cu", "In2_Cu", "B_Cu"]) {
    const svg = generateSvgFromPads(document, {
      visibleGerberLayers: [layerName, "Drill", "Edge_Cuts"],
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    expect(svg).toContain(`data-gerber-layer="${layerName}"`)
    await expect(svg).toMatchSvgSnapshot(
      import.meta.path,
      layerName.toLowerCase(),
    )
  }
})
