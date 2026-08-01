import { expect, test } from "bun:test"
import { generateSvgFromPads, parsePads } from "../../lib"

const fixtureUrl = new URL("../fixtures/text-layers.asc", import.meta.url)

test("renders free text on its physical Gerber-style layer", async () => {
  const document = parsePads(await Bun.file(fixtureUrl).text())
  const svg = generateSvgFromPads(document, {
    width: 800,
    showPlacements: false,
  })

  expect(svg).toContain('id="pads-F_Silkscreen-text"')
  expect(svg).toContain('id="pads-B_Silkscreen-text"')
  expect(svg).toContain('id="pads-F_Fab-text"')
  expect(svg).toContain('id="pads-F_Mask-text"')
  expect(svg).toContain('data-gerber-layer-name="B_Silkscreen"')
  expect(svg).toContain("scale(-1,-1)")
  await expect(svg).toMatchSvgSnapshot(import.meta.path)

  const bottomSilkscreen = generateSvgFromPads(document, {
    width: 800,
    showPlacements: false,
    visibleGerberLayers: ["B_Silkscreen", "Edge_Cuts"],
  })
  expect(bottomSilkscreen).toContain(">BOT</text>")
  expect(bottomSilkscreen).not.toContain(">TOP</text>")
  expect(bottomSilkscreen).not.toContain(">FAB</text>")
  expect(bottomSilkscreen).not.toContain(">MASK</text>")
  await expect(bottomSilkscreen).toMatchSvgSnapshot(
    import.meta.path,
    "bottom-silkscreen",
  )
})
