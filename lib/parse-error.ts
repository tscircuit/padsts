export interface PadsParseErrorInit {
  message: string
  offset?: number
}

export class PadsParseError extends Error {
  readonly offset?: number

  constructor({ message, offset }: PadsParseErrorInit) {
    super(message)
    this.name = "PadsParseError"
    this.offset = offset
  }
}
