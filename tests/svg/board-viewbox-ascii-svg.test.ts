import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { generateSvgFromPads, parsePads } from "../../lib"
import { expectGerberStyleSvg } from "./render-downloaded-pads-asset"

const fixturePath = resolve(import.meta.dir, "../fixtures/drilled-decals.asc")
const sourceBytes = await Bun.file(fixturePath).bytes()
const document = parsePads(sourceBytes)

test("accepts a zoom window in native board coordinates", async () => {
  const svg = generateSvgFromPads(document, {
    width: 900,
    viewBox: { x: 60, y: 75, width: 200, height: 160 },
    visibleGerberLayers: ["F_Cu", "Drill", "Edge_Cuts"],
    showPlacements: false,
    showText: false,
  })

  expectGerberStyleSvg(svg)
  expect(svg).toContain('viewBox="60 -235 200 160"')
  expect(svg).toContain('width="900" height="720"')
  expect(svg).toContain(
    'data-kind="negative-space" x="60" y="-235" width="200" height="160"',
  )
  expect(svg).toContain(
    '<rect x="60" y="75" width="200" height="160" fill="#666666"/>',
  )
  expect(svg).toContain(
    "&quot;boardViewBox&quot;:{&quot;x&quot;:60,&quot;y&quot;:75,&quot;width&quot;:200,&quot;height&quot;:160}",
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path, "top-left-pads")
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

test("can inspect artwork outside the decoded board outline", () => {
  const svg = generateSvgFromPads(document, {
    viewBox: { x: 60, y: 75, width: 200, height: 160 },
    visibleGerberLayers: ["F_Cu", "Drill"],
    clipArtworkToBoardOutline: false,
    showPlacements: false,
    showText: false,
  })

  expect(svg.match(/ clip-path="url\(#pads-board-outline\)"/gu)).toHaveLength(1)
  expect(svg).toContain("&quot;clipArtworkToBoardOutline&quot;:false")
})
