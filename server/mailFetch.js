import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

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

/** Very small tag-stripper — good enough for a plain-text communication summary field, not a rendering pipeline. */
function htmlToPlainText(html) {
  if (!html) return ''
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  '.bat', '.cmd', '.com', '.dll', '.exe', '.msi', '.ps1', '.scr', '.sh',
])
const VIRUS_TEST_MARKER = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'
const EXCLUDED_SPECIAL_USE = new Set(['\\Trash', '\\Junk', '\\Drafts'])
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
])
const SEARCH_ADDRESS_CHUNK_SIZE = 12
const FETCH_UID_CHUNK_SIZE = 40
const searchFallbackClients = new WeakSet()

function createImapClient(settings) {
  return new ImapFlow({
    host: String(settings?.incomingHost ?? '').trim(),
    port: Number(settings?.incomingPort ?? 993),
    secure: Boolean(settings?.incomingTls ?? true),
    auth: {
      user: String(settings?.incomingUser ?? '').trim(),
      pass: settings?.incomingPass ?? '',
    },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  })
}

/**
 * Verifies the same authenticated IMAP session used by sync. A raw TLS socket
 * check can succeed even when the saved credentials or mailbox access fail.
 */
export async function verifyImapConnection(settings) {
  const host = String(settings?.incomingHost ?? '').trim()
  const user = String(settings?.incomingUser ?? '').trim()
  if (!host || !user) {
    throw new MailFetchError('NOT_CONFIGURED', 'Incoming mail is not configured.')
  }
  if (settings?.incomingProtocol !== 'imap') {
    throw new MailFetchError('UNSUPPORTED_PROTOCOL', 'This connection check requires IMAP.')
  }

  const client = createImapClient(settings)
  try {
    await client.connect()
    await client.list()
  } catch (error) {
    throw classifyImapError(error)
  } finally {
    await client.logout().catch(() => {})
  }
}

function localizedSecurityWarning(kind, language = 'en') {
  const zh = String(language).toLowerCase().startsWith('zh')
  if (kind === 'phishing-link') {
    return zh
      ? '安全提醒：这封邮件包含显示文字与目标地址不一致的链接。'
      : 'Security warning: this email contains a link whose displayed text does not match its destination.'
  }
  if (kind === 'unsafe-attachment') {
    return zh
      ? '安全提醒：一个或多个附件因文件类型或安全测试病毒标记被拦截，未作为普通附件导入。'
      : 'Security warning: one or more attachments were blocked because the file type or antivirus test marker is risky.'
  }
  return zh ? '安全提醒：这封邮件包含可疑内容。' : 'Security warning: this email contains suspicious content.'
}

function normalizeHostname(value) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

function textUrlHost(value) {
  const match = String(value ?? '').match(/https?:\/\/[^\s<>"')]+/i)
  return match ? normalizeHostname(match[0]) : ''
}

function detectPhishingHtml(html) {
  if (!html) return false
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of String(html).matchAll(anchorPattern)) {
    const hrefHost = normalizeHostname(match[2])
    const textHost = textUrlHost(htmlToPlainText(match[3]))
    if (hrefHost && textHost && hrefHost !== textHost) return true
  }
  return false
}

function sanitizeAttachmentName(value, fallback) {
  const name = String(value ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
  return name.slice(0, 255) || fallback
}

function hasBlockedAttachmentExtension(filename) {
  const parts = sanitizeAttachmentName(filename, '').toLowerCase().split('.')
  for (let index = 1; index < parts.length; index += 1) {
    if (BLOCKED_ATTACHMENT_EXTENSIONS.has(`.${parts.slice(index).join('.')}`)) return true
  }
  return false
}

function hasVirusTestMarker(content) {
  if (!content) return false
  return Buffer.isBuffer(content)
    ? content.toString('latin1').includes(VIRUS_TEST_MARKER)
    : String(content).includes(VIRUS_TEST_MARKER)
}

function attachmentMetadata(parsedAttachments = [], sourceId) {
  const attachments = []
  let blocked = 0
  for (const [index, attachment] of parsedAttachments.entries()) {
    const fileName = sanitizeAttachmentName(attachment.filename, `attachment-${index + 1}`)
    if (hasBlockedAttachmentExtension(fileName) || hasVirusTestMarker(attachment.content)) {
      blocked += 1
      continue
    }
    attachments.push({
      id: `mail-${sourceId}-${index + 1}`,
      fileName,
      fileSize: Number(attachment.size ?? attachment.content?.length ?? 0),
      mimeType: attachment.contentType || 'application/octet-stream',
      source: 'mail',
    })
  }
  return { attachments, blocked }
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
  const path = String(entry?.path ?? '').trim().toLowerCase().replaceAll('\\', '/')
  return path.split('/').filter(Boolean).at(-1) ?? ''
}

function mailboxRole(entry) {
  if (entry?.specialUse === '\\Sent') return 'sent'
  const leaf = mailboxLeaf(entry)
  return [
    'sent',
    'sent mail',
    'sent items',
    'sent messages',
    '已发送',
    '已发邮件',
    '已发送邮件',
    '寄件备份',
  ].includes(leaf) ? 'sent' : 'mail'
}

function isSelectableMailbox(entry) {
  const flags = entry?.flags instanceof Set ? entry.flags : new Set(entry?.flags ?? [])
  if (flags.has('\\Noselect')) return false
  if (EXCLUDED_SPECIAL_USE.has(entry?.specialUse)) return false
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

async function fetchUidsInRange(client, uidRange) {
  const uids = []
  for await (const message of client.fetch(uidRange, { uid: true }, { uid: true })) {
    uids.push(message.uid)
  }
  return normalizeUids(uids)
}

async function searchOrFetchUids(client, query, uidRange) {
  if (searchFallbackClients.has(client)) return fetchUidsInRange(client, uidRange)
  const found = await client.search(query, { uid: true })
  if (Array.isArray(found)) return normalizeUids(found)

  // Some enterprise IMAP servers advertise SEARCH but reject address criteria
  // with BAD and ImapFlow reports that command-level failure as `false`. Avoid
  // repeating the rejected command until the server drops the connection. The
  // fallback downloads only UIDs and headers; bodies are still fetched solely
  // after the exact professor-address check below succeeds.
  searchFallbackClients.add(client)
  return fetchUidsInRange(client, uidRange)
}

async function searchCandidateUids(client, mailbox, trackedAddresses, uidRange) {
  if (mailbox.role === 'sent') {
    return searchOrFetchUids(client, { uid: uidRange }, uidRange)
  }
  return searchTrackedUids(client, trackedAddresses, uidRange)
}

async function searchTrackedUids(client, trackedAddresses, uidRange) {
  const addresses = normalizeMailAddressList(trackedAddresses)
  if (addresses.length === 0) return []
  const uids = new Set()
  for (const addressChunk of chunks(addresses, SEARCH_ADDRESS_CHUNK_SIZE)) {
    const alternatives = addressChunk.flatMap((address) => [
      { from: address },
      { to: address },
      { cc: address },
      { bcc: address },
    ])
    const found = await searchOrFetchUids(client, { uid: uidRange, or: alternatives }, uidRange)
    if (searchFallbackClients.has(client)) return found
    found.forEach((uid) => uids.add(uid))
  }
  return normalizeUids([...uids])
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
  if (rawMessage?.headers) {
    try {
      parsedHeaders = await simpleParser(Buffer.concat([rawMessage.headers, Buffer.from('\r\n')]))
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
  if (!rawMessage?.source) return null
  const parsed = await simpleParser(rawMessage.source)
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
  const securityWarnings = []
  if (detectPhishingHtml(parsed.html)) securityWarnings.push('phishing-link')
  if (attachmentResult.blocked > 0) securityWarnings.push('unsafe-attachment')
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
    text: parsed.text || htmlToPlainText(parsed.html) || '',
    attachments: attachmentResult.attachments,
    securityWarnings,
  }
  const classification = classifyTrackedMailMessage(message, trackedAddresses, ownerAddresses)
  if (!classification) return null
  return {
    ...message,
    ...classification,
    key: mailMessageKey(message),
    accountKey: mailAccountKey(settings),
  }
}

function normalizeFolderStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [path, state] of Object.entries(value)) {
    if (!state || typeof state !== 'object') continue
    result[path] = {
      uidValidity: state.uidValidity ? String(state.uidValidity) : null,
      lastUid: Math.max(0, Number(state.lastUid ?? 0)),
    }
  }
  return result
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
  const hasExistingFolderState = Object.keys(previousFolderStates).length > 0
  const initialSinceDate = options.initialSince ? new Date(options.initialSince) : null
  const initialSince = initialSinceDate && !Number.isNaN(initialSinceDate.getTime()) ? initialSinceDate : null

  const client = createImapClient(settings)

  try {
    await client.connect()
  } catch (error) {
    throw classifyImapError(error)
  }

  const messages = []
  const folderStates = {}
  try {
    const mailboxes = relevantMailboxes(await client.list({ statusQuery: { messages: true, uidNext: true, uidValidity: true } }))
    for (const mailbox of mailboxes) {
      const lock = await client.getMailboxLock(mailbox.path)
      try {
        const uidValidity = String(client.mailbox.uidValidity)
        const previous = previousFolderStates[mailbox.path]
        const uidValidityChanged = Boolean(previous?.uidValidity) && previous.uidValidity !== uidValidity
        const currentMaxUid = Math.max(0, Number(client.mailbox.uidNext ?? 1) - 1)
        const safeMaxUid = !uidValidityChanged && previous
          ? Math.max(currentMaxUid, Number(previous.lastUid ?? 0))
          : currentMaxUid
        let startUid = null
        if (mode === 'history') {
          startUid = 1
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

        const firstRunWindow = mode === 'incremental' && !previous && !hasExistingFolderState ? initialSince : null
        if (startUid !== null && startUid <= currentMaxUid && trackedAddresses.length > 0) {
          const matchedUids = await searchCandidateUids(
            client,
            mailbox,
            trackedAddresses,
            `${startUid}:${currentMaxUid}`,
          )
          for (const uidChunk of chunks(matchedUids, FETCH_UID_CHUNK_SIZE)) {
            const exactUids = []
            for await (const envelopeMessage of client.fetch(
              uidChunk,
              {
                uid: true,
                envelope: true,
                internalDate: true,
                headers: ['from', 'sender', 'to', 'cc', 'bcc', 'reply-to', 'message-id', 'subject', 'date'],
              },
              { uid: true },
            )) {
              if (await headerMatchesTrackedMail(
                envelopeMessage,
                mailbox,
                trackedAddresses,
                ownerAddresses,
                firstRunWindow,
              )) {
                exactUids.push(envelopeMessage.uid)
              }
            }
            for (const exactUidChunk of chunks(exactUids, FETCH_UID_CHUNK_SIZE)) {
              for await (const rawMessage of client.fetch(
                exactUidChunk,
                { uid: true, envelope: true, internalDate: true, source: true },
                { uid: true },
              )) {
                const message = await parseFetchedMessage(
                  rawMessage,
                  mailbox,
                  settings,
                  trackedAddresses,
                  ownerAddresses,
                )
                if (message) messages.push(message)
              }
            }
          }
        }

        folderStates[mailbox.path] = { uidValidity, lastUid: safeMaxUid }
      } finally {
        lock.release()
      }
    }
  } catch (error) {
    if (error instanceof MailFetchError) throw error
    throw classifyImapError(error)
  } finally {
    await client.logout().catch(() => {})
  }

  return {
    messages,
    accountKey,
    folderStates,
    mode,
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
export function messageToCommunicationInput(message, language = 'en') {
  const parsedDate = message.date instanceof Date ? message.date : new Date(message.date)
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
  const warnings = Array.from(new Set(message.securityWarnings ?? []))
    .map((kind) => localizedSecurityWarning(kind, language))
  const text = String(message.text ?? '').slice(0, 20_000) || '(no content)'
  return {
    subject: message.subject || '(no subject)',
    channel: 'Email',
    date: safeDate.toISOString().slice(0, 10),
    time: safeDate.toISOString().slice(11, 16),
    // Guards against a pathologically large message ballooning storage; downstream summary fields are plain text everywhere.
    summary: [...warnings, text].join('\n\n'),
    direction: message.direction === 'outgoing' ? 'outgoing' : 'incoming',
    messageType: 'fetched-email',
    from: displayAddressList(message.fromAddresses ?? message.from),
    to: displayAddressList([
      ...normalizeMailAddressList(message.toAddresses ?? message.to),
      ...normalizeMailAddressList(message.ccAddresses ?? message.cc),
      ...normalizeMailAddressList(message.bccAddresses ?? message.bcc),
    ]),
    attachments: message.attachments ?? [],
  }
}

export const mailFetchSecurity = {
  detectPhishingHtml,
  hasBlockedAttachmentExtension,
  hasVirusTestMarker,
  attachmentMetadata,
}
