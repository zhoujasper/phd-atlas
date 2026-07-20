import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeImap = vi.hoisted(() => ({
  calls: [],
  folders: {},
  list: [],
  searchSupported: true,
}))

vi.mock('imapflow', () => ({
  ImapFlow: class FakeImapFlow {
    constructor() {
      this.mailbox = null
      this.currentPath = null
    }

    async connect() {}

    async logout() {}

    async list() {
      return fakeImap.list
    }

    async getMailboxLock(path) {
      this.currentPath = path
      const folder = fakeImap.folders[path] ?? { uidValidity: '1', messages: [] }
      const maxUid = Math.max(0, ...folder.messages.map((message) => message.uid))
      this.mailbox = {
        uidValidity: BigInt(folder.uidValidity ?? 1),
        uidNext: maxUid + 1,
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
      for (const message of folder.messages) {
        if (!requested.has(message.uid)) continue
        const headerEnd = message.source.indexOf('\r\n\r\n') + 4
        yield {
          ...message,
          source: query.source ? message.source : undefined,
          headers: query.headers ? message.source.subarray(0, headerEnd) : undefined,
        }
      }
    }
  },
}))

import { fetchImapMessages } from './mailFetch.js'

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
  fakeImap.searchSupported = true
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
    expect(fakeImap.calls.find((call) => call.type === 'search' && call.path === 'Sent')?.query.or).toBeUndefined()
    expect(fakeImap.calls.some((call) => ['Trash', 'Spam', 'Drafts'].includes(call.path))).toBe(false)
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

  it('falls back to UID and header fetches when the server rejects address SEARCH commands', async () => {
    fakeImap.searchSupported = false

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
    expect(fakeImap.calls.filter((call) => call.type === 'search')).toHaveLength(1)
    expect(fakeImap.calls.some((call) => (
      call.type === 'fetch'
      && typeof call.uids === 'string'
      && call.query.uid === true
      && !call.query.headers
      && !call.query.source
    ))).toBe(true)
    const sourceFetchUids = fakeImap.calls
      .filter((call) => call.type === 'fetch' && call.query.source)
      .flatMap((call) => call.uids)
    expect(sourceFetchUids).not.toContain(3)
  })
})
