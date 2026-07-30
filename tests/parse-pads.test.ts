import { describe, expect, test } from "bun:test"
import { detectPadsFormat, PadsParseError, parsePads } from "../lib"

describe("parsePads", () => {
  test("returns unknown for arbitrary input", () => {
    expect(detectPadsFormat("not a board")).toBe("unknown")
    expect(() => parsePads("not a board")).toThrow(PadsParseError)
  })

  test("identifies the binary family before version validation", () => {
    const sourceBytes = new Uint8Array(64)
    sourceBytes[0] = 0x00
    sourceBytes[1] = 0xff
    sourceBytes[2] = 0x99
    sourceBytes[3] = 0x99

    expect(detectPadsFormat(sourceBytes)).toBe("binary")
    expect(() => parsePads(sourceBytes)).toThrow("Unsupported PADS binary")
  })
})
