import { expect, test } from "bun:test"

test("the built package exposes parser, inspection, report, and SVG APIs", async () => {
  // Keep the build artifact out of TypeScript's source graph. `bun run check`
  // typechecks a clean checkout before building, then this runtime import
  // verifies the generated package after the build step.
  const packageEntry = "../dist/index.js"
  const packageApi = await import(packageEntry)

  expect(packageApi).toMatchObject({
    parsePads: expect.any(Function),
    inspectPads: expect.any(Function),
    validatePads: expect.any(Function),
    generateSvgFromPads: expect.any(Function),
    createPadsConversionReport: expect.any(Function),
  })
})
