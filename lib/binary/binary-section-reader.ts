import { PadsParseError } from "../parse-error"

export class BinarySectionReader {
  readonly bytes: Uint8Array
  readonly sectionIndex?: number
  readonly baseOffset: number

  constructor(
    bytes: Uint8Array,
    {
      sectionIndex,
      baseOffset = 0,
    }: { sectionIndex?: number; baseOffset?: number } = {},
  ) {
    this.bytes = bytes
    this.sectionIndex = sectionIndex
    this.baseOffset = baseOffset
  }

  private assertRange(offset: number, byteLength: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(byteLength) ||
      offset < 0 ||
      byteLength < 0 ||
      offset + byteLength > this.bytes.byteLength
    ) {
      throw new PadsParseError({
        message: `PADS binary read of ${byteLength} bytes exceeds section bounds${
          this.sectionIndex === undefined
            ? ""
            : ` for section ${this.sectionIndex}`
        }`,
        offset: this.baseOffset + Math.max(0, offset),
      })
    }
  }

  private getDataView(offset: number, byteLength: number): DataView {
    this.assertRange(offset, byteLength)
    return new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + offset,
      byteLength,
    )
  }

  readUint8Checked(offset: number): number {
    this.assertRange(offset, 1)
    return this.bytes[offset] ?? 0
  }

  readInt8Checked(offset: number): number {
    return this.getDataView(offset, 1).getInt8(0)
  }

  readUint16Checked(offset: number): number {
    return this.getDataView(offset, 2).getUint16(0, true)
  }

  readInt16Checked(offset: number): number {
    return this.getDataView(offset, 2).getInt16(0, true)
  }

  readUint32Checked(offset: number): number {
    return this.getDataView(offset, 4).getUint32(0, true)
  }

  readInt32Checked(offset: number): number {
    return this.getDataView(offset, 4).getInt32(0, true)
  }

  readUint64Checked(offset: number): bigint {
    return this.getDataView(offset, 8).getBigUint64(0, true)
  }

  readInt64Checked(offset: number): bigint {
    return this.getDataView(offset, 8).getBigInt64(0, true)
  }

  readFloat32Checked(offset: number): number {
    return this.getDataView(offset, 4).getFloat32(0, true)
  }

  readFloat64Checked(offset: number): number {
    return this.getDataView(offset, 8).getFloat64(0, true)
  }

  readBytesChecked(offset: number, byteLength: number): Uint8Array {
    this.assertRange(offset, byteLength)
    return this.bytes.slice(offset, offset + byteLength)
  }

  readUint8(offset: number): number | undefined {
    try {
      return this.readUint8Checked(offset)
    } catch {
      return undefined
    }
  }

  readUint16(offset: number): number | undefined {
    try {
      return this.readUint16Checked(offset)
    } catch {
      return undefined
    }
  }

  readUint32(offset: number): number | undefined {
    try {
      return this.readUint32Checked(offset)
    } catch {
      return undefined
    }
  }

  readInt32(offset: number): number | undefined {
    try {
      return this.readInt32Checked(offset)
    } catch {
      return undefined
    }
  }

  readFixedString(offset: number, maximumLength: number): string {
    if (maximumLength <= 0 || offset < 0 || offset >= this.bytes.length) {
      return ""
    }
    const availableEnd = Math.min(offset + maximumLength, this.bytes.length)
    let stringEnd = offset
    while (
      stringEnd < availableEnd &&
      this.bytes[stringEnd] !== 0 &&
      this.bytes[stringEnd] !== 0xff
    ) {
      stringEnd++
    }

    return new TextDecoder()
      .decode(this.bytes.slice(offset, stringEnd))
      .trimEnd()
  }
}
