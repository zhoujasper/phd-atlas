import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeImap = vi.hoisted(() => ({
  calls: [],
  folders: {},
  list: [],
  searchSupported: true,
  capabilities: new Set(),
  deniedFolders: new Set(),
  reverseFetchResponses: false,
  injectUnsolicitedFetch: false,
  duplicateEnvelopeFrames: 0,
  clientOptions: null,
  hangOnConnect: false,
  pendingConnectReject: null,
  closeCalls: 0,
  listRowsYielded: 0,
  searchDelayMs: 0,
  esearchAttributes: null,
  emitErrorOnConnect: null,
  emitErrorOnLogout: null,
}))
const parserMetrics = vi.hoisted(() => ({
  inputLengths: [],
  options: [],
  htmlUsesDataUrl: [],
  htmlUsesCid: [],
  blockMs: 0,
}))

vi.mock('mailparser', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    simpleParser: async (input, ...args) => {
      parserMetrics.inputLengths.push(Number(input?.length ?? 0))
      parserMetrics.options.push(args[0] ?? {})
      if (parserMetrics.blockMs > 0) {
        const blockUntil = performance.now() + parserMetrics.blockMs
        parserMetrics.blockMs = 0
        while (performance.now() < blockUntil) {
          // Model a synchronous parser/decoder stall. The production guard's
          // monotonic checkpoint must notice the elapsed deadline even though
          // the AbortSignal timeout callback could not run during this loop.
        }
      }
      const parsed = await actual.simpleParser(input, ...args)
      parserMetrics.htmlUsesDataUrl.push(String(parsed?.html ?? '').includes('data:'))
      parserMetrics.htmlUsesCid.push(String(parsed?.html ?? '').includes('cid:'))
      return parsed
    },
  }
})

vi.mock('imapflow', () => ({
  ImapFlow: class FakeImapFlow {
    constructor(options) {
      this.mailbox = null
      this.currentPath = null
      this.capabilities = new Set(fakeImap.capabilities)
      this.enabled = new Set()
      this.namespace = false
      this.listeners = new Map()
      fakeImap.clientOptions = options
    }

    on(event, listener) {
      const listeners = this.listeners.get(event) ?? []
      listeners.push(listener)
      this.listeners.set(event, listeners)
      return this
    }

    emit(event, value) {
      for (const listener of this.listeners.get(event) ?? []) listener(value)
    }

    async connect() {
      if (fakeImap.emitErrorOnConnect) {
        this.emit('error', fakeImap.emitErrorOnConnect)
        return
      }
      if (!fakeImap.hangOnConnect) return
      await new Promise((_, reject) => {
        fakeImap.pendingConnectReject = reject
      })
    }

    close() {
      fakeImap.closeCalls += 1
      fakeImap.pendingConnectReject?.(new Error('connection closed'))
      fakeImap.pendingConnectReject = null
    }

    async logout() {
      if (fakeImap.emitErrorOnLogout) this.emit('error', fakeImap.emitErrorOnLogout)
    }

    async exec(command, attributes, options = {}) {
      if (command === 'UID SEARCH') {
        if (!fakeImap.searchSupported) throw new Error('SEARCH unavailable')
        if (fakeImap.searchDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, fakeImap.searchDelayMs))
        }
        const flattened = []
        const pending = [attributes]
        while (pending.length > 0) {
          const value = pending.pop()
          if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index])
          } else if (value?.value !== undefined) {
            flattened.push(String(value.value))
          }
        }
        const upper = flattened.map((value) => value.toUpperCase())
        const uidIndex = upper.indexOf('UID')
        const [rawStart = '1', rawEnd = String(Number.MAX_SAFE_INTEGER)] = String(flattened[uidIndex + 1] ?? '1:*').split(':')
        const minUid = Number(rawStart || 1)
        const maxUid = rawEnd === '*' ? Number.MAX_SAFE_INTEGER : Number(rawEnd)
        const sinceIndex = upper.indexOf('SINCE')
        const since = sinceIndex >= 0 ? new Date(flattened[sinceIndex + 1]) : null
        const addressCriteria = []
        for (let index = 0; index < upper.length; index += 1) {
          if (upper[index] === 'HEADER' && upper[index + 1] === 'BCC') {
            addressCriteria.push(['bcc', String(flattened[index + 2] ?? '').toLowerCase(), true])
          } else if (['FROM', 'TO', 'CC', 'BCC'].includes(upper[index])) {
            addressCriteria.push([upper[index].toLowerCase(), String(flattened[index + 1] ?? '').toLowerCase()])
          }
        }
        const folder = fakeImap.folders[this.currentPath] ?? { messages: [] }
        const matches = folder.messages
          .filter((message) => message.uid >= minUid && message.uid <= maxUid)
          .filter((message) => !since || new Date(message.internalDate).getTime() >= since.getTime())
          .filter((message) => addressCriteria.length === 0 || addressCriteria.some(([field, address, rawHeader]) => (
            (message.search?.[field] ?? []).some((entry) => String(entry.address).toLowerCase() === address)
            || (rawHeader && new RegExp(`^bcc:.*${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'im').test(String(message.source)))
          )))
          .map((message) => message.uid)
        fakeImap.calls.push({ type: 'uid-search', path: this.currentPath, attributes, matches })
        if (this.capabilities.has('ESEARCH')) {
          await options.untagged?.ESEARCH?.({
            attributes: fakeImap.esearchAttributes ?? [
              [{ value: 'TAG' }, { value: 'A1' }],
              { value: 'UID' },
              { value: 'ALL' },
              { value: matches.join(',') },
            ],
          })
        } else if (matches.length > 0) {
          await options.untagged?.SEARCH?.({
            attributes: matches.map((value) => ({ value: String(value) })),
          })
        }
        return { next() {} }
      }
      if (!['LIST', 'XLIST'].includes(command)) throw new Error(`Unexpected IMAP command: ${command}`)
      const callback = options.untagged?.[command]
      for (const entry of fakeImap.list) {
        fakeImap.listRowsYielded += 1
        const flags = new Set(entry.flags ?? [])
        if (entry.specialUse) flags.add(entry.specialUse)
        await callback?.({
          attributes: [
            [...flags].map((value) => ({ value })),
            { value: entry.delimiter ?? '/' },
            { value: entry.path },
          ],
        })
      }
      return { next() {} }
    }

    async getMailboxLock(path) {
      if (fakeImap.deniedFolders.has(path)) {
        const error = new Error(`Permission denied for ${path}`)
        error.responseCode = 'NOPERM'
        throw error
      }
      this.currentPath = path
      const folder = fakeImap.folders[path] ?? { uidValidity: '1', messages: [] }
      const maxUid = Math.max(0, ...folder.messages.map((message) => message.uid))
      this.mailbox = {
        uidValidity: Object.hasOwn(folder, 'rawUidValidity')
          ? folder.rawUidValidity
          : BigInt(folder.uidValidity ?? 1),
        uidNext: Object.hasOwn(folder, 'rawUidNext') ? folder.rawUidNext : maxUid + 1,
        exists: folder.messages.length,
      }
      return { release() {} }
    }

    async search(query, options) {
      fakeImap.calls.push({ type: 'search', path: this.currentPath, query, options })
      if (!fakeImap.searchSupported) return false
      const folder = fakeImap.folders[this.currentPath] ?? { messages: [] }
      const [start, end] = String(query.uid ?? '1:*').split(':')
      const minUid = Number(start || 1)
      const maxUid = end === '*' ? Number.MAX_SAFE_INTEGER : Number(end)
      const alternatives = query.or ?? []
      const since = query.since ? new Date(query.since) : null
      const sinceDay = since
        ? new Date(since.getFullYear(), since.getMonth(), since.getDate()).getTime()
        : null
      return folder.messages
        .filter((message) => message.uid >= minUid && message.uid <= maxUid)
        .filter((message) => sinceDay === null || new Date(message.internalDate).getTime() >= sinceDay)
        .filter((message) => alternatives.length === 0 || alternatives.some((alternative) => {
          const [field, value] = Object.entries(alternative)[0] ?? []
          const addresses = message.search?.[field] ?? message.envelope?.[field] ?? []
          return addresses.some((entry) => entry.address.toLowerCase() === String(value).toLowerCase())
        }))
        .map((message) => message.uid)
    }

    async *fetch(uids, query, options) {
      fakeImap.calls.push({ type: 'fetch', path: this.currentPath, uids, query, options })
      const folder = fakeImap.folders[this.currentPath] ?? { messages: [] }
      let requested
      if (Array.isArray(uids)) {
        requested = new Set(uids)
      } else if (String(uids).includes(':')) {
        const [start, end] = String(uids).split(':')
        const minUid = Number(start || 1)
        const maxUid = end === '*' ? Number.MAX_SAFE_INTEGER : Number(end)
        requested = new Set(folder.messages.filter((message) => message.uid >= minUid && message.uid <= maxUid).map((message) => message.uid))
      } else {
        requested = new Set([Number(uids)])
      }
      const responses = folder.messages.filter((message) => requested.has(message.uid))
      if (fakeImap.reverseFetchResponses) responses.reverse()
      if (fakeImap.injectUnsolicitedFetch) {
        // RFC-valid untagged FETCH update unrelated to the active sequence set.
        yield { uid: 99_999, flags: new Set(['\\Seen']) }
      }
      if (Array.isArray(uids) && query.envelope && fakeImap.duplicateEnvelopeFrames > 0) {
        const repeated = responses[0]
        for (let index = 0; repeated && index < fakeImap.duplicateEnvelopeFrames; index += 1) {
          yield {
            ...repeated,
            size: repeated.size ?? repeated.source.length,
            source: query.source
              ? repeated.source.subarray(0, Number(query.source.maxLength))
              : undefined,
          }
        }
      }
      for (const message of responses) {
        const headerEnd = message.source.indexOf('\r\n\r\n') + 4
        const sourceLimit = Number(query.source?.maxLength)
        yield {
          ...message,
          size: message.size ?? message.source.length,
          source: query.source
            ? (Number.isFinite(sourceLimit) ? message.source.subarray(0, sourceLimit) : message.source)
            : undefined,
          headers: query.headers ? message.source.subarray(0, headerEnd) : undefined,
        }
      }
    }
  },
}))

import { fetchImapMessages, verifyImapConnection } from './mailFetch.js'

function source({ messageId, from, to, bcc = '', subject, date, text }) {
  return Buffer.from([
    `Message-ID: <${messageId}>`,
    `Date: ${new Date(date).toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n'))
}

function inlineCidSource({ messageId, from, to, subject, date }) {
  const boundary = 'atlas-related-boundary'
  return Buffer.from([
    `Message-ID: <${messageId}>`,
    `Date: ${new Date(date).toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    `<p>${'large safe html '.repeat(40_000)}</p><img src="cid:inline-image">`,
    `--${boundary}`,
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <inline-image>',
    'Content-Disposition: inline; filename="inline.png"',
    '',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    `--${boundary}--`,
    '',
  ].join('\r\n'))
}

function manyTinyAttachmentsSource({ messageId, from, to, subject, date, count }) {
  const boundary = `atlas-tiny-${messageId.replace(/[^a-z0-9]/gi, '')}`
  const lines = [
    `Message-ID: <${messageId}>`,
    `Date: ${new Date(date).toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'body',
  ]
  for (let index = 0; index < count; index += 1) {
    lines.push(
      `--${boundary}`,
      'Content-Type: application/octet-stream',
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="tiny-${index}.bin"`,
      '',
      'YQ==',
    )
  }
  lines.push(`--${boundary}--`, '')
  return Buffer.from(lines.join('\r\n'))
}

function rawMessage(uid, {
  from,
  to,
  bcc = '',
  envelopeBcc = true,
  subject,
  date,
  messageId = `message-${uid}@example.com`,
  text = subject,
}) {
  const bccEntries = bcc ? [{ address: bcc }] : []
  return {
    uid,
    internalDate: new Date(date),
    envelope: {
      messageId: `<${messageId}>`,
      subject,
      date: new Date(date),
      from: [{ address: from }],
      sender: [{ address: from }],
      to: [{ address: to }],
      cc: [],
      bcc: envelopeBcc ? bccEntries : [],
      replyTo: [{ address: from }],
    },
    search: {
      from: [{ address: from }],
      to: [{ address: to }],
      cc: [],
      bcc: bccEntries,
    },
    source: source({ messageId, from, to, bcc, subject, date, text }),
  }
}

const settings = {
  incomingProtocol: 'imap',
  incomingHost: 'imap.example.com',
  incomingPort: 993,
  incomingUser: 'student@example.com',
  incomingPass: 'secret',
  incomingTls: true,
}

beforeEach(() => {
  fakeImap.calls.length = 0
  parserMetrics.inputLengths.length = 0
  parserMetrics.options.length = 0
  parserMetrics.htmlUsesDataUrl.length = 0
  parserMetrics.htmlUsesCid.length = 0
  parserMetrics.blockMs = 0
  fakeImap.searchSupported = true
  fakeImap.capabilities.clear()
  fakeImap.reverseFetchResponses = false
  fakeImap.injectUnsolicitedFetch = false
  fakeImap.duplicateEnvelopeFrames = 0
  fakeImap.clientOptions = null
  fakeImap.hangOnConnect = false
  fakeImap.pendingConnectReject = null
  fakeImap.closeCalls = 0
  fakeImap.listRowsYielded = 0
  fakeImap.searchDelayMs = 0
  fakeImap.esearchAttributes = null
  fakeImap.emitErrorOnConnect = null
  fakeImap.emitErrorOnLogout = null
  fakeImap.deniedFolders.clear()
  fakeImap.list = [
    { path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' },
    { path: 'Sent', flags: new Set() },
    { path: 'Archive', flags: new Set(), specialUse: '\\Archive' },
    { path: 'Trash', flags: new Set() },
    { path: 'Spam', flags: new Set() },
    { path: 'Drafts', flags: new Set() },
  ]
  fakeImap.folders = {
    INBOX: {
      uidValidity: '10',
      messages: [
        rawMessage(1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Already synced',
          date: '2026-07-09T08:00:00.000Z',
        }),
        rawMessage(2, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'New reply',
          date: '2026-07-10T10:00:00.000Z',
        }),
        rawMessage(3, {
          from: 'newsletter@example.com',
          to: 'student@example.com',
          subject: 'Unrelated inbox mail',
          date: '2026-07-10T10:30:00.000Z',
        }),
      ],
    },
    Sent: {
      uidValidity: '20',
      messages: [
        rawMessage(5, {
          from: 'student@example.com',
          to: 'professor@example.edu',
          subject: 'Sent outside Atlas',
          date: '2026-07-10T11:00:00.000Z',
        }),
        rawMessage(6, {
          from: 'private-alias@example.com',
          to: 'other@example.com',
          bcc: 'professor@example.edu',
          envelopeBcc: false,
          subject: 'Professor was BCCed',
          date: '2026-07-10T11:15:00.000Z',
        }),
      ],
    },
    Archive: {
      uidValidity: '30',
      messages: [
        rawMessage(7, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Moved before poll',
          date: '2026-07-10T11:30:00.000Z',
        }),
      ],
    },
    Trash: {
      uidValidity: '40',
      messages: [
        rawMessage(9, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Deleted mail',
          date: '2026-07-10T12:00:00.000Z',
        }),
      ],
    },
  }
})

describe('fetchImapMessages', () => {
  it('enforces IMAP protocol parser limits before literals or long lines are buffered', async () => {
    await fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(fakeImap.clientOptions).toMatchObject({
      maxLiteralSize: 16 * 1024 * 1024 + 1,
      maxLineLength: 256 * 1024,
    })
  })

  it('stops a malicious mailbox LIST before ImapFlow can accumulate the full response', async () => {
    fakeImap.list = Array.from({ length: 10_000 }, (_, index) => ({
      path: `Mailbox-${index + 1}`,
      flags: new Set(),
    }))

    await expect(fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({ code: 'MAILBOX_LIMIT_EXCEEDED' })

    expect(fakeImap.listRowsYielded).toBe(256)
    expect(fakeImap.closeCalls).toBe(1)
  })

  it('reserves continuation capacity for a synthesized INBOX', async () => {
    fakeImap.list = Array.from({ length: 255 }, (_, index) => ({
      path: `Archive-${String(index + 1).padStart(3, '0')}`,
      flags: new Set(),
    }))
    fakeImap.folders = Object.fromEntries(fakeImap.list.map((entry, index) => [
      entry.path,
      { uidValidity: String(index + 1), messages: [] },
    ]))

    const result = await fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(Object.keys(result.folderStates)).toHaveLength(256)
    expect(result.folderStates).toHaveProperty('INBOX')
  })

  it('prunes 256 stale cursors before persisting newly listed mailbox progress', async () => {
    const staleStates = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [
      `Deleted-${String(index + 1).padStart(3, '0')}`,
      { uidValidity: String(index + 1), lastUid: 100 },
    ]))
    fakeImap.list = [{ path: 'Current', flags: new Set() }]
    fakeImap.folders = {
      Current: {
        uidValidity: '80',
        messages: [rawMessage(1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Current mailbox cursor',
          date: '2026-07-10T10:00:00.000Z',
        })],
      },
    }

    const first = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      resumeFolderStates: staleStates,
    })

    expect(Object.keys(first.folderStates).sort()).toEqual(['Current', 'INBOX'])
    expect(first.folderStates.Current).toEqual({ uidValidity: '80', lastUid: 1 })

    fakeImap.calls = []
    const resumed = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      resumeFolderStates: first.folderStates,
    })
    expect(resumed.folderStates.Current).toEqual({ uidValidity: '80', lastUid: 1 })
    expect(fakeImap.calls.filter((call) => call.type === 'fetch' && call.path === 'Current')).toEqual([])
  })

  it('rejects an oversized non-RFC UIDVALIDITY before it can accumulate across folders', async () => {
    const hostileUidValidity = '9'.repeat(256 * 1024)
    fakeImap.list = Array.from({ length: 255 }, (_, index) => ({
      path: `Invalid-${String(index + 1).padStart(3, '0')}`,
      flags: new Set(),
    }))
    fakeImap.folders = Object.fromEntries(fakeImap.list.map((entry) => [
      entry.path,
      { rawUidValidity: hostileUidValidity, messages: [] },
    ]))

    await expect(fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      message: 'The IMAP server returned an invalid UIDVALIDITY value.',
    })
    expect(fakeImap.calls).toEqual([])
  })

  it.each([
    ['an infinite UIDNEXT', Number.POSITIVE_INFINITY],
    ['an oversized lexical UIDNEXT', '9'.repeat(256 * 1024)],
  ])('rejects %s before entering an unbounded UID window loop', async (_label, rawUidNext) => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: { uidValidity: '81', rawUidNext, messages: [] },
    }

    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      message: 'The IMAP server returned an invalid UIDNEXT value.',
    })
    expect(fakeImap.calls).toEqual([])
  })

  it('keeps a mailbox literally named __proto__ as an own continuation key', async () => {
    fakeImap.list = [
      { path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' },
      { path: '__proto__', flags: new Set() },
    ]
    fakeImap.folders = Object.assign(Object.create(null), {
      INBOX: { uidValidity: '70', messages: [] },
    })
    fakeImap.folders.__proto__ = { uidValidity: '71', messages: [] }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(Object.hasOwn(result.folderStates, '__proto__')).toBe(true)
    expect(result.folderStates.__proto__).toEqual({ uidValidity: '71', lastUid: 0 })
    expect(JSON.parse(JSON.stringify(result.folderStates)).__proto__).toEqual({
      uidValidity: '71',
      lastUid: 0,
    })
  })

  it('keeps worst-case escaped mailbox continuations below the storage JSON cap', async () => {
    const escapedName = '\\"'.repeat(360)
    fakeImap.list = Array.from({ length: 255 }, (_, index) => ({
      path: `Q${String(index).padStart(3, '0')}-${escapedName}`,
      flags: new Set(),
    }))
    fakeImap.folders = {}

    const result = await fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })
    const serializedContinuation = JSON.stringify({
      version: 1,
      accountKey: result.accountKey,
      mode: 'incremental',
      mailSyncGeneration: '2026-08-02T12:00:00.000Z',
      whitelistDigest: 'f'.repeat(64),
      folderStates: result.folderStates,
      totals: {},
      updatedAt: '2026-08-02T12:00:00.000Z',
    })

    expect(Object.keys(result.folderStates)).toHaveLength(256)
    expect(Buffer.byteLength(serializedContinuation)).toBeLessThanOrEqual(512 * 1024)
  })

  it('charges control-heavy mailbox paths by their escaped continuation size', async () => {
    const controlHeavyName = '\u0001'.repeat(400)
    fakeImap.list = Array.from({ length: 255 }, (_, index) => ({
      path: `C${String(index).padStart(3, '0')}-${controlHeavyName}`,
      flags: new Set(),
    }))

    await expect(fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({ code: 'MAILBOX_LIMIT_EXCEEDED' })

    // The raw paths total far less than 192 KiB; rejection before row 255
    // proves the normalized JSON budget, including `\u0001` expansion, owns
    // the decision.
    expect(fakeImap.listRowsYielded).toBeLessThan(255)
    expect(fakeImap.closeCalls).toBe(1)
  })

  it('stops repeated requested FETCH frames without growing a duplicate UID array', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '61',
        messages: [rawMessage(1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Repeated response',
          date: '2026-07-10T10:00:00.000Z',
        })],
      },
    }
    fakeImap.duplicateEnvelopeFrames = 1_000_000

    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({ code: 'FETCH_RESPONSE_LIMIT_EXCEEDED' })

    expect(fakeImap.closeCalls).toBe(1)
    expect(parserMetrics.inputLengths).toEqual([])
  })

  it('disables MailParser HTML and inline-CID amplification for fetched bodies', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    const message = rawMessage(1, {
      from: 'professor@example.edu',
      to: 'student@example.com',
      subject: 'Inline CID body',
      date: '2026-07-10T10:00:00.000Z',
    })
    message.source = inlineCidSource({
      messageId: 'inline-cid@example.com',
      from: 'professor@example.edu',
      to: 'student@example.com',
      subject: 'Inline CID body',
      date: '2026-07-10T10:00:00.000Z',
    })
    fakeImap.folders = { INBOX: { uidValidity: '63', messages: [message] } }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].text.length).toBeLessThanOrEqual(512 * 1024)
    expect(parserMetrics.options).toHaveLength(1)
    expect(parserMetrics.options[0]).toMatchObject({
      keepCidLinks: true,
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipTextLinks: true,
      maxHtmlLengthToParse: 512 * 1024,
    })
    expect(parserMetrics.htmlUsesCid).toEqual([true])
    expect(parserMetrics.htmlUsesDataUrl).toEqual([false])
  })

  it('rejects an over-budget MIME tree before MailParser creates child nodes', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    const boundary = 'many-parts-boundary'
    const message = rawMessage(1, {
      from: 'professor@example.edu',
      to: 'student@example.com',
      subject: 'Too many MIME parts',
      date: '2026-07-10T10:00:00.000Z',
    })
    message.source = Buffer.from([
      'Message-ID: <many-parts@example.com>',
      'Date: Thu, 10 Jul 2026 10:00:00 +0000',
      'From: professor@example.edu',
      'To: student@example.com',
      'Subject: Too many MIME parts',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      ...Array.from({ length: 2_049 }, (_, index) => [
        `--${boundary}`,
        'Content-Type: text/plain',
        '',
        `part ${index + 1}`,
      ]).flat(),
      `--${boundary}--`,
      '',
    ].join('\r\n'))
    fakeImap.folders = { INBOX: { uidValidity: '64', messages: [message] } }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toEqual([])
    expect(result.folderStates.INBOX.lastUid).toBe(1)
    expect(parserMetrics.inputLengths).toEqual([])
  })

  it('actively closes a trickling IMAP connection at the whole-operation deadline', async () => {
    fakeImap.hangOnConnect = true

    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      operationTimeoutMs: 50,
    })).rejects.toMatchObject({
      code: 'MAIL_SYNC_TIME_SLICE_DEFERRED',
    })
    expect(fakeImap.closeCalls).toBe(1)
  })

  it('bounds DNS/target resolution inside the same whole-operation deadline', async () => {
    const resolveNetworkTarget = vi.fn(() => new Promise(() => {}))

    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      operationTimeoutMs: 30,
      resolveNetworkTarget,
    })).rejects.toMatchObject({ code: 'MAIL_SYNC_TIME_SLICE_DEFERRED' })

    expect(resolveNetworkTarget).toHaveBeenCalledTimes(1)
    expect(resolveNetworkTarget.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(fakeImap.clientOptions).toBeNull()
  })

  it('cancels connection verification while DNS/target resolution is pending', async () => {
    const controller = new AbortController()
    const resolveNetworkTarget = vi.fn(() => new Promise(() => {}))
    const pending = verifyImapConnection(settings, {
      signal: controller.signal,
      operationTimeoutMs: 5_000,
      resolveNetworkTarget,
    })
    controller.abort(new Error('request closed'))

    await expect(pending).rejects.toMatchObject({ code: 'CONNECTION_FAILED' })
    expect(fakeImap.clientOptions).toBeNull()
  })

  it('owns a late ImapFlow transport error instead of letting it terminate the API process', async () => {
    fakeImap.emitErrorOnLogout = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
    })

    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      cause: { code: 'ECONNRESET' },
    })
    expect(fakeImap.closeCalls).toBe(1)
  })

  it('actively closes an in-flight IMAP operation when server shutdown is signalled', async () => {
    fakeImap.hangOnConnect = true
    const controller = new AbortController()
    const pending = fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      signal: controller.signal,
      operationTimeoutMs: 5_000,
    })
    setTimeout(() => controller.abort(new Error('server stopping')), 10)

    await expect(pending).rejects.toMatchObject({
      code: 'MAIL_SYNC_SHUTDOWN_DEFERRED',
    })
    expect(fakeImap.closeCalls).toBe(1)
  })

  it('detects the whole-operation deadline after a synchronous parser stall', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '62',
        messages: [rawMessage(1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Parser deadline',
          date: '2026-07-10T10:00:00.000Z',
        })],
      },
    }
    parserMetrics.blockMs = 50

    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      operationTimeoutMs: 20,
    })).rejects.toMatchObject({ code: 'MAIL_SYNC_TIME_SLICE_DEFERRED' })

    expect(fakeImap.closeCalls).toBe(1)
  })

  it('uses per-folder UID cursors and imports incoming, sent, and moved professor mail only', async () => {
    const result = await fetchImapMessages(settings, {
      accountKey: 'mail-account-will-be-replaced',
      folderStates: {},
    }, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages.map((message) => [message.subject, message.direction])).toEqual([
      ['Already synced', 'incoming'],
      ['New reply', 'incoming'],
      ['Sent outside Atlas', 'outgoing'],
      ['Professor was BCCed', 'outgoing'],
      ['Moved before poll', 'incoming'],
    ])
    expect(result.messages.some((message) => message.subject === 'Unrelated inbox mail')).toBe(false)
    expect(result.messages.some((message) => message.subject === 'Deleted mail')).toBe(false)
    expect(result.folderStates).toEqual({
      INBOX: { uidValidity: '10', lastUid: 3 },
      Sent: { uidValidity: '20', lastUid: 6 },
      Archive: { uidValidity: '30', lastUid: 7 },
    })
    expect(fakeImap.calls.filter((call) => call.type === 'fetch').every((call) => call.options.uid === true)).toBe(true)
    const sourceFetchUids = fakeImap.calls
      .filter((call) => call.type === 'fetch' && call.query.source)
      .flatMap((call) => call.uids)
    expect(sourceFetchUids).not.toContain(3)
    expect(fakeImap.calls.filter((call) => call.type === 'search')).toHaveLength(0)
    expect(fakeImap.calls.some((call) => ['Trash', 'Spam', 'Drafts'].includes(call.path))).toBe(false)
  })

  it('recognizes localized nested sent folders and continues past an inaccessible custom folder', async () => {
    fakeImap.list = [
      { path: 'INBOX', name: 'INBOX', delimiter: '.', flags: new Set(), specialUse: '\\Inbox' },
      { path: 'INBOX.Отправленные', name: 'Отправленные', delimiter: '.', flags: new Set() },
      { path: 'INBOX.Private', name: 'Private', delimiter: '.', flags: new Set() },
    ]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '10',
        messages: [rawMessage(1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'Incoming from inbox',
          date: '2026-07-10T09:00:00.000Z',
        })],
      },
      'INBOX.Отправленные': {
        uidValidity: '11',
        messages: [rawMessage(2, {
          from: 'unconfigured-alias@example.com',
          to: 'professor@example.edu',
          subject: 'Sent from another client',
          date: '2026-07-10T10:00:00.000Z',
        })],
      },
      'INBOX.Private': {
        uidValidity: '12',
        messages: [],
      },
    }
    fakeImap.deniedFolders.add('INBOX.Private')

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages.map((message) => [message.subject, message.direction])).toEqual([
      ['Incoming from inbox', 'incoming'],
      ['Sent from another client', 'outgoing'],
    ])
    expect(result.folderStates).toEqual({
      INBOX: { uidValidity: '10', lastUid: 1 },
      'INBOX.Отправленные': { uidValidity: '11', lastUid: 2 },
    })
  })

  it('on first automatic sync keeps mail received after enablement without backfilling earlier mail', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '10',
        messages: [
          rawMessage(1, {
            from: 'professor@example.edu',
            to: 'student@example.com',
            subject: 'Before enablement',
            date: '2026-07-10T09:00:00.000Z',
          }),
          rawMessage(2, {
            from: 'professor@example.edu',
            to: 'student@example.com',
            subject: 'After enablement',
            date: '2026-07-10T11:00:00.000Z',
          }),
        ],
      },
    }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'incremental',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      initialSince: '2026-07-10T10:00:00.000Z',
    })

    expect(result.messages.map((message) => message.subject)).toEqual(['After enablement'])
    expect(result.folderStates.INBOX.lastUid).toBe(2)
  })

  it('applies the exact enablement timestamp to widened server-side BCC hits', async () => {
    fakeImap.list = [{ path: 'Sent', flags: new Set(), specialUse: '\\Sent' }]
    fakeImap.folders = {
      Sent: {
        uidValidity: '61',
        messages: [
          rawMessage(1, {
            from: 'student@example.com',
            to: 'other@example.com',
            bcc: 'professor@example.edu',
            envelopeBcc: false,
            subject: 'BCC before enablement',
            date: '2026-07-10T09:59:59.000Z',
          }),
          rawMessage(2, {
            from: 'student@example.com',
            to: 'other@example.com',
            bcc: 'professor@example.edu',
            envelopeBcc: false,
            subject: 'BCC after enablement',
            date: '2026-07-10T10:00:01.000Z',
          }),
        ],
      },
    }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'incremental',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      initialSince: '2026-07-10T10:00:00.000Z',
    })

    expect(result.messages.map((message) => message.subject)).toEqual(['BCC after enablement'])
    expect(result.folderStates.Sent.lastUid).toBe(2)
  })

  it('accepts bounded ESEARCH sequence sets and rejects oversized server responses', async () => {
    fakeImap.capabilities.add('ESEARCH')
    const valid = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })
    expect(valid.messages.some((message) => message.subject === 'New reply')).toBe(true)
    expect(fakeImap.calls.some((call) => call.type === 'uid-search')).toBe(true)

    fakeImap.calls.length = 0
    fakeImap.esearchAttributes = [
      { value: 'UID' },
      { value: 'ALL' },
      { value: '1,'.repeat(9_000) },
    ]
    await expect(fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })).rejects.toMatchObject({ code: 'SEARCH_RESPONSE_LIMIT_EXCEEDED' })
  })

  it('keeps a hundred-thousand tracked aliases to two searches per UID window', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '62',
        messages: [rawMessage(1, {
          from: 'unrelated@example.net',
          to: 'student@example.com',
          subject: 'Unrelated adaptive candidate',
          date: '2026-07-10T10:00:00.000Z',
        })],
      },
    }
    const trackedAddresses = Array.from(
      { length: 100_000 },
      (_value, index) => `professor-${index}@example.edu`,
    )

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses,
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toEqual([])
    expect(fakeImap.calls.filter((call) => call.type === 'uid-search')).toHaveLength(2)
    expect(fakeImap.calls.filter((call) => call.type === 'fetch' && call.query.source)).toHaveLength(0)
  })

  it('scans ten thousand nonmatching UIDs without downloading envelope or source bodies', async () => {
    fakeImap.list = [{ path: 'Sent', flags: new Set(), specialUse: '\\Sent' }]
    fakeImap.folders = {
      Sent: {
        uidValidity: '63',
        messages: Array.from({ length: 10_000 }, (_value, index) => rawMessage(index + 1, {
          from: 'student@example.com',
          to: 'unrelated@example.net',
          subject: `Nonmatch ${index + 1}`,
          date: '2026-07-10T10:00:00.000Z',
        })),
      },
    }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toEqual([])
    expect(result.scannedUids).toBe(10_000)
    expect(result.folderStates.Sent.lastUid).toBe(10_000)
    expect(fakeImap.calls.filter((call) => call.type === 'uid-search')).toHaveLength(100)
    expect(fakeImap.calls.some((call) => call.type === 'fetch')).toBe(false)
  })

  it('checkpoints a completed search window before the operation deadline and resumes after it', async () => {
    fakeImap.searchDelayMs = 60
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '64',
        messages: Array.from({ length: 400 }, (_value, index) => rawMessage(index + 1, {
          from: 'unrelated@example.net',
          to: 'student@example.com',
          subject: `Deadline ${index + 1}`,
          date: '2026-07-10T10:00:00.000Z',
        })),
      },
    }
    const common = {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    }
    const first = await fetchImapMessages(settings, {}, {
      ...common,
      operationTimeoutMs: 1_600,
    })
    expect(first.hasMore).toBe(true)
    expect(first.folderStates.INBOX.lastUid).toBe(200)

    fakeImap.calls.length = 0
    fakeImap.searchDelayMs = 0
    const second = await fetchImapMessages(settings, {}, {
      ...common,
      resumeFolderStates: first.folderStates,
    })
    expect(second.folderStates.INBOX.lastUid).toBe(400)
    expect(JSON.stringify(fakeImap.calls.find((call) => call.type === 'uid-search')?.attributes))
      .toContain('201:400')
  })

  it('bounds all full-source downloads even when a server BCC index yields false positives', async () => {
    fakeImap.list = [{ path: 'Sent', flags: new Set(), specialUse: '\\Sent' }]
    fakeImap.folders = {
      Sent: {
        uidValidity: '65',
        messages: Array.from({ length: 3 }, (_value, index) => rawMessage(index + 1, {
          from: 'student@example.com',
          to: 'other@example.com',
          bcc: 'not-the-professor@example.net',
          envelopeBcc: false,
          subject: `False BCC ${index + 1}`,
          date: '2026-07-10T10:00:00.000Z',
          text: 'x'.repeat(10 * 1024 * 1024),
        })),
      },
    }
    const trackedAddresses = Array.from(
      { length: 65 },
      (_value, index) => `professor-${index}@example.edu`,
    )

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses,
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toEqual([])
    expect(result.hasMore).toBe(true)
    expect(result.folderStates.Sent.lastUid).toBe(2)
    expect(parserMetrics.inputLengths).toHaveLength(2)
    expect(fakeImap.calls.filter((call) => call.type === 'fetch' && call.query.source)).toHaveLength(2)
  })

  it('caps tiny MIME attachment fan-out per message and across the retained batch', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    const messages = Array.from({ length: 5 }, (_value, index) => {
      const message = rawMessage(index + 1, {
        from: 'professor@example.edu',
        to: 'student@example.com',
        subject: `Tiny attachments ${index + 1}`,
        date: '2026-07-10T10:00:00.000Z',
      })
      message.source = manyTinyAttachmentsSource({
        messageId: `tiny-${index + 1}@example.com`,
        from: 'professor@example.edu',
        to: 'student@example.com',
        subject: message.envelope.subject,
        date: message.internalDate,
        count: 140,
      })
      return message
    })
    fakeImap.folders = { INBOX: { uidValidity: '66', messages } }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toHaveLength(5)
    expect(result.messages.every((message) => message.attachments.length <= 128)).toBe(true)
    expect(result.messages.reduce((total, message) => total + message.attachments.length, 0)).toBe(512)
    expect(result.messages.reduce(
      (total, message) => total + Number(message.omittedAttachmentCount ?? 0),
      0,
    )).toBe(188)
  })

  it('establishes a baseline without downloading message bodies', async () => {
    const result = await fetchImapMessages(settings, {}, {
      mode: 'baseline',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages).toEqual([])
    expect(fakeImap.calls.some((call) => call.type === 'fetch')).toBe(false)
    expect(result.folderStates.INBOX.lastUid).toBe(3)
  })

  it('uses streaming bounded UID SEARCH before any envelope or body fetch', async () => {
    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages.map((message) => message.subject)).toEqual([
      'Already synced',
      'New reply',
      'Sent outside Atlas',
      'Professor was BCCed',
      'Moved before poll',
    ])
    expect(fakeImap.calls.some((call) => call.type === 'uid-search')).toBe(true)
    expect(fakeImap.calls.some((call) => (
      call.type === 'fetch'
      && typeof call.uids === 'string'
      && call.query.uid === true
      && !call.query.headers
      && !call.query.source
    ))).toBe(false)
    const sourceFetchUids = fakeImap.calls
      .filter((call) => call.type === 'fetch' && call.query.source)
      .flatMap((call) => call.uids)
    expect(sourceFetchUids).not.toContain(3)
  })

  it('returns bounded history batches with a lossless resume cursor', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '44',
        messages: Array.from({ length: 5 }, (_, index) => rawMessage(index + 1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: `History ${index + 1}`,
          date: `2026-07-10T1${index}:00:00.000Z`,
        })),
      },
    }

    const first = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      maxMessages: 2,
    })
    const second = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      resumeFolderStates: first.folderStates,
      maxMessages: 2,
    })
    const third = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      resumeFolderStates: second.folderStates,
      maxMessages: 2,
    })

    expect(first.messages.map((message) => message.uid)).toEqual([1, 2])
    expect(second.messages.map((message) => message.uid)).toEqual([3, 4])
    expect(third.messages.map((message) => message.uid)).toEqual([5])
    expect(first.hasMore).toBe(true)
    expect(second.hasMore).toBe(true)
    expect(third.hasMore).toBe(false)
    expect(third.folderStates.INBOX).toEqual({ uidValidity: '44', lastUid: 5 })
    expect(fakeImap.calls.some((call) => (
      call.type === 'uid-search'
      && JSON.stringify(call.attributes).includes('3:5')
    ))).toBe(true)
  })

  it('keeps continuation cursors lossless when FETCH responses arrive in reverse UID order', async () => {
    fakeImap.reverseFetchResponses = true
    fakeImap.injectUnsolicitedFetch = true
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '51',
        messages: Array.from({ length: 3 }, (_, index) => rawMessage(index + 1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: `Reverse ${index + 1}`,
          date: `2026-07-10T1${index}:00:00.000Z`,
        })),
      },
    }
    const common = {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      maxMessages: 1,
    }
    const batches = []
    let resumeFolderStates = {}
    for (let index = 0; index < 4; index += 1) {
      const batch = await fetchImapMessages(settings, {}, {
        ...common,
        resumeFolderStates,
      })
      batches.push(batch)
      resumeFolderStates = batch.folderStates
    }

    expect(batches.flatMap((batch) => batch.messages.map((message) => message.uid))).toEqual([1, 2, 3])
    expect(batches.slice(0, 3).map((batch) => batch.folderStates.INBOX.lastUid)).toEqual([1, 2, 3])
    expect(batches[3].hasMore).toBe(false)
    const bodyFetches = fakeImap.calls.filter((call) => call.type === 'fetch' && call.query.source)
    expect(bodyFetches.every((call) => !Array.isArray(call.uids))).toBe(true)
  })

  it('defers the next message before the retained-source byte budget is exceeded', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    const firstMessage = rawMessage(1, {
      from: 'professor@example.edu',
      to: 'student@example.com',
      subject: 'First bounded message',
      date: '2026-07-10T10:00:00.000Z',
      text: 'a'.repeat(1_024),
    })
    const secondMessage = rawMessage(2, {
      from: 'professor@example.edu',
      to: 'student@example.com',
      subject: 'Deferred bounded message',
      date: '2026-07-10T11:00:00.000Z',
      text: 'b'.repeat(1_024),
    })
    fakeImap.folders = {
      INBOX: { uidValidity: '45', messages: [firstMessage, secondMessage] },
    }
    const byteBudget = firstMessage.source.length + 16

    const first = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      maxRetainedSourceBytes: byteBudget,
    })
    // The second source is fetched so its exact byte length is known, but it
    // must be deferred before MailParser expands it while batch one is live.
    expect(parserMetrics.inputLengths).toEqual([firstMessage.source.length])
    const second = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      resumeFolderStates: first.folderStates,
      maxRetainedSourceBytes: byteBudget,
    })

    expect(first.messages.map((message) => message.uid)).toEqual([1])
    expect(first.retainedSourceBytes).toBeLessThanOrEqual(byteBudget)
    expect(first.folderStates.INBOX.lastUid).toBe(1)
    expect(first.hasMore).toBe(true)
    expect(second.messages.map((message) => message.uid)).toEqual([2])
  })

  it('parses a server-matched BCC from a bounded full source even after a hostile long header', async () => {
    fakeImap.list = [{ path: 'Sent', flags: new Set(), specialUse: '\\Sent' }]
    const hiddenBcc = rawMessage(1, {
      from: 'private-alias@example.com',
      to: 'other@example.com',
      bcc: '',
      envelopeBcc: false,
      subject: 'Hostile long header',
      date: '2026-07-10T11:00:00.000Z',
    })
    hiddenBcc.source = Buffer.from([
      'Message-ID: <hostile-header@example.com>',
      'Date: Thu, 10 Jul 2026 11:00:00 +0000',
      'From: private-alias@example.com',
      'To: other@example.com',
      ...Array.from(
        { length: 600 },
        (_value, index) => `Received: from relay-${index}.example.net by mx.example.net; ${'x'.repeat(500)}`,
      ),
      'Bcc: professor@example.edu',
      'Subject: Hostile long header',
      '',
      'body',
    ].join('\r\n'))
    fakeImap.folders = { Sent: { uidValidity: '49', messages: [hiddenBcc] } }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    const sentEnvelopeFetch = fakeImap.calls.find((call) => (
      call.type === 'fetch' && call.path === 'Sent' && call.query.envelope
    ))
    expect(sentEnvelopeFetch?.query.headers).toBeUndefined()
    expect(sentEnvelopeFetch?.query.source).toBeUndefined()
    expect(fakeImap.calls.some((call) => (
      call.type === 'fetch' && call.path === 'Sent' && !call.query.envelope && call.query.source
    ))).toBe(false)
    expect(result.messages.map((message) => message.subject)).toEqual(['Hostile long header'])
    expect(parserMetrics.inputLengths).toEqual([hiddenBcc.source.length])
    const fullSourceFetches = fakeImap.calls.filter((call) => call.type === 'fetch' && call.query.source)
    expect(fullSourceFetches).toHaveLength(1)
    expect(fullSourceFetches[0].query.source).toEqual({ maxLength: 16 * 1024 * 1024 + 1 })
  })

  it('still discovers a header-only BCC when a large Sent body exceeds the header prefix', async () => {
    fakeImap.list = [{ path: 'Sent', flags: new Set(), specialUse: '\\Sent' }]
    const largeBody = rawMessage(1, {
      from: 'private-alias@example.com',
      to: 'other@example.com',
      bcc: 'professor@example.edu',
      envelopeBcc: false,
      subject: 'Large body with hidden BCC',
      date: '2026-07-10T11:00:00.000Z',
      text: 'x'.repeat(300 * 1024),
    })
    fakeImap.folders = { Sent: { uidValidity: '50', messages: [largeBody] } }

    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
    })

    expect(result.messages.map((message) => [message.subject, message.direction])).toEqual([
      ['Large body with hidden BCC', 'outgoing'],
    ])
    expect(parserMetrics.inputLengths).toEqual([largeBody.source.length])
    expect(parserMetrics.inputLengths[0]).toBeGreaterThan(256 * 1024)
  })

  it('keeps the first-sync date boundary across bounded folder continuations', async () => {
    fakeImap.list = [
      { path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' },
      { path: 'Sent', flags: new Set(), specialUse: '\\Sent' },
    ]
    fakeImap.folders = {
      INBOX: {
        uidValidity: '47',
        messages: [rawMessage(1, {
          from: 'professor@example.edu',
          to: 'student@example.com',
          subject: 'New inbox message',
          date: '2026-07-10T11:00:00.000Z',
        })],
      },
      Sent: {
        uidValidity: '48',
        messages: [
          rawMessage(1, {
            from: 'student@example.com',
            to: 'professor@example.edu',
            subject: 'Old sent message',
            date: '2026-07-10T09:00:00.000Z',
          }),
          rawMessage(2, {
            from: 'student@example.com',
            to: 'professor@example.edu',
            subject: 'New sent message',
            date: '2026-07-10T11:30:00.000Z',
          }),
        ],
      },
    }
    const common = {
      mode: 'incremental',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      initialSince: '2026-07-10T10:00:00.000Z',
      maxMessages: 1,
    }

    const first = await fetchImapMessages(settings, {}, common)
    const second = await fetchImapMessages(settings, {}, {
      ...common,
      resumeFolderStates: first.folderStates,
    })
    const third = await fetchImapMessages(settings, {}, {
      ...common,
      resumeFolderStates: second.folderStates,
    })

    expect(first.messages.map((message) => message.subject)).toEqual(['New inbox message'])
    expect(second.messages.map((message) => message.subject)).toEqual(['New sent message'])
    expect(third.messages).toEqual([])
    expect(third.hasMore).toBe(false)
    expect(third.folderStates).toEqual({
      INBOX: { uidValidity: '47', lastUid: 1 },
      Sent: { uidValidity: '48', lastUid: 2 },
    })
  })

  it('bounds UID scan ranges and reports oversized messages without fetching their bodies', async () => {
    fakeImap.list = [{ path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' }]
    const messages = Array.from({ length: 2_001 }, (_, index) => rawMessage(index + 1, {
      from: index === 2_000 ? 'professor@example.edu' : 'newsletter@example.com',
      to: 'student@example.com',
      subject: `Message ${index + 1}`,
      date: '2026-07-10T10:00:00.000Z',
    }))
    messages[2_000].size = 100 * 1024 * 1024
    fakeImap.folders = { INBOX: { uidValidity: '46', messages } }

    const first = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      maxScannedUids: 2_000,
    })
    const result = await fetchImapMessages(settings, {}, {
      mode: 'history',
      trackedAddresses: ['professor@example.edu'],
      ownerAddresses: ['student@example.com'],
      resumeFolderStates: first.folderStates,
      maxScannedUids: 2_000,
    })

    expect(first.messages).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(first.scannedUids).toBe(2_000)
    expect(first.folderStates.INBOX.lastUid).toBe(2_000)
    expect(result.messages).toEqual([])
    expect(result.skippedOversized).toBe(1)
    expect(result.hasMore).toBe(false)
    expect(result.folderStates.INBOX.lastUid).toBe(2_001)
    expect(fakeImap.calls.filter((call) => call.type === 'uid-search')).toHaveLength(22)
    expect(fakeImap.calls.some((call) => (
      call.type === 'fetch' && typeof call.uids === 'string' && !call.query.envelope
    ))).toBe(false)
    expect(fakeImap.calls.some((call) => call.type === 'fetch' && call.query.source)).toBe(false)
  })
})
