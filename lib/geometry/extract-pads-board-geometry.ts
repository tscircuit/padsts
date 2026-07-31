import type { PadsDocument } from "../parse-pads"
import { extractAsciiBoardGeometry } from "./extract-ascii-board-geometry"
import { extractBinaryBoardGeometry } from "./extract-binary-board-geometry"
import type { PadsBoardGeometry } from "./pads-board-geometry"

export const extractPadsBoardGeometry = (
  document: PadsDocument,
): PadsBoardGeometry =>
  document.kind === "ascii"
    ? extractAsciiBoardGeometry(document)
    : extractBinaryBoardGeometry(document)
