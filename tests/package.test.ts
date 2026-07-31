import { expect, test } from "bun:test"

test("the built package exposes parser, inspection, conversion, and SVG APIs", async () => {
  const packageApi = await import("../dist/index.js")

  expect(packageApi).toMatchObject({
    parsePads: expect.any(Function),
    inspectPads: expect.any(Function),
    validatePads: expect.any(Function),
    generateSvgFromPads: expect.any(Function),
    toCircuitJson: expect.any(Function),
    createPadsConversionReport: expect.any(Function),
  })
})
