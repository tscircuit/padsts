import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  convertPadsCoordinateToNanometers,
  extractPadsBoardGeometry,
  generateSvgFromPads,
  generateSvgFromPadsGeometry,
  parsePads,
} from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/drilled-decals.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)
const mils = (coordinate: number): number =>
  convertPadsCoordinateToNanometers(coordinate, "MILS")

test("accepts a zoom window in normalized board coordinates", async () => {
  const svg = generateSvgFromPads(document, {
    width: 900,
    viewBox: {
      x: mils(60),
      y: mils(75),
      width: mils(200),
      height: mils(160),
    },
    visibleGerberLayers: ["F_Cu", "Drill", "Edge_Cuts"],
    showPlacements: false,
    showText: false,
  })

  expectGerberStyleSvg(svg)
  expect(svg).toContain(
    `viewBox="${mils(60)} ${-mils(235)} ${mils(200)} ${mils(160)}"`,
  )
  expect(svg).toContain('width="900" height="720"')
  expect(svg).toContain(
    `data-kind="negative-space" x="${mils(60)}" y="${-mils(235)}" width="${mils(200)}" height="${mils(160)}"`,
  )
  expect(svg).toContain(
    `<rect x="${mils(60)}" y="${mils(75)}" width="${mils(200)}" height="${mils(160)}" fill="#666666"/>`,
  )
  expect(svg).toContain(
    `&quot;boardViewBox&quot;:{&quot;x&quot;:${mils(60)},&quot;y&quot;:${mils(75)},&quot;width&quot;:${mils(200)},&quot;height&quot;:${mils(160)}}`,
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path, "top-left-pads")
})

test("accepts the same zoom window in source board coordinates", async () => {
  const svg = generateSvgFromPads(document, {
    width: 900,
    viewBox: {
      x: 60,
      y: 75,
      width: 200,
      height: 160,
    },
    viewBoxUnits: "source",
    visibleGerberLayers: ["F_Cu", "Drill", "Edge_Cuts"],
    showPlacements: false,
    showText: false,
  })

  expectGerberStyleSvg(svg)
  expect(svg).toContain(
    `viewBox="${mils(60)} ${-mils(235)} ${mils(200)} ${mils(160)}"`,
  )
  expect(svg).toContain("&quot;boardViewBoxUnits&quot;:&quot;source&quot;")
  expect(svg).toContain(
    `&quot;normalizedBoardViewBox&quot;:{&quot;x&quot;:${mils(60)},&quot;y&quot;:${mils(75)},&quot;width&quot;:${mils(200)},&quot;height&quot;:${mils(160)}}`,
  )
  await expect(svg).toMatchSvgSnapshot(
    import.meta.path,
    "top-left-pads-source-units",
  )
})

test("rejects invalid board-coordinate zoom windows", () => {
  for (const viewBox of [
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: 10, height: -1 },
    { x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 },
  ]) {
    expect(() => generateSvgFromPads(document, { viewBox })).toThrow(RangeError)
  }
})

test("rejects source-coordinate zoom windows when units are unknown", () => {
  const unknownUnitsGeometry = {
    ...extractPadsBoardGeometry(document),
    sourceUnits: "unknown" as const,
  }
  expect(() =>
    generateSvgFromPadsGeometry(unknownUnitsGeometry, {
      viewBox: { x: 0, y: 0, width: 10, height: 10 },
      viewBoxUnits: "source",
    }),
  ).toThrow(RangeError)
})

test("can inspect artwork outside the decoded board outline", () => {
  const svg = generateSvgFromPads(document, {
    viewBox: {
      x: mils(60),
      y: mils(75),
      width: mils(200),
      height: mils(160),
    },
    visibleGerberLayers: ["F_Cu", "Drill"],
    clipArtworkToBoardOutline: false,
    showPlacements: false,
    showText: false,
  })

  expect(svg.match(/ clip-path="url\(#pads-board-outline\)"/gu)).toHaveLength(1)
  expect(svg).toContain("&quot;clipArtworkToBoardOutline&quot;:false")
})
