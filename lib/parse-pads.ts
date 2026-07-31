import {
  isPadsAsciiText,
  type PadsAsciiDocument,
  parsePadsAscii,
} from "./ascii"
import {
  isPadsBinaryBytes,
  type PadsBinaryDocument,
  parsePadsBinary,
} from "./binary"
import { PadsParseError } from "./parse-error"

export type PadsFormat = "ascii" | "binary" | "unknown"
export type PadsDocument = PadsAsciiDocument | PadsBinaryDocument
export const DEFAULT_MAX_PADS_INPUT_BYTES = 512 * 1024 * 1024

export interface ParsePadsOptions {
  /**
   * Refuse input larger than this many UTF-8 bytes before semantic parsing.
   */
  maxInputBytes?: number
}

const decodeTextBeginning = (sourceBytes: Uint8Array): string =>
  new TextDecoder().decode(sourceBytes.slice(0, 512))

const getUtf8ByteLengthUpToLimit = (
  sourceText: string,
  limit: number,
): number => {
  let byteLength = 0
  for (let index = 0; index < sourceText.length; index++) {
    const codeUnit = sourceText.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      byteLength++
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < sourceText.length
    ) {
      const nextCodeUnit = sourceText.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        byteLength += 4
        index++
      } else {
        byteLength += 3
      }
    } else {
      byteLength += 3
    }
    if (byteLength > limit) return byteLength
  }
  return byteLength
}

export const detectPadsFormat = (source: string | Uint8Array): PadsFormat => {
  if (typeof source === "string") {
    return isPadsAsciiText(source) ? "ascii" : "unknown"
  }

  if (isPadsBinaryBytes(source)) return "binary"
  return isPadsAsciiText(decodeTextBeginning(source)) ? "ascii" : "unknown"
}

export const parsePads = (
  source: string | Uint8Array,
  { maxInputBytes = DEFAULT_MAX_PADS_INPUT_BYTES }: ParsePadsOptions = {},
): PadsDocument => {
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) {
    throw new RangeError("maxInputBytes must be a positive safe integer")
  }
  const sourceByteLength =
    typeof source === "string"
      ? getUtf8ByteLengthUpToLimit(source, maxInputBytes)
      : source.byteLength
  if (sourceByteLength > maxInputBytes) {
    throw new PadsParseError({
      message: `PADS input exceeds the configured ${maxInputBytes}-byte limit`,
      offset: maxInputBytes,
    })
  }
  const format = detectPadsFormat(source)
  if (format === "binary" && source instanceof Uint8Array) {
    return parsePadsBinary(source)
  }
  if (format === "ascii") {
    const sourceText =
      typeof source === "string" ? source : new TextDecoder().decode(source)
    return parsePadsAscii(sourceText)
  }

  throw new PadsParseError({
    message: "Input is not a recognized PADS ASCII or native binary file",
    offset: 0,
  })
}
