import { describe, expect, test } from "bun:test"
import { BinarySectionReader, PadsParseError } from "../lib"

describe("BinarySectionReader", () => {
  test("reads signed, unsigned, floating-point, and fixed-string fields", () => {
    const bytes = new Uint8Array(42)
    const view = new DataView(bytes.buffer)
    view.setUint8(0, 0xfe)
    view.setInt8(1, -2)
    view.setUint16(2, 0xabcd, true)
    view.setInt16(4, -1234, true)
    view.setUint32(6, 0xfedcba98, true)
    view.setInt32(10, -123_456_789, true)
    view.setBigUint64(14, 0xfedcba9876543210n, true)
    view.setBigInt64(22, -1_234_567_890_123n, true)
    view.setFloat32(30, 1.5, true)
    view.setFloat64(34, -Math.PI, true)
    const stringReader = new BinarySectionReader(
      new TextEncoder().encode("PAD\0trailing"),
    )
    expect(stringReader.readFixedString(0, 4)).toBe("PAD")

    const reader = new BinarySectionReader(bytes, {
      sectionIndex: 12,
      baseOffset: 100,
    })
    expect(reader.readUint8Checked(0)).toBe(0xfe)
    expect(reader.readInt8Checked(1)).toBe(-2)
    expect(reader.readUint16Checked(2)).toBe(0xabcd)
    expect(reader.readInt16Checked(4)).toBe(-1234)
    expect(reader.readUint32Checked(6)).toBe(0xfedcba98)
    expect(reader.readInt32Checked(10)).toBe(-123_456_789)
    expect(reader.readUint64Checked(14)).toBe(0xfedcba9876543210n)
    expect(reader.readInt64Checked(22)).toBe(-1_234_567_890_123n)
    expect(reader.readFloat32Checked(30)).toBe(1.5)
    expect(reader.readFloat64Checked(34)).toBeCloseTo(-Math.PI)
  })

  test("throws source-offset errors for checked out-of-bounds reads", () => {
    const reader = new BinarySectionReader(new Uint8Array(4), {
      sectionIndex: 8,
      baseOffset: 500,
    })

    expect(() => reader.readUint32Checked(2)).toThrow(PadsParseError)
    try {
      reader.readUint32Checked(2)
    } catch (error) {
      expect(error).toMatchObject({
        offset: 502,
      })
      expect(String(error)).toContain("section 8")
    }
    expect(reader.readUint32(2)).toBeUndefined()
  })
})
