export class SourceConfigurationError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'SourceConfigurationError'
    this.code = options.code ?? 'SOURCE_CONFIGURATION_ERROR'
    if (options.details !== undefined) this.details = options.details
  }
}

export class SourceStructureChangedError extends Error {
  constructor(message, sourceId = '') {
    super(message)
    this.name = 'SourceStructureChangedError'
    this.code = 'SOURCE_STRUCTURE_CHANGED'
    if (sourceId) this.sourceId = sourceId
  }
}

export class SourceHttpError extends Error {
  constructor(status, url, body = '') {
    super(`Upstream source returned HTTP ${status} for ${url}.`)
    this.name = 'SourceHttpError'
    this.code = 'SOURCE_HTTP_ERROR'
    this.status = status
    this.url = url
    this.body = body
  }
}

export class SourceParseError extends Error {
  constructor(message, sourceId = '', cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SourceParseError'
    this.code = 'SOURCE_PARSE_ERROR'
    if (sourceId) this.sourceId = sourceId
    if (cause) this.cause = cause
  }
}
