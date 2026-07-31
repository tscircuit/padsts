import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  extractPadsBoardGeometry,
  generateSvgFromPads,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/drilled-decals.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)

test("renders round and slotted plated and non-plated component drills", async () => {
  const geometry = extractPadsBoardGeometry(document)
  expect(geometry.pads).toHaveLength(8)
  expect(geometry.holes).toHaveLength(8)
  expect(geometry.holes.filter((hole) => hole.plated)).toHaveLength(4)
  expect(
    geometry.holes.filter((hole) => hole.width !== hole.height),
  ).toHaveLength(2)
  expect(
    geometry.pads.filter((pad) => (pad.cornerRadius ?? 0) > 0),
  ).toHaveLength(4)
  expect(geometry.pads.filter((pad) => pad.chamfered)).toHaveLength(2)
  const topSlot = geometry.holes.find(
    (hole) => hole.reference === "J1" && hole.pinNumber === "4",
  )
  expect(topSlot).toMatchObject({
    width: 42,
    height: 14,
    rotation: 30,
    plated: false,
  })
  expect(topSlot?.center.x).toBeCloseTo(218.66, 2)
  expect(topSlot?.center.y).toBe(125)

  const bottomSlot = geometry.holes.find(
    (hole) => hole.reference === "J2" && hole.pinNumber === "4",
  )
  expect(bottomSlot).toMatchObject({
    width: 42,
    height: 14,
    rotation: 150,
    plated: false,
  })
  expect(bottomSlot?.center.x).toBeCloseTo(381.34, 2)
  expect(bottomSlot?.center.y).toBe(125)
  expect(geometry.diagnostics).toEqual([])

  const views = [
    { name: "composite", layers: undefined },
    { name: "f_cu", layers: ["F_Cu", "Drill", "Edge_Cuts"] },
    { name: "b_cu", layers: ["B_Cu", "Drill", "Edge_Cuts"] },
    { name: "drill", layers: ["Drill", "Edge_Cuts"] },
  ]
  for (const view of views) {
    const svg = generateSvgFromPads(document, {
      visibleGerberLayers: view.layers,
      showPlacements: false,
      showText: false,
    })
    expectGerberStyleSvg(svg)
    expect(svg.match(/data-kind="component-drill"/gu)).toHaveLength(8)
    expect(svg.match(/data-slot="true"/gu)).toHaveLength(2)
    await expect(svg).toMatchSvgSnapshot(import.meta.path, view.name)
  }
})
