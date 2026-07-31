import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { generateSvgFromPads, parsePadsAscii } from "../../lib"
import { extractPadsBoardGeometry } from "../../lib/geometry"
import "bun-match-svg"

const sourceText = readFileSync(
  join(import.meta.dir, "../fixtures/copper-cutouts.asc"),
  "utf8",
)

test("renders placed compound copper with Gerber-style negative polarity", () => {
  const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))
  const negativePaths = geometry.paths.filter(
    (path) => path.kind === "copper" && path.polarity === "negative",
  )
  const negativeCircles = geometry.circles.filter(
    (circle) => circle.kind === "copper" && circle.polarity === "negative",
  )

  expect(negativePaths).toHaveLength(2)
  expect(negativeCircles).toHaveLength(2)
  expect(negativePaths.map(({ reference }) => reference)).toEqual(["U1", "U2"])
  expect(negativeCircles.map(({ reference }) => reference)).toEqual([
    "U1",
    "U2",
  ])

  const svg = generateSvgFromPads(sourceText, {
    showPlacements: false,
    showText: false,
  })
  expect(svg).toContain('id="pads-F_Cu-polarity-mask"')
  expect(svg).toContain('id="pads-B_Cu-polarity-mask"')
  expect(svg).toContain('data-polarity="negative"')
  expect(svg).toContain('mask="url(#pads-F_Cu-polarity-mask)"')
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
