import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { ImapFlow } from 'imapflow'
import imapTools from 'imapflow/lib/tools.js'
import imapSearchCompiler from 'imapflow/lib/search-compiler.js'
import { simpleParser } from 'mailparser'
import {
  OutboundNetworkPolicyError,
  resolveMailNetworkTarget,
} from './outboundNetworkPolicy.js'
import {
  analyzeInboundMailThreat,
  detectDeceptiveMailLinks,
} from './mailThreatAnalysis.js'
import {
  hasDangerousInboundAttachmentName,
  hasInboundVirusTestMarker,
  validateInboundAttachmentContent,
} from './uploadSecurity.js'

export class MailFetchError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'MailFetchError'
    this.code = code // 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'CONNECTION_FAILED' | 'UNSUPPORTED_PROTOCOL'
    this.cause = cause
  }
}

function classifyImapError(error) {
  if (error?.authenticationFailed || /AUTHENTICATIONFAILED/i.test(error?.responseText ?? '')) {
    return new MailFetchError('AUTH_FAILED', 'IMAP authentication failed. Check the username and password.', error)
  }
  return new MailFetchError('CONNECTION_FAILED', 'Could not reach the IMAP server. Check the host and port.', error)
}

// ImapFlow reports transport failures both through the awaited command and an
// EventEmitter `error` event. The event may arrive after the command promise or
// during LOGOUT, so leaving it unowned can terminate the entire API process.
// Retain the first transport failure for the operation guard to surface while
// keeping the listener attached for the complete lifetime of the client.
const imapTransportErrors = new WeakMap()

function ownImapTransportErrors(client) {
  const state = { error: null }
  imapTransportErrors.set(client, state)
  client.on('error', (error) => {
    state.error ??= error instanceof Error ? error : new Error(String(error))
  })
  return client
}

/** Very small tag-stripper — good enough for a plain-text communication summary field, not a rendering pipeline. */
function htmlToPlainText(html) {
  if (!html) return ''
  return boundedTextCopy(html, MAX_INBOUND_TEXT_PREVIEW_CHARS)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function boundedTextCopy(value, maximumCharacters) {
  const text = String(value ?? '')
  if (text.length <= maximumCharacters) return text
  // Force a compact backing store instead of retaining a sliced reference to
  // the complete hostile body in the returned bounded batch.
  return Buffer.from(text.slice(0, maximumCharacters), 'utf8').toString('utf8')
}

const EXCLUDED_SPECIAL_USE = new Set(['\\trash', '\\junk', '\\drafts'])

function normalizedMailboxName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

const SENT_MAILBOX_NAMES = new Set([
  'sent',
  'sent mail',
  'sent items',
  'sent messages',
  'gesendet',
  'gesendete elemente',
  'gesendete nachrichten',
  'enviados',
  'elementos enviados',
  'correo enviado',
  'envoyes',
  'elements envoyes',
  'messages envoyes',
  'inviati',
  'posta inviata',
  'itens enviados',
  'mensagens enviadas',
  'verzonden',
  'wyslane',
  'gonderilmis ogeler',
  '已发送',
  '已发邮件',
  '已发送邮件',
  '发件箱',
  '已發送',
  '寄件備份',
  '已寄出',
  '送信済み',
  '送信済みメール',
  '보낸편지함',
  '보낸 메일',
  'отправленные',
  'отправленные элементы',
  'ส่งแล้ว',
  'จดหมายที่ส่งแล้ว',
  'da gui',
  'thu da gui',
].map(normalizedMailboxName))

const EXCLUDED_MAILBOX_NAMES = new Set([
  'trash',
  'deleted items',
  'deleted messages',
  'bin',
  'junk',
  'junk mail',
  'spam',
  'drafts',
  'draft',
  '垃圾箱',
  '已删除邮件',
  '垃圾邮件',
  '草稿',
  '草稿箱',
  'papierkorb',
  'geloschte elemente',
  'junk e mail',
  'entwurfe',
  'papelera',
  'elementos eliminados',
  'correo no deseado',
  'borradores',
  'corbeille',
  'elements supprimes',
  'courrier indesirable',
  'brouillons',
  'cestino',
  'posta indesiderata',
  'bozze',
  'lixeira',
  'itens excluidos',
  'spam',
  'rascunhos',
  'ゴミ箱',
  '迷惑メール',
  '下書き',
  '휴지통',
  '스팸',
  '임시보관함',
  'корзина',
  'удаленные',
  'спам',
  'черновики',
  'ถังขยะ',
  'จดหมายขยะ',
  'แบบร่าง',
  'thung rac',
  'thu rac',
  'ban nhap',
].map(normalizedMailboxName))
const FETCH_UID_CHUNK_SIZE = 40
const UID_SEARCH_WINDOW_SIZE = 200
const SEARCH_ADDRESSES_PER_COMMAND = 32
const MAX_TARGETED_SEARCH_ADDRESSES = 64
const MAX_SEARCH_RESPONSE_FRAMES = 16
const MAX_SEARCH_RESPONSE_TOKENS = UID_SEARCH_WINDOW_SIZE + 128
const MAX_SEARCH_RESPONSE_BYTES = 16 * 1024
const MIN_NEXT_IMAP_COMMAND_BUDGET_MS = 1_500

// MailParser can temporarily retain the RFC822 source, decoded body and
// attachment buffers at the same time. Keep one message comfortably inside
// the 64 MiB soft-to-hard reserve of the default 512 MiB runtime budget, and
// never retain an unbounded history result in memory.
export const MAX_INBOUND_MESSAGE_SOURCE_BYTES = 16 * 1024 * 1024
export const MAX_MAIL_FETCH_BATCH_MESSAGES = 50
export const MAX_MAIL_FETCH_BATCH_SOURCE_BYTES = 24 * 1024 * 1024
export const MAX_MAIL_FETCH_BATCH_SCANNED_UIDS = 10_000
const MAX_INBOUND_HEADER_BYTES = 256 * 1024
const MAX_INBOUND_TEXT_PREVIEW_CHARS = 512 * 1024
const MAX_INBOUND_MIME_CHILD_NODES = 2_048
export const MAX_INBOUND_ATTACHMENTS_PER_MESSAGE = 128
export const MAX_MAIL_FETCH_BATCH_ATTACHMENTS = 512
const MAX_IMAP_PROTOCOL_LINE_BYTES = 256 * 1024
// Reserve one slot for the synthetic INBOX fallback so the returned folder
// state can never exceed storage's 256-entry continuation cap.
const MAX_IMAP_MAILBOXES = 255
const MAX_IMAP_UID = 4_294_967_295
// JSON escaping can double quote/backslash-heavy mailbox paths. Leave ample
// room beneath the 512 KiB durable-continuation cap for 256 state objects and
// their metadata after the synthetic INBOX slot is added.
const MAX_IMAP_MAILBOX_LIST_BYTES = 192 * 1024
const MAX_IMAP_FOLDER_STATE_JSON_BYTES = 448 * 1024
const MAX_UNSOLICITED_FETCH_FRAMES_PER_COMMAND = 128
export const MAIL_FETCH_OPERATION_TIMEOUT_MS = 2 * 60 * 1000
const MAX_MAIL_FETCH_OPERATION_TIMEOUT_MS = 5 * 60 * 1000
const { decodePath: decodeImapPath, encodePath: encodeImapPath, normalizePath: normalizeImapPath } = imapTools
const { searchCompiler: compileImapSearch } = imapSearchCompiler
const MAIL_PARSER_OPTIONS = Object.freeze({
  // Never base64-expand inline CID attachments into another HTML copy while
  // the source and decoded attachment buffers are still live.
  keepCidLinks: true,
  // We derive a bounded plain-text preview ourselves. MailParser's implicit
  // HTML/text conversions can otherwise amplify a hostile 16 MiB body.
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipTextLinks: true,
  maxHtmlLengthToParse: 512 * 1024,
})

function countAsciiToken(source, lowerToken, maximum) {
  const lowerFirst = lowerToken.charCodeAt(0)
  const upperFirst = lowerToken.toUpperCase().charCodeAt(0)
  let offset = 0
  let matches = 0
  while (offset <= source.length - lowerToken.length) {
    const lowerOffset = source.indexOf(lowerFirst, offset)
    const upperOffset = source.indexOf(upperFirst, offset)
    if (lowerOffset < 0 && upperOffset < 0) break
    const candidate = lowerOffset < 0
      ? upperOffset
      : upperOffset < 0
        ? lowerOffset
        : Math.min(lowerOffset, upperOffset)
    let matched = true
    for (let index = 1; index < lowerToken.length; index += 1) {
      const byte = source[candidate + index]
      const folded = byte >= 65 && byte <= 90 ? byte + 32 : byte
      if (folded !== lowerToken.charCodeAt(index)) {
        matched = false
        break
      }
    }
    if (matched) {
      matches += 1
      if (matches > maximum) return matches
      offset = candidate + lowerToken.length
    } else {
      offset = candidate + 1
    }
  }
  return matches
}

function exceedsMimeNodeBudget(source) {
  // Every multipart child requires a boundary delimiter; every recursively
  // parsed embedded message requires the literal message/rfc822 media type.
  // Counting both directly on the raw Buffer gives a conservative hard upper
  // bound before MailParser creates its MIME tree. This is authoritative for
  // the installed MailParser version, which has no node-limit option.
  let nodeUpperBound = 1
  let offset = 0
  if (source[0] === 45 && source[1] === 45) {
    nodeUpperBound += 1
    if (nodeUpperBound > MAX_INBOUND_MIME_CHILD_NODES) return true
    offset = 2
  }
  while ((offset = source.indexOf('\n--', offset)) >= 0) {
    nodeUpperBound += 1
    if (nodeUpperBound > MAX_INBOUND_MIME_CHILD_NODES) return true
    offset += 3
  }
  const remaining = MAX_INBOUND_MIME_CHILD_NODES - nodeUpperBound
  return countAsciiToken(source, 'message/rfc822', remaining) > remaining
}

async function createImapClient(settings, { resolveNetworkTarget = resolveMailNetworkTarget, signal } = {}) {
  let target
  try {
    target = await resolveNetworkTarget(settings?.incomingHost, { signal })
  } catch (error) {
    if (!(error instanceof OutboundNetworkPolicyError)) throw error
    if (['INVALID_OUTBOUND_HOST', 'OUTBOUND_HOST_NOT_PUBLIC'].includes(error.code)) {
      throw new MailFetchError(
        'UNSAFE_HOST',
        'The IMAP host is invalid or is not permitted by the server network policy.',
        error,
      )
    }
    throw new MailFetchError('CONNECTION_FAILED', 'Could not resolve the IMAP server host.', error)
  }
  const secure = Boolean(settings?.incomingTls ?? true)
  const requireEncryptedTransport = process.env.NODE_ENV === 'production'
    && process.env.MAIL_ALLOW_PLAINTEXT !== '1'
  return ownImapTransportErrors(new ImapFlow({
    host: target.address,
    ...(target.servername ? { servername: target.servername } : {}),
    port: Number(settings?.incomingPort ?? 993),
    secure,
    ...(!secure && requireEncryptedTransport ? { doSTARTTLS: true } : {}),
    auth: {
      user: String(settings?.incomingUser ?? '').trim(),
      pass: settings?.incomingPass ?? '',
    },
    tls: {
      rejectUnauthorized: true,
      ...(target.servername ? { servername: target.servername } : {}),
    },
    logger: false,
    // ImapFlow defaults both protocol limits near 1 GiB. Enforce them before
    // its parser allocates an attacker-controlled literal or unterminated line;
    // post-fetch source checks are too late to protect process memory.
    maxLiteralSize: MAX_INBOUND_MESSAGE_SOURCE_BYTES + 1,
    maxLineLength: MAX_IMAP_PROTOCOL_LINE_BYTES,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  }))
}

async function createImapClientWithinDeadline(settings, {
  signal,
  timeoutMs = MAIL_FETCH_OPERATION_TIMEOUT_MS,
  abortCode = 'MAIL_SYNC_SHUTDOWN_DEFERRED',
  timeoutCode = 'MAIL_SYNC_TIME_SLICE_DEFERRED',
  abortMessage = 'Mail sync paused because the server is stopping.',
  timeoutMessage = 'Mail sync reached its bounded operation deadline and will continue later.',
  resolveNetworkTarget,
} = {}) {
  const boundedTimeoutMs = boundedPositiveInteger(
    timeoutMs,
    MAIL_FETCH_OPERATION_TIMEOUT_MS,
    MAX_MAIL_FETCH_OPERATION_TIMEOUT_MS,
  )
  const deadlineAt = performance.now() + boundedTimeoutMs
  const deadlineSignal = AbortSignal.timeout(boundedTimeoutMs)
  const setupSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal
  const deferredError = () => signal?.aborted
    ? new MailFetchError(abortCode, abortMessage)
    : new MailFetchError(timeoutCode, timeoutMessage)
  if (setupSignal.aborted) throw deferredError()

  let rejectCancellation
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject
  })
  const cancel = () => rejectCancellation(deferredError())
  setupSignal.addEventListener('abort', cancel, { once: true })
  try {
    const client = await Promise.race([
      createImapClient(settings, { resolveNetworkTarget, signal: setupSignal }),
      cancellation,
    ])
    if (signal?.aborted || deadlineSignal.aborted || performance.now() >= deadlineAt) {
      try {
        client.close()
      } catch {
        // The canonical deferred error below owns the failed setup result.
      }
      throw deferredError()
    }
    return { client, deadlineAt, timeoutMs: boundedTimeoutMs }
  } finally {
    setupSignal.removeEventListener('abort', cancel)
  }
}

function createImapOperationGuard(client, {
  signal,
  timeoutMs = MAIL_FETCH_OPERATION_TIMEOUT_MS,
  deadlineAt: requestedDeadlineAt,
  abortCode = 'MAIL_SYNC_SHUTDOWN_DEFERRED',
  timeoutCode = 'MAIL_SYNC_TIME_SLICE_DEFERRED',
  abortMessage = 'Mail sync paused because the server is stopping.',
  timeoutMessage = 'Mail sync reached its bounded operation deadline and will continue later.',
} = {}) {
  const boundedTimeoutMs = boundedPositiveInteger(
    timeoutMs,
    MAIL_FETCH_OPERATION_TIMEOUT_MS,
    MAX_MAIL_FETCH_OPERATION_TIMEOUT_MS,
  )
  const startedAt = performance.now()
  const deadlineAt = Number.isFinite(Number(requestedDeadlineAt))
    ? Math.min(Number(requestedDeadlineAt), startedAt + boundedTimeoutMs)
    : startedAt + boundedTimeoutMs
  const remainingTimeoutMs = Math.max(1, Math.ceil(deadlineAt - startedAt))
  const deadlineSignal = AbortSignal.timeout(remainingTimeoutMs)
  const operationSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    try {
      client.close()
    } catch {
      // The checkpoint or in-flight command reports the canonical error.
    }
  }
  const checkpoint = () => {
    if (signal?.aborted) {
      close()
      throw new MailFetchError(abortCode, abortMessage)
    }
    // The explicit monotonic comparison remains authoritative even if a large
    // synchronous parser step delayed the AbortSignal timeout callback.
    if (deadlineSignal.aborted || performance.now() >= deadlineAt) {
      close()
      throw new MailFetchError(timeoutCode, timeoutMessage)
    }
    const transportError = imapTransportErrors.get(client)?.error
    if (transportError) {
      close()
      throw classifyImapError(transportError)
    }
  }
  const shouldYield = (minimumRemainingMs = MIN_NEXT_IMAP_COMMAND_BUDGET_MS) => {
    checkpoint()
    return deadlineAt - performance.now() <= Math.max(1, Number(minimumRemainingMs) || 1)
  }
  if (operationSignal.aborted) close()
  else operationSignal.addEventListener('abort', close, { once: true })
  const dispose = () => operationSignal.removeEventListener('abort', close)
  return { checkpoint, shouldYield, close, dispose, deadlineAt, timeoutMs: remainingTimeoutMs }
}

async function listMailboxesBounded(client, operation) {
  const entries = []
  let aggregateBytes = 0
  // Reserve the exact serialized state shape for the possible synthetic
  // INBOX. The remaining budget measures normalized path JSON, so CTLs such as
  // U+0001 are charged for their six-byte `\u0001` representation instead of
  // their one-byte in-memory form.
  const serializedStateSuffix = ':{"uidValidity":"4294967295","lastUid":4294967295},'
  let aggregateStateJsonBytes = Buffer.byteLength(JSON.stringify('INBOX') + serializedStateSuffix)
  const hasCapability = (value) => Boolean(client.capabilities?.has?.(value))
  const listCommand = hasCapability('XLIST') && !hasCapability('SPECIAL-USE') ? 'XLIST' : 'LIST'
  const reference = normalizeImapPath(client, '')
  const mailbox = normalizeImapPath(client, '*', true)
  const response = await client.exec(
    listCommand,
    [encodeImapPath(client, reference), encodeImapPath(client, mailbox)],
    {
      untagged: {
        [listCommand]: async (untagged) => {
          operation.checkpoint()
          const attributes = untagged?.attributes
          if (!Array.isArray(attributes) || attributes.length < 3) return
          const rawPath = String(attributes[2]?.value ?? '')
          const delimiter = attributes[1]?.value ? String(attributes[1].value) : null
          const rawFlags = Array.isArray(attributes[0]) ? attributes[0] : []
          const flags = new Set(rawFlags.map((entry) => String(entry?.value ?? '')).filter(Boolean))
          const normalizedPath = normalizeImapPath(client, decodeImapPath(client, rawPath))
          const rowBytes = Buffer.byteLength(rawPath)
            + Buffer.byteLength(delimiter ?? '')
            + [...flags].reduce((total, flag) => total + Buffer.byteLength(flag), 0)
          const rowStateJsonBytes = Buffer.byteLength(
            JSON.stringify(normalizedPath) + serializedStateSuffix,
          )
          if (
            entries.length >= MAX_IMAP_MAILBOXES
            || aggregateBytes + rowBytes > MAX_IMAP_MAILBOX_LIST_BYTES
            || aggregateStateJsonBytes + rowStateJsonBytes > MAX_IMAP_FOLDER_STATE_JSON_BYTES
          ) {
            operation.close()
            throw new MailFetchError(
              'MAILBOX_LIMIT_EXCEEDED',
              'The IMAP server returned too many mailboxes to process safely.',
            )
          }
          aggregateBytes += rowBytes
          aggregateStateJsonBytes += rowStateJsonBytes
          entries.push({
            path: normalizedPath,
            flags,
            delimiter,
          })
        },
      },
    },
  )
  operation.checkpoint()
  response.next()
  return entries
}

/**
 * Verifies the same authenticated IMAP session used by sync. A raw TLS socket
 * check can succeed even when the saved credentials or mailbox access fail.
 */
export async function verifyImapConnection(settings, options = {}) {
  const host = String(settings?.incomingHost ?? '').trim()
  const user = String(settings?.incomingUser ?? '').trim()
  if (!host || !user) {
    throw new MailFetchError('NOT_CONFIGURED', 'Incoming mail is not configured.')
  }
  if (settings?.incomingProtocol !== 'imap') {
    throw new MailFetchError('UNSUPPORTED_PROTOCOL', 'This connection check requires IMAP.')
  }

  const setup = await createImapClientWithinDeadline(settings, {
    signal: options.signal,
    timeoutMs: options.operationTimeoutMs,
    abortCode: 'CONNECTION_FAILED',
    timeoutCode: 'CONNECTION_FAILED',
    abortMessage: 'Incoming mail connection verification was cancelled.',
    timeoutMessage: 'Incoming mail connection verification timed out.',
    resolveNetworkTarget: options.resolveNetworkTarget,
  })
  const client = setup.client
  const operation = createImapOperationGuard(client, {
    signal: options.signal,
    timeoutMs: setup.timeoutMs,
    deadlineAt: setup.deadlineAt,
    abortCode: 'CONNECTION_FAILED',
    timeoutCode: 'CONNECTION_FAILED',
    abortMessage: 'Incoming mail connection verification was cancelled.',
    timeoutMessage: 'Incoming mail connection verification timed out.',
  })
  let lock = null
  try {
    operation.checkpoint()
    await client.connect()
    operation.checkpoint()
    // INBOX exists for every conforming IMAP account. Selecting it verifies
    // authenticated mailbox access without invoking ImapFlow's unbounded
    // built-in LIST accumulator.
    lock = await client.getMailboxLock('INBOX')
    operation.checkpoint()
  } catch (error) {
    operation.checkpoint()
    if (error instanceof MailFetchError) throw error
    throw classifyImapError(error)
  } finally {
    lock?.release()
    try {
      await client.logout().catch(() => {})
    } finally {
      // Keep the wall-clock guard attached while LOGOUT is in flight. A
      // trickling server is force-closed by the guard at the deadline, and a
      // successful short-lived verification session is closed explicitly too.
      operation.close()
      operation.dispose()
    }
  }
}

function sanitizeAttachmentName(value, fallback) {
  const name = String(value ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
  return name.slice(0, 255) || fallback
}

function attachmentMetadata(parsedAttachments = [], sourceId) {
  const attachments = []
  let blocked = 0
  let omitted = 0
  for (const [index, attachment] of parsedAttachments.entries()) {
    if (attachments.length >= MAX_INBOUND_ATTACHMENTS_PER_MESSAGE) {
      // A count cap is a benign resource-boundary truncation, not evidence of
      // hostile MIME. Keep the already validated prefix instead of feeding the
      // overflow into threat analysis and quarantining every safe attachment.
      omitted += parsedAttachments.length - index
      break
    }
    const fileName = sanitizeAttachmentName(attachment.filename, `attachment-${index + 1}`)
    // mailparser already owns a fresh decoded Buffer. Reusing it avoids a
    // second full-size allocation while the RFC822 source is still resident.
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content ?? '')
    if (
      !validateInboundAttachmentContent({
        buffer: content,
        filename: fileName,
        mimeType: attachment.contentType,
      }).ok
    ) {
      blocked += 1
      continue
    }
    attachments.push({
      id: `mail-${sourceId}-${index + 1}`,
      fileName,
      fileSize: Number(attachment.size ?? attachment.content?.length ?? 0),
      mimeType: attachment.contentType || 'application/octet-stream',
      source: 'mail',
      // Kept only until the mail-sync layer places it in the encrypted upload
      // vault. `messageToCommunicationInput` deliberately strips this field
      // so raw mail bytes never enter application JSON.
      content,
    })
  }
  return { attachments, blocked, omitted }
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function normalizeMailAddress(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/^mailto:/, '')
  if (!raw) return ''
  const angleAddress = raw.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/)
  const candidate = (angleAddress?.[1] ?? raw).replace(/^['"]|['"]$/g, '').trim()
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : ''
}

function addressObjectValues(addressObject) {
  return Array.isArray(addressObject?.value)
    ? addressObject.value.map((entry) => entry?.address).filter(Boolean)
    : []
}

function envelopeAddressValues(addresses) {
  return Array.isArray(addresses) ? addresses.map((entry) => entry?.address).filter(Boolean) : []
}

export function normalizeMailAddressList(value) {
  const rawValues = []
  if (Array.isArray(value)) {
    rawValues.push(...value.flatMap((entry) => {
      if (typeof entry === 'string') return entry.split(',')
      if (entry?.address) return [entry.address]
      if (Array.isArray(entry?.value)) return entry.value.map((candidate) => candidate?.address)
      return []
    }))
  } else if (typeof value === 'string') {
    rawValues.push(...value.split(','))
  } else if (value?.address) {
    rawValues.push(value.address)
  } else if (Array.isArray(value?.value)) {
    rawValues.push(...value.value.map((entry) => entry?.address))
  }
  return Array.from(new Set(rawValues.map(normalizeMailAddress).filter(Boolean)))
}

function normalizeMessageId(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^<|>$/g, '').replace(/\s+/g, '')
}

function normalizedDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? 0)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function normalizedText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').trim()
}

export function mailAccountKey(settings) {
  const protocol = settings?.incomingProtocol === 'pop3' ? 'pop3' : 'imap'
  const host = String(settings?.incomingHost ?? '').trim().toLowerCase()
  const port = Number(settings?.incomingPort ?? (protocol === 'imap' ? 993 : 995))
  const user = normalizeMailAddress(settings?.incomingUser) || String(settings?.incomingUser ?? '').trim().toLowerCase()
  const tls = (settings?.incomingTls ?? true) ? 'tls' : 'plain'
  return `mail-account-${sha256([protocol, host, port, user, tls].join('|')).slice(0, 32)}`
}

/** Stable across folders and repeated sync runs; raw Message-IDs are never persisted as the key. */
export function mailMessageKey(message) {
  const providerId = String(message?.emailId ?? '').trim()
  const messageId = normalizeMessageId(message?.messageId)
  let identity
  if (providerId) {
    identity = `provider:${providerId}`
  } else if (messageId) {
    identity = `message-id:${messageId}`
  } else {
    identity = JSON.stringify({
      from: normalizeMailAddressList(message?.fromAddresses ?? message?.from).sort(),
      to: normalizeMailAddressList(message?.toAddresses ?? message?.to).sort(),
      cc: normalizeMailAddressList(message?.ccAddresses ?? message?.cc).sort(),
      bcc: normalizeMailAddressList(message?.bccAddresses ?? message?.bcc).sort(),
      subject: normalizedText(message?.subject).toLowerCase(),
      date: normalizedDate(message?.date ?? message?.internalDate),
      text: normalizedText(message?.text),
      attachments: (message?.attachments ?? []).map((attachment) => [
        String(attachment?.fileName ?? '').toLowerCase(),
        Number(attachment?.fileSize ?? 0),
        String(attachment?.mimeType ?? '').toLowerCase(),
      ]),
    })
  }
  return `mail-${sha256(identity).slice(0, 40)}`
}

export function classifyTrackedMailMessage(message, trackedAddresses, ownerAddresses) {
  const tracked = new Set(normalizeMailAddressList(trackedAddresses))
  if (tracked.size === 0) return null
  const owners = new Set(normalizeMailAddressList(ownerAddresses))
  const from = normalizeMailAddressList(message?.fromAddresses ?? message?.from)
  const recipients = normalizeMailAddressList([
    ...normalizeMailAddressList(message?.toAddresses ?? message?.to),
    ...normalizeMailAddressList(message?.ccAddresses ?? message?.cc),
    ...normalizeMailAddressList(message?.bccAddresses ?? message?.bcc),
  ])
  const incomingMatches = from.filter((address) => tracked.has(address))
  if (incomingMatches.length > 0) {
    return { direction: 'incoming', matchedAddresses: incomingMatches }
  }
  const outgoingMatches = recipients.filter((address) => tracked.has(address))
  const sentFolder = message?.folderRole === 'sent'
  const senderOwned = from.some((address) => owners.has(address))
  if (outgoingMatches.length > 0 && (senderOwned || sentFolder)) {
    return { direction: 'outgoing', matchedAddresses: outgoingMatches }
  }
  return null
}

function mailboxLeaf(entry) {
  if (entry?.name) return normalizedMailboxName(entry.name)
  const path = String(entry?.path ?? '').trim()
  const delimiter = String(entry?.delimiter ?? '')
  const separators = [...new Set([delimiter, '/', '\\'].filter(Boolean))]
  let leaf = path
  for (const separator of separators) {
    leaf = leaf.split(separator).filter(Boolean).at(-1) ?? leaf
  }
  return normalizedMailboxName(leaf)
}

function mailboxSpecialUses(entry) {
  const values = [
    ...(Array.isArray(entry?.specialUse) ? entry.specialUse : [entry?.specialUse]),
    ...(entry?.flags instanceof Set ? [...entry.flags] : Array.isArray(entry?.flags) ? entry.flags : []),
  ]
  return new Set(values.map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean))
}

function mailboxRole(entry) {
  if (mailboxSpecialUses(entry).has('\\sent')) return 'sent'
  return SENT_MAILBOX_NAMES.has(mailboxLeaf(entry)) ? 'sent' : 'mail'
}

function isSelectableMailbox(entry) {
  const specialUses = mailboxSpecialUses(entry)
  if (specialUses.has('\\noselect')) return false
  if ([...EXCLUDED_SPECIAL_USE].some((specialUse) => specialUses.has(specialUse))) return false
  if (EXCLUDED_MAILBOX_NAMES.has(mailboxLeaf(entry))) return false
  return Boolean(entry?.path)
}

function relevantMailboxes(entries) {
  const selected = new Map()
  for (const entry of entries ?? []) {
    if (!isSelectableMailbox(entry)) continue
    selected.set(String(entry.path), { path: String(entry.path), specialUse: entry.specialUse, role: mailboxRole(entry) })
  }
  if (![...selected.keys()].some((path) => path.toLowerCase() === 'inbox')) {
    selected.set('INBOX', { path: 'INBOX', specialUse: '\\Inbox', role: 'mail' })
  }
  return [...selected.values()].sort((left, right) => {
    if (left.path.toLowerCase() === 'inbox') return -1
    if (right.path.toLowerCase() === 'inbox') return 1
    if (left.role === 'sent' && right.role !== 'sent') return -1
    if (right.role === 'sent' && left.role !== 'sent') return 1
    return left.path.localeCompare(right.path)
  })
}

function isSkippableMailboxError(error) {
  const value = [
    error?.code,
    error?.responseCode,
    error?.responseStatus,
    error?.responseText,
    error?.message,
  ].filter(Boolean).join(' ')
  return /\b(?:NONEXISTENT|NOPERM|CANNOT|NOT[\s_-]?FOUND|DOES NOT EXIST|PERMISSION DENIED)\b/i.test(value)
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function normalizeUids(values) {
  return [...new Set(values.map(Number))]
    .filter((uid) => Number.isInteger(uid) && uid > 0)
    .sort((left, right) => left - right)
}

function assertBoundedFetchFrames(operation, received, expected) {
  if (received <= expected + MAX_UNSOLICITED_FETCH_FRAMES_PER_COMMAND) return
  operation.close()
  throw new MailFetchError(
    'FETCH_RESPONSE_LIMIT_EXCEEDED',
    'The IMAP server returned too many FETCH responses to process safely.',
  )
}

function boundedUidRange(uidRange) {
  const [rawStart, rawEnd] = String(uidRange).split(':')
  const startUid = Math.max(1, Number(rawStart) || 1)
  const endUid = Math.max(startUid, Number(rawEnd) || startUid)
  return {
    startUid,
    endUid,
    maximumExpected: Math.min(UID_SEARCH_WINDOW_SIZE, endUid - startUid + 1),
  }
}

function addBoundedSearchUid(target, rawValue, range, operation) {
  const text = String(rawValue ?? '')
  if (text.length < 1 || text.length > 10 || !/^\d+$/.test(text)) return
  const uid = Number(text)
  if (!Number.isInteger(uid) || uid < range.startUid || uid > range.endUid) return
  target.add(uid)
  if (target.size > range.maximumExpected) {
    operation.close()
    throw new MailFetchError(
      'SEARCH_RESPONSE_LIMIT_EXCEEDED',
      'The IMAP server exceeded the bounded UID search window.',
    )
  }
}

function addBoundedSequenceSet(target, rawValue, range, operation) {
  const value = String(rawValue ?? '')
  if (Buffer.byteLength(value) > MAX_SEARCH_RESPONSE_BYTES) {
    operation.close()
    throw new MailFetchError(
      'SEARCH_RESPONSE_LIMIT_EXCEEDED',
      'The IMAP server returned an oversized UID search result.',
    )
  }
  let offset = 0
  let segments = 0
  const readUid = () => {
    const start = offset
    while (offset < value.length && value.charCodeAt(offset) >= 48 && value.charCodeAt(offset) <= 57) offset += 1
    if (offset === start || offset - start > 10) return null
    return Number(value.slice(start, offset))
  }
  while (offset < value.length) {
    segments += 1
    if (segments > MAX_SEARCH_RESPONSE_TOKENS) break
    const first = readUid()
    if (!Number.isInteger(first)) break
    let last = first
    if (value[offset] === ':') {
      offset += 1
      last = readUid()
      if (!Number.isInteger(last)) break
    }
    const lower = Math.max(range.startUid, Math.min(first, last))
    const upper = Math.min(range.endUid, Math.max(first, last))
    for (let uid = lower; uid <= upper; uid += 1) addBoundedSearchUid(target, uid, range, operation)
    if (offset === value.length) return
    if (value[offset] !== ',') break
    offset += 1
  }
  operation.close()
  throw new MailFetchError(
    'SEARCH_RESPONSE_LIMIT_EXCEEDED',
    'The IMAP server returned a malformed or excessive UID search result.',
  )
}

function flattenedSearchTokens(attributes, operation) {
  const stack = [attributes]
  const values = []
  let tokens = 0
  let bytes = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index])
      continue
    }
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current.attributes)) stack.push(current.attributes)
    if (current.value === undefined || current.value === null) continue
    const value = String(current.value)
    tokens += 1
    bytes += Buffer.byteLength(value)
    if (tokens > MAX_SEARCH_RESPONSE_TOKENS || bytes > MAX_SEARCH_RESPONSE_BYTES) {
      operation.close()
      throw new MailFetchError(
        'SEARCH_RESPONSE_LIMIT_EXCEEDED',
        'The IMAP server returned too much UID search data.',
      )
    }
    values.push(value)
  }
  return values
}

async function executeBoundedUidSearch(client, query, uidRange, operation) {
  const range = boundedUidRange(uidRange)
  const uids = new Set()
  const useEsearch = Boolean(client.capabilities?.has?.('ESEARCH'))
  const criteria = compileImapSearch(client, { uid: uidRange, ...query })
  const attributes = useEsearch
    ? [{ type: 'ATOM', value: 'RETURN' }, [{ type: 'ATOM', value: 'ALL' }], ...criteria]
    : criteria
  let responseFrames = 0
  const response = await client.exec('UID SEARCH', attributes, {
    untagged: {
      SEARCH: async (untagged) => {
        operation.checkpoint()
        responseFrames += 1
        if (responseFrames > MAX_SEARCH_RESPONSE_FRAMES) {
          operation.close()
          throw new MailFetchError('SEARCH_RESPONSE_LIMIT_EXCEEDED', 'The IMAP server returned too many SEARCH frames.')
        }
        for (const token of flattenedSearchTokens(untagged?.attributes, operation)) {
          addBoundedSearchUid(uids, token, range, operation)
        }
      },
      ESEARCH: async (untagged) => {
        operation.checkpoint()
        responseFrames += 1
        if (responseFrames > MAX_SEARCH_RESPONSE_FRAMES) {
          operation.close()
          throw new MailFetchError('SEARCH_RESPONSE_LIMIT_EXCEEDED', 'The IMAP server returned too many ESEARCH frames.')
        }
        const tokens = flattenedSearchTokens(untagged?.attributes, operation)
        const allIndex = tokens.findIndex((token) => token.toUpperCase() === 'ALL')
        if (allIndex >= 0 && tokens[allIndex + 1]) {
          addBoundedSequenceSet(uids, tokens[allIndex + 1], range, operation)
        }
      },
    },
  })
  operation.checkpoint()
  response.next()
  return normalizeUids([...uids])
}

async function searchCandidateUids(client, mailbox, trackedAddresses, uidRange, operation, minimumDate = null) {
  const matchedUids = new Set()
  const headerUids = new Set()
  // SEARCH SINCE is day-granular and ImapFlow may compile it to WITHIN's
  // second-granular YOUNGER. Expand the server-side prefilter by a full day;
  // the exact original timestamp remains enforced locally.
  const serverSince = minimumDate
    ? new Date(minimumDate.getTime() - (24 * 60 * 60 * 1000))
    : null
  const common = serverSince ? { since: serverSince } : {}

  if (trackedAddresses.length > MAX_TARGETED_SEARCH_ADDRESSES) {
    // A user can legitimately track tens of thousands of professor aliases.
    // Never turn that into thousands of commands per cursor window. Stream the
    // bounded UID window once and let the local Set perform exact matching.
    const allUids = await executeBoundedUidSearch(client, common, uidRange, operation)
    for (const uid of allUids) matchedUids.add(uid)
    const bccUids = await executeBoundedUidSearch(client, {
      ...common,
      header: { bcc: true },
    }, uidRange, operation)
    for (const uid of bccUids) headerUids.add(uid)
    return { matchedUids: normalizeUids([...matchedUids]), headerUids, mailbox }
  }

  for (const addressGroup of chunks(trackedAddresses, SEARCH_ADDRESSES_PER_COMMAND)) {
    const envelopeMatches = await executeBoundedUidSearch(client, {
      ...common,
      or: addressGroup.flatMap((address) => [
        { from: address },
        { to: address },
        { cc: address },
      ]),
    }, uidRange, operation)
    for (const uid of envelopeMatches) matchedUids.add(uid)

    // BCC is commonly absent from the IMAP envelope. Ask the server's header
    // index first and retain a bounded leading header only for those hits.
    const bccMatches = await executeBoundedUidSearch(client, {
      ...common,
      or: addressGroup.map((address) => ({ header: { bcc: address } })),
    }, uidRange, operation)
    for (const uid of bccMatches) {
      matchedUids.add(uid)
      headerUids.add(uid)
    }
  }
  return {
    matchedUids: normalizeUids([...matchedUids]),
    headerUids,
    mailbox,
  }
}

function mergeAddressSources(...sources) {
  return normalizeMailAddressList(sources.flat())
}

async function headerMatchesTrackedMail(rawMessage, mailbox, trackedAddresses, ownerAddresses, minimumDate = null) {
  if (minimumDate) {
    const receivedAt = new Date(rawMessage?.internalDate ?? rawMessage?.envelope?.date ?? 0).getTime()
    if (!Number.isFinite(receivedAt) || receivedAt < minimumDate.getTime()) return false
  }
  let parsedHeaders = null
  const boundedHeaderSource = rawMessage?.headers ?? rawMessage?.source
  if (boundedHeaderSource) {
    try {
      // Sent-folder BCC/alias discovery uses a transport-bounded leading
      // source slice. Never request an unbounded IMAP header literal and then
      // attempt to enforce the limit after ImapFlow has already allocated it.
      const crlfHeaderEnd = boundedHeaderSource.indexOf('\r\n\r\n')
      const lfHeaderEnd = crlfHeaderEnd < 0 ? boundedHeaderSource.indexOf('\n\n') : -1
      const headerEnd = crlfHeaderEnd >= 0 ? crlfHeaderEnd + 4 : lfHeaderEnd + 2
      const completeHeader = headerEnd > 1 && headerEnd <= MAX_INBOUND_HEADER_BYTES
        ? boundedHeaderSource.subarray(0, headerEnd)
        : (boundedHeaderSource.length <= MAX_INBOUND_HEADER_BYTES ? boundedHeaderSource : null)
      if (completeHeader) {
        parsedHeaders = await simpleParser(
          Buffer.concat([completeHeader, Buffer.from('\r\n')]),
          MAIL_PARSER_OPTIONS,
        )
      }
    } catch {
      parsedHeaders = null
    }
  }
  return Boolean(classifyTrackedMailMessage({
    fromAddresses: mergeAddressSources(
      addressObjectValues(parsedHeaders?.from),
      envelopeAddressValues(rawMessage?.envelope?.from),
      envelopeAddressValues(rawMessage?.envelope?.sender),
    ),
    toAddresses: mergeAddressSources(
      addressObjectValues(parsedHeaders?.to),
      envelopeAddressValues(rawMessage?.envelope?.to),
    ),
    ccAddresses: mergeAddressSources(
      addressObjectValues(parsedHeaders?.cc),
      envelopeAddressValues(rawMessage?.envelope?.cc),
    ),
    bccAddresses: mergeAddressSources(
      addressObjectValues(parsedHeaders?.bcc),
      envelopeAddressValues(rawMessage?.envelope?.bcc),
    ),
    folderRole: mailbox.role,
  }, trackedAddresses, ownerAddresses))
}

async function parseFetchedMessage(rawMessage, mailbox, settings, trackedAddresses, ownerAddresses) {
  if (
    !Buffer.isBuffer(rawMessage?.source)
    || rawMessage.source.length > MAX_INBOUND_MESSAGE_SOURCE_BYTES
    || exceedsMimeNodeBudget(rawMessage.source)
  ) return null
  const parsed = await simpleParser(rawMessage.source, MAIL_PARSER_OPTIONS)
  const fromAddresses = mergeAddressSources(
    addressObjectValues(parsed.from),
    envelopeAddressValues(rawMessage.envelope?.from),
    envelopeAddressValues(rawMessage.envelope?.sender),
  )
  const toAddresses = mergeAddressSources(addressObjectValues(parsed.to), envelopeAddressValues(rawMessage.envelope?.to))
  const ccAddresses = mergeAddressSources(addressObjectValues(parsed.cc), envelopeAddressValues(rawMessage.envelope?.cc))
  const bccAddresses = mergeAddressSources(addressObjectValues(parsed.bcc), envelopeAddressValues(rawMessage.envelope?.bcc))
  const replyToAddresses = mergeAddressSources(addressObjectValues(parsed.replyTo), envelopeAddressValues(rawMessage.envelope?.replyTo))
  const attachmentSourceId = sha256(`${mailbox.path}|${rawMessage.uid}`).slice(0, 16)
  const attachmentResult = attachmentMetadata(parsed.attachments, attachmentSourceId)
  const message = {
    uid: Number(rawMessage.uid),
    mailboxPath: mailbox.path,
    folderRole: mailbox.role,
    messageId: parsed.messageId || rawMessage.envelope?.messageId || '',
    emailId: rawMessage.emailId || '',
    fromAddresses,
    toAddresses,
    ccAddresses,
    bccAddresses,
    replyToAddresses,
    subject: parsed.subject || rawMessage.envelope?.subject || '(no subject)',
    date: parsed.date ?? rawMessage.envelope?.date ?? rawMessage.internalDate ?? new Date(),
    internalDate: rawMessage.internalDate ?? null,
    text: boundedTextCopy(
      parsed.text || htmlToPlainText(parsed.html) || '',
      MAX_INBOUND_TEXT_PREVIEW_CHARS,
    ),
    attachments: attachmentResult.attachments,
    omittedAttachmentCount: attachmentResult.omitted,
  }
  const classification = classifyTrackedMailMessage(message, trackedAddresses, ownerAddresses)
  if (!classification) return null
  const threat = analyzeInboundMailThreat(classification.direction === 'incoming'
    ? {
        subject: message.subject,
        text: message.text,
        html: parsed.html,
        headerLines: parsed.headerLines,
        fromAddresses,
        replyToAddresses,
        blockedAttachmentCount: attachmentResult.blocked,
        acceptedAttachmentCount: attachmentResult.attachments.length,
      }
    : {
        blockedAttachmentCount: attachmentResult.blocked,
        acceptedAttachmentCount: attachmentResult.attachments.length,
      })
  if (threat.quarantineAcceptedAttachments) message.attachments = []
  if (threat.level !== 'none') {
    message.mailSecurity = {
      level: threat.level,
      signals: threat.signals,
      linksDisabled: true,
      quarantinedAttachmentCount: threat.quarantinedAttachmentCount,
    }
  }
  return {
    ...message,
    ...classification,
    key: mailMessageKey(message),
    accountKey: mailAccountKey(settings),
  }
}

function canonicalImapUidValidity(value) {
  if (typeof value === 'bigint') {
    return value >= 1n && value <= 4_294_967_295n ? value.toString() : null
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= MAX_IMAP_UID
      ? String(value)
      : null
  }
  const text = String(value ?? '')
  // RFC 3501 UIDVALIDITY is an unsigned non-zero 32-bit nz-number. Check the
  // tiny lexical bound before parsing so one hostile server value can never be
  // retained once per mailbox in the continuation map.
  if (text.length < 1 || text.length > 10 || !/^[1-9]\d*$/.test(text)) return null
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_IMAP_UID
    ? String(parsed)
    : null
}

function requireImapUidValidity(value) {
  const normalized = canonicalImapUidValidity(value)
  if (normalized) return normalized
  throw new MailFetchError(
    'CONNECTION_FAILED',
    'The IMAP server returned an invalid UIDVALIDITY value.',
  )
}

function requireImapUidNext(value) {
  const normalized = canonicalImapUidValidity(value)
  if (normalized) return Number(normalized)
  throw new MailFetchError(
    'CONNECTION_FAILED',
    'The IMAP server returned an invalid UIDNEXT value.',
  )
}

function normalizeFolderStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null)
  const result = Object.create(null)
  for (const [path, state] of Object.entries(value).slice(0, 256)) {
    if (!state || typeof state !== 'object') continue
    const lastUid = Number(state.lastUid ?? 0)
    result[path] = {
      uidValidity: canonicalImapUidValidity(state.uidValidity),
      lastUid: Number.isInteger(lastUid) && lastUid > 0
        ? Math.min(lastUid, MAX_IMAP_UID)
        : 0,
    }
  }
  return result
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

/**
 * Discovers every selectable IMAP folder except Trash/Junk/Drafts, finds professor-related
 * candidates (including header-scanning Sent mail for BCC/alias cases), and returns per-folder
 * UID cursors for the caller to persist only after application data commits successfully.
 */
export async function fetchImapMessages(settings, fetchState, options = {}) {
  const host = String(settings?.incomingHost ?? '').trim()
  const user = String(settings?.incomingUser ?? '').trim()
  if (!host || !user) {
    throw new MailFetchError('NOT_CONFIGURED', 'Incoming mail is not configured.')
  }
  if (settings?.incomingProtocol !== 'imap') {
    throw new MailFetchError('UNSUPPORTED_PROTOCOL', 'Automatic and historical mail sync require IMAP.')
  }

  const mode = ['baseline', 'history'].includes(options.mode) ? options.mode : 'incremental'
  const trackedAddresses = normalizeMailAddressList(options.trackedAddresses)
  const ownerAddresses = normalizeMailAddressList(options.ownerAddresses)
  const accountKey = mailAccountKey(settings)
  const sameAccount = fetchState?.accountKey === accountKey
  const previousFolderStates = sameAccount ? normalizeFolderStates(fetchState?.folderStates) : {}
  const resumeFolderStates = normalizeFolderStates(options.resumeFolderStates)
  const activeFolderStates = Object.assign(
    Object.create(null),
    mode === 'history' ? {} : previousFolderStates,
    resumeFolderStates,
  )
  const hasExistingFolderState = Object.keys(previousFolderStates).length > 0
  const initialSinceDate = options.initialSince ? new Date(options.initialSince) : null
  const initialSince = initialSinceDate && !Number.isNaN(initialSinceDate.getTime()) ? initialSinceDate : null

  const setup = await createImapClientWithinDeadline(settings, {
    signal: options.signal,
    timeoutMs: options.operationTimeoutMs,
    resolveNetworkTarget: options.resolveNetworkTarget,
  })
  const client = setup.client
  const operation = createImapOperationGuard(client, {
    signal: options.signal,
    timeoutMs: setup.timeoutMs,
    deadlineAt: setup.deadlineAt,
  })

  try {
    operation.checkpoint()
    await client.connect()
    operation.checkpoint()
  } catch (error) {
    operation.dispose()
    operation.checkpoint()
    throw classifyImapError(error)
  }

  const messages = []
  // Preserve the cursors of folders not reached before a bounded batch stops.
  // Without this merge an incremental batch could reset another folder and
  // replay its whole mailbox on the next poll.
  const folderStates = Object.assign(Object.create(null), activeFolderStates)
  const maxMessages = boundedPositiveInteger(
    options.maxMessages,
    MAX_MAIL_FETCH_BATCH_MESSAGES,
    MAX_MAIL_FETCH_BATCH_MESSAGES,
  )
  const maxRetainedSourceBytes = boundedPositiveInteger(
    options.maxRetainedSourceBytes,
    MAX_MAIL_FETCH_BATCH_SOURCE_BYTES,
    MAX_MAIL_FETCH_BATCH_SOURCE_BYTES,
  )
  const maxScannedUids = boundedPositiveInteger(
    options.maxScannedUids,
    MAX_MAIL_FETCH_BATCH_SCANNED_UIDS,
    MAX_MAIL_FETCH_BATCH_SCANNED_UIDS,
  )
  let retainedSourceBytes = 0
  let downloadedSourceBytes = 0
  let scannedUids = 0
  let skippedOversized = 0
  let retainedAttachmentCount = 0
  let hasMore = false
  try {
    operation.checkpoint()
    const mailboxes = relevantMailboxes(await listMailboxesBounded(client, operation))
    const currentMailboxPaths = new Set(mailboxes.map((mailbox) => mailbox.path))
    // A mailbox rename/delete must retire its cursor before a bounded batch is
    // persisted. Otherwise 256 stale keys can occupy storage's entire state
    // allowance and repeatedly evict every newly discovered folder cursor.
    for (const path of Object.keys(activeFolderStates)) {
      if (!currentMailboxPaths.has(path)) delete activeFolderStates[path]
    }
    for (const path of Object.keys(folderStates)) {
      if (!currentMailboxPaths.has(path)) delete folderStates[path]
    }
    operation.checkpoint()
    mailboxLoop: for (const mailbox of mailboxes) {
      let lock = null
      try {
        operation.checkpoint()
        lock = await client.getMailboxLock(mailbox.path)
        operation.checkpoint()
        const uidValidity = requireImapUidValidity(client.mailbox.uidValidity)
        const previous = activeFolderStates[mailbox.path]
        const persistedPrevious = previousFolderStates[mailbox.path]
        const uidValidityChanged = Boolean(previous?.uidValidity) && previous.uidValidity !== uidValidity
        const currentMaxUid = requireImapUidNext(client.mailbox.uidNext) - 1
        const safeMaxUid = !uidValidityChanged && previous
          ? Math.max(currentMaxUid, Number(previous.lastUid ?? 0))
          : currentMaxUid
        let startUid = null
        if (mode === 'history') {
          startUid = previous && !uidValidityChanged
            ? Number(previous.lastUid ?? 0) + 1
            : 1
        } else if (mode === 'incremental') {
          if (previous && !uidValidityChanged) {
            startUid = Number(previous.lastUid ?? 0) + 1
          } else if (previous && uidValidityChanged) {
            startUid = 1
          } else if (hasExistingFolderState) {
            // A newly discovered folder may contain a message moved there between polls.
            startUid = 1
          } else if (initialSince) {
            // First automatic run: include every message that arrived after the user enabled sync.
            startUid = 1
          }
        }

        // A bounded continuation uses transient resume cursors, but whether it
        // is the first automatic sync is decided only by the durable state
        // that existed before the run. This prevents later folders in the
        // first sync from accidentally backfilling pre-enablement mail.
        const firstRunWindow = mode === 'incremental'
          && !persistedPrevious
          && !hasExistingFolderState
          ? initialSince
          : null
        if (startUid !== null && startUid <= currentMaxUid && trackedAddresses.length > 0) {
          for (
            let windowStartUid = startUid;
            windowStartUid <= currentMaxUid;
            windowStartUid += UID_SEARCH_WINDOW_SIZE
          ) {
            operation.checkpoint()
            const windowEndUid = Math.min(
              currentMaxUid,
              windowStartUid + UID_SEARCH_WINDOW_SIZE - 1,
            )
            const candidateSearch = await searchCandidateUids(
              client,
              mailbox,
              trackedAddresses,
              `${windowStartUid}:${windowEndUid}`,
              operation,
              firstRunWindow,
            )
            operation.checkpoint()
            for (const uidChunk of chunks(candidateSearch.matchedUids, FETCH_UID_CHUNK_SIZE)) {
              operation.checkpoint()
              const exactUids = new Set()
              const declaredSizesByUid = new Map()
              const requestedEnvelopeUids = new Set(uidChunk)
              let receivedEnvelopeFrames = 0
              for await (const envelopeMessage of client.fetch(
                uidChunk,
                {
                  uid: true,
                  envelope: true,
                  internalDate: true,
                  size: true,
                },
                { uid: true },
              )) {
                operation.checkpoint()
                receivedEnvelopeFrames += 1
                assertBoundedFetchFrames(
                  operation,
                  receivedEnvelopeFrames,
                  requestedEnvelopeUids.size,
                )
                if (!requestedEnvelopeUids.has(Number(envelopeMessage.uid))) {
                  // Servers may legally send unsolicited FETCH flag updates
                  // while another FETCH command is active. They are not part
                  // of this bounded scan and must neither fail it nor advance
                  // its continuation cursor.
                  continue
                }
                const declaredSize = Number(envelopeMessage.size ?? 0)
                if (Number.isFinite(declaredSize) && declaredSize > MAX_INBOUND_MESSAGE_SOURCE_BYTES) {
                  skippedOversized += 1
                  continue
                }
                if (Number.isFinite(declaredSize) && declaredSize >= 0) {
                  declaredSizesByUid.set(Number(envelopeMessage.uid), declaredSize)
                }
                if (firstRunWindow) {
                  const receivedAt = new Date(
                    envelopeMessage?.internalDate ?? envelopeMessage?.envelope?.date ?? 0,
                  ).getTime()
                  if (!Number.isFinite(receivedAt) || receivedAt < firstRunWindow.getTime()) continue
                }
                if (candidateSearch.headerUids.has(Number(envelopeMessage.uid))) {
                  // The server already matched the BCC header. Do not use a
                  // 256 KiB prefix as a negative gate: long Received/DKIM chains
                  // can place a real BCC later. The bounded full-source parser
                  // performs the final exact address classification.
                  exactUids.add(Number(envelopeMessage.uid))
                  continue
                }
                if (await headerMatchesTrackedMail(
                  envelopeMessage,
                  mailbox,
                  trackedAddresses,
                  ownerAddresses,
                  firstRunWindow,
                )) {
                  exactUids.add(Number(envelopeMessage.uid))
                }
              }
              // RFC 2683 explicitly forbids assuming any FETCH response order.
              // Parse one normalized UID at a time so a batch cursor can never
              // jump past a lower matching UID that the server yielded later.
              for (const exactUid of normalizeUids([...exactUids])) {
                operation.checkpoint()
                const declaredSize = declaredSizesByUid.get(exactUid)
                if (Number.isFinite(declaredSize) && declaredSize > maxRetainedSourceBytes) {
                  skippedOversized += 1
                  continue
                }
                if (
                  downloadedSourceBytes > 0
                  && Number.isFinite(declaredSize)
                  && downloadedSourceBytes + declaredSize > maxRetainedSourceBytes
                ) {
                  folderStates[mailbox.path] = { uidValidity, lastUid: Math.max(0, exactUid - 1) }
                  hasMore = true
                  break mailboxLoop
                }
                let receivedRawFrames = 0
                for await (const rawMessage of client.fetch(
                  exactUid,
                  {
                    uid: true,
                    envelope: true,
                    internalDate: true,
                    source: { maxLength: MAX_INBOUND_MESSAGE_SOURCE_BYTES + 1 },
                  },
                  { uid: true },
                )) {
                  operation.checkpoint()
                  receivedRawFrames += 1
                  assertBoundedFetchFrames(operation, receivedRawFrames, 1)
                  if (Number(rawMessage.uid) !== exactUid) {
                    // Ignore legal unsolicited FETCH updates; only the exact
                    // requested UID may contribute data or cursor progress.
                    continue
                  }
                  const sourceBytes = Number(rawMessage?.source?.length ?? 0)
                  if (sourceBytes > MAX_INBOUND_MESSAGE_SOURCE_BYTES) {
                    skippedOversized += 1
                    continue
                  }
                  if (
                    downloadedSourceBytes > 0
                    && downloadedSourceBytes + sourceBytes > maxRetainedSourceBytes
                  ) {
                    folderStates[mailbox.path] = { uidValidity, lastUid: Math.max(0, exactUid - 1) }
                    hasMore = true
                    break mailboxLoop
                  }
                  downloadedSourceBytes += sourceBytes
                  if (sourceBytes > maxRetainedSourceBytes) {
                    // A caller may choose a batch budget below the global
                    // single-message ceiling. Skip explicitly instead of
                    // parsing beyond that declared budget or retrying forever.
                    skippedOversized += 1
                    continue
                  }
                  if (
                    messages.length > 0
                    && retainedSourceBytes + sourceBytes > maxRetainedSourceBytes
                  ) {
                    folderStates[mailbox.path] = {
                      uidValidity,
                      lastUid: Math.max(0, Number(rawMessage.uid) - 1),
                    }
                    hasMore = true
                    break mailboxLoop
                  }
                  let message = null
                  try {
                    message = await parseFetchedMessage(
                      rawMessage,
                      mailbox,
                      settings,
                      trackedAddresses,
                      ownerAddresses,
                    )
                  } catch {
                    // One malformed or parser-hostile message must not stop the
                    // remaining folders or create an automatic retry loop.
                    message = null
                  }
                  operation.checkpoint()
                  if (message) {
                    const remainingAttachments = Math.max(
                      0,
                      MAX_MAIL_FETCH_BATCH_ATTACHMENTS - retainedAttachmentCount,
                    )
                    if ((message.attachments?.length ?? 0) > remainingAttachments) {
                      const omitted = message.attachments.length - remainingAttachments
                      for (const attachment of message.attachments.slice(remainingAttachments)) {
                        delete attachment.content
                      }
                      message.attachments = message.attachments.slice(0, remainingAttachments)
                      message.omittedAttachmentCount = Number(message.omittedAttachmentCount ?? 0) + omitted
                    }
                    retainedAttachmentCount += message.attachments?.length ?? 0
                    messages.push(message)
                    retainedSourceBytes += sourceBytes
                    if (
                      messages.length >= maxMessages
                      || retainedSourceBytes >= maxRetainedSourceBytes
                    ) {
                      folderStates[mailbox.path] = {
                        uidValidity,
                        lastUid: Number(rawMessage.uid),
                      }
                      hasMore = true
                      break mailboxLoop
                    }
                  }
                }
              }
            }
            folderStates[mailbox.path] = { uidValidity, lastUid: windowEndUid }
            scannedUids += windowEndUid - windowStartUid + 1
            if (
              scannedUids >= maxScannedUids
              || (windowEndUid < currentMaxUid && operation.shouldYield())
            ) {
              hasMore = true
              break mailboxLoop
            }
          }
        }

        folderStates[mailbox.path] = { uidValidity, lastUid: safeMaxUid }
      } catch (error) {
        if (!isSkippableMailboxError(error)) throw error
      } finally {
        lock?.release()
      }
    }
  } catch (error) {
    operation.checkpoint()
    if (error instanceof MailFetchError) throw error
    throw classifyImapError(error)
  } finally {
    try {
      await client.logout().catch(() => {})
    } finally {
      // LOGOUT is network work as well. Retain abort/deadline ownership until
      // it settles, then force-close the dedicated sync connection so cleanup
      // can never leave a socket owner behind.
      operation.close()
      operation.dispose()
    }
  }
  operation.checkpoint()

  return {
    messages,
    accountKey,
    folderStates,
    mode,
    hasMore,
    retainedSourceBytes,
    scannedUids,
    skippedOversized,
  }
}

/** Backward-compatible wrapper retained for existing integrations. */
export async function fetchNewImapMessages(settings, fetchState, options = {}) {
  const result = await fetchImapMessages(settings, fetchState, { ...options, mode: 'incremental' })
  const inboxState = result.folderStates.INBOX
    ?? Object.entries(result.folderStates).find(([path]) => path.toLowerCase() === 'inbox')?.[1]
    ?? { uidValidity: null, lastUid: 0 }
  return {
    messages: result.messages,
    uidValidity: inboxState.uidValidity,
    lastUid: inboxState.lastUid,
    accountKey: result.accountKey,
    folderStates: result.folderStates,
  }
}

function displayAddressList(value) {
  return normalizeMailAddressList(value).join(', ')
}

/** Converts a fetched message into the shape CommunicationCreateSchema expects. */
export function messageToCommunicationInput(message) {
  const parsedDate = message.date instanceof Date ? message.date : new Date(message.date)
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
  const text = String(message.text ?? '').slice(0, 20_000) || '(no content)'
  return {
    subject: message.subject || '(no subject)',
    channel: 'Email',
    date: safeDate.toISOString().slice(0, 10),
    time: safeDate.toISOString().slice(11, 16),
    // Guards against a pathologically large message ballooning storage; downstream summary fields are plain text everywhere.
    summary: text,
    direction: message.direction === 'outgoing' ? 'outgoing' : 'incoming',
    messageType: 'fetched-email',
    from: displayAddressList(message.fromAddresses ?? message.from),
    to: displayAddressList([
      ...normalizeMailAddressList(message.toAddresses ?? message.to),
      ...normalizeMailAddressList(message.ccAddresses ?? message.cc),
      ...normalizeMailAddressList(message.bccAddresses ?? message.bcc),
    ]),
    attachments: (message.attachments ?? []).map(({ content: _content, ...attachment }) => attachment),
    ...(Number(message.omittedAttachmentCount) > 0
      ? { omittedAttachmentCount: Math.min(10_000, Math.floor(Number(message.omittedAttachmentCount))) }
      : {}),
    ...(message.mailSecurity ? { mailSecurity: message.mailSecurity } : {}),
  }
}

export const mailFetchSecurity = {
  detectPhishingHtml: detectDeceptiveMailLinks,
  hasBlockedAttachmentExtension: hasDangerousInboundAttachmentName,
  hasVirusTestMarker: hasInboundVirusTestMarker,
  attachmentMetadata,
  isSkippableMailboxError,
}
