import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/placed-decals.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)

test("renders transformed top and bottom part-decal pads", async () => {
  const geometry = extractPadsBoardGeometry(document)
  expect(geometry.pads).toHaveLength(8)
  expect(geometry.pads.filter((pad) => pad.layer === 1)).toHaveLength(4)
  expect(geometry.pads.filter((pad) => pad.layer === 2)).toHaveLength(4)
  expect(geometry.pads.map((pad) => pad.shape).sort()).toEqual([
    "circle",
    "circle",
    "oval",
    "oval",
    "rect",
    "rect",
    "square",
    "square",
  ])
  expect(
    geometry.pads
      .filter(({ netName }) => netName)
      .map(
        ({ reference, pinNumber, netName }) =>
          `${reference}.${pinNumber}:${netName}`,
      )
      .sort(),
  ).toEqual(["U1.1:GND", "U1.2:DATA", "U2.1:GND", "U2.2:DATA"])
  expect(geometry.diagnostics).toEqual([])

  const views = [
    { name: "composite", layers: undefined },
    { name: "f_cu", layers: ["F_Cu", "Edge_Cuts"] },
    { name: "b_cu", layers: ["B_Cu", "Edge_Cuts"] },
  ]
  for (const view of views) {
    const svg = generateSvgFromPads(document, {
      visibleGerberLayers: view.layers,
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    await expect(svg).toMatchSvgSnapshot(import.meta.path, view.name)
  }
})
