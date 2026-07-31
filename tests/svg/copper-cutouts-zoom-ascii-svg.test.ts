import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { generateSvgFromPads } from "../../lib"
import "bun-match-svg"

test("zooms into front and bottom compound copper in board coordinates", () => {
  const sourceText = readFileSync(
    join(import.meta.dir, "../fixtures/copper-cutouts.asc"),
    "utf8",
  )
  const svg = generateSvgFromPads(sourceText, {
    viewBox: {
      x: 40 * 25_400,
      y: 40 * 25_400,
      width: 520 * 25_400,
      height: 220 * 25_400,
    },
    width: 1200,
    visibleGerberLayers: ["F_Cu", "B_Cu", "Edge_Cuts"],
    showPlacements: false,
    showText: false,
  })
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
