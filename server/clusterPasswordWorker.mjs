import {
  hashAccountPassword,
  verifyAccountPassword,
} from './passwordSecurity.js'

const REQUEST_TYPE = 'phd-atlas.password-work.request'
const RESPONSE_TYPE = 'phd-atlas.password-work.response'
const READY_TYPE = 'phd-atlas.password-work.ready'
const MAX_PASSWORD_LENGTH = 4_096
const MAX_HASH_LENGTH = 4_096

process.send?.({
  type: READY_TYPE,
})

function validParentMessage(message) {
  return Boolean(
    message
    && message.type === REQUEST_TYPE
    && typeof message.requestId === 'string'
    && message.sourcePid === process.ppid
    && typeof message.password === 'string'
    && message.password.length <= MAX_PASSWORD_LENGTH,
  )
}

process.on('message', (message) => {
  if (!validParentMessage(message)) return
  if (message.operation === 'verify') {
    if (typeof message.encoded !== 'string' || message.encoded.length > MAX_HASH_LENGTH) return
    void verifyAccountPassword(message.password, message.encoded)
      .then((result) => process.send?.({
        type: RESPONSE_TYPE,
        requestId: message.requestId,
        result,
      }))
      .catch((error) => process.send?.({
        type: RESPONSE_TYPE,
        requestId: message.requestId,
        error: {
          code: error?.code || 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_ERROR',
          message: error?.message || String(error),
        },
      }))
    return
  }
  if (message.operation === 'hash') {
    void hashAccountPassword(message.password)
      .then((hash) => process.send?.({
        type: RESPONSE_TYPE,
        requestId: message.requestId,
        result: hash,
      }))
      .catch((error) => process.send?.({
        type: RESPONSE_TYPE,
        requestId: message.requestId,
        error: {
          code: error?.code || 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_ERROR',
          message: error?.message || String(error),
        },
      }))
    return
  }
  process.send?.({
    type: RESPONSE_TYPE,
    requestId: message.requestId,
    error: {
      code: 'PHD_ATLAS_CLUSTER_PASSWORD_WORKER_UNSUPPORTED',
      message: 'Unsupported password worker operation.',
    },
  })
})

process.on('message', (message) => {
  if (message?.type === 'shutdown' && message.sourcePid === process.ppid) {
    process.disconnect()
  }
})

process.once('disconnect', () => {
  process.exit(0)
})
