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

const decodeTextBeginning = (sourceBytes: Uint8Array): string =>
  new TextDecoder().decode(sourceBytes.slice(0, 512))

export const detectPadsFormat = (source: string | Uint8Array): PadsFormat => {
  if (typeof source === "string") {
    return isPadsAsciiText(source) ? "ascii" : "unknown"
  }

  if (isPadsBinaryBytes(source)) return "binary"
  return isPadsAsciiText(decodeTextBeginning(source)) ? "ascii" : "unknown"
}

export const parsePads = (source: string | Uint8Array): PadsDocument => {
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
