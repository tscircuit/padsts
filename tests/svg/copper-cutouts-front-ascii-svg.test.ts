import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { generateSvgFromPads } from "../../lib"
import "bun-match-svg"

test("renders the front compound-copper layer in isolation", () => {
  const sourceText = readFileSync(
    join(import.meta.dir, "../fixtures/copper-cutouts.asc"),
    "utf8",
  )
  const svg = generateSvgFromPads(sourceText, {
    visibleGerberLayers: ["F_Cu", "Edge_Cuts"],
    showPlacements: false,
    showText: false,
  })
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
