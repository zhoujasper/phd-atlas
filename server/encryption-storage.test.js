import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import {
  BACKUP_ENVELOPE_MAGIC,
  decodeBackupFile,
  decodeBackupPayload,
  decodeExternalStatePayload,
  encodeBackupFile,
  encodeBackupPayload,
  encodeExternalStatePayload,
  encodeExternalStatePayloadStreaming,
  inspectBackupFile,
} from './durableEnvelope.js'
import {
  sealSqliteBuffer,
  sealSqliteFile,
  unsealSqliteBuffer,
  unsealSqliteFile,
} from './sqliteSeal.js'
import {
  cleanupInterruptedBackupArtifacts,
  recoverOrCleanInterruptedSqliteSeals,
} from './storage.js'

const created = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })))
})

describe('durable encryption envelopes', () => {
  it('encrypts and authenticates external database state with the selected profile', () => {
    const plain = Buffer.from('SQLite format 3\0private workspace state')
    const sealed = encodeExternalStatePayload(plain, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'chacha20-poly1305',
      passwordBinding: 'admin-password-verifier',
    })

    expect(sealed.equals(plain)).toBe(false)
    expect(sealed.includes(Buffer.from('private workspace state'))).toBe(false)
    expect(decodeExternalStatePayload(sealed)).toEqual(plain)

    const split = sealed.indexOf(10) + 1
    const envelope = JSON.parse(sealed.subarray(split).toString('utf8'))
    const cipherIndex = envelope.ciphertext.length - 5
    const replacement = envelope.ciphertext[cipherIndex] === 'A' ? 'B' : 'A'
    envelope.ciphertext = `${envelope.ciphertext.slice(0, cipherIndex)}${replacement}${envelope.ciphertext.slice(cipherIndex + 1)}`
    const tampered = Buffer.concat([sealed.subarray(0, split), Buffer.from(JSON.stringify(envelope))])
    expect(() => decodeExternalStatePayload(tampered)).toThrow()
  })

  it('streams external state into the rollback-compatible legacy envelope', async () => {
    const plain = Buffer.alloc((2 * 1024 * 1024) + 31, 0x6d)
    const sealed = await encodeExternalStatePayloadStreaming(plain, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
      passwordBinding: 'rollback-profile',
    })
    expect(sealed[sealed.indexOf(10) + 1]).toBe('{'.charCodeAt(0))
    expect(decodeExternalStatePayload(sealed)).toEqual(plain)
  })

  it('opens a sealed SQLite image entirely from memory', async () => {
    const database = new Database(':memory:')
    database.exec('CREATE TABLE private_data (value TEXT); INSERT INTO private_data VALUES (\'secret\')')
    const image = database.serialize()
    database.close()

    const target = path.join(os.tmpdir(), `phd-atlas-seal-${process.pid}-${Date.now()}.sealed`)
    created.push(target)
    const key = '11'.repeat(32)
    await sealSqliteBuffer(image, target, key, 'chacha20-poly1305')

    const diskBytes = await fs.readFile(target)
    expect(diskBytes.includes(Buffer.from('secret'))).toBe(false)
    const restored = new Database(await unsealSqliteBuffer(target, key))
    expect(restored.prepare('SELECT value FROM private_data').get()).toEqual({ value: 'secret' })
    restored.close()
  })

  it('atomically replaces an existing sealed SQLite image', async () => {
    const target = path.join(os.tmpdir(), `phd-atlas-reseal-${process.pid}-${Date.now()}.sealed`)
    created.push(target)
    const key = '22'.repeat(32)

    await sealSqliteBuffer(Buffer.from('first private snapshot'), target, key)
    await sealSqliteBuffer(Buffer.from('second private snapshot'), target, key)

    expect(await unsealSqliteBuffer(target, key)).toEqual(Buffer.from('second private snapshot'))
    const leftovers = (await fs.readdir(path.dirname(target)))
      .filter((name) => name.startsWith(`${path.basename(target)}.`))
    expect(leftovers).toEqual([])
  })

  it('promotes the only authenticated recovery candidate before encryption policy initialization', async () => {
    const target = path.join(os.tmpdir(), `phd-atlas-recover-${process.pid}-${Date.now()}.sealed`)
    const candidate = `${target}.previous-${process.pid}-${Date.now()}`
    created.push(target, candidate)
    const key = '33'.repeat(32)
    const snapshot = Buffer.from('only authenticated recovery snapshot')
    await sealSqliteBuffer(snapshot, candidate, key, 'chacha20-poly1305')

    await recoverOrCleanInterruptedSqliteSeals({ targetPath: target, hexKey: key })

    expect(await unsealSqliteBuffer(target, key)).toEqual(snapshot)
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rewraps backups across algorithm and password-binding changes without losing bytes', () => {
    const plain = Buffer.from('{"private":"application backup"}')
    const first = encodeBackupPayload(plain, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
      passwordBinding: 'first-password-verifier',
    })
    const opened = decodeBackupPayload(first)
    const second = encodeBackupPayload(opened.plain, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'chacha20-poly1305',
      passwordBinding: 'second-password-verifier',
    })
    const migrated = decodeBackupPayload(second)

    expect(migrated.plain).toEqual(plain)
    expect(migrated.profile).toEqual({
      algorithm: 'chacha20-poly1305',
      passwordBinding: 'second-password-verifier',
    })
    expect(second.equals(first)).toBe(false)
  })

  it('streams a large binary-v2 backup without base64 expansion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-backup-v2-'))
    created.push(root)
    const source = path.join(root, 'source.tar.gz')
    const encrypted = path.join(root, 'encrypted.tar.gz')
    const restored = path.join(root, 'restored.tar.gz')
    const plain = Buffer.alloc((2 * 1024 * 1024) + 257)
    for (let index = 0; index < plain.length; index += 1) plain[index] = index % 251
    await fs.writeFile(source, plain)

    await encodeBackupFile(source, encrypted, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'chacha20-poly1305',
      passwordBinding: 'stream-profile',
    })
    const inspection = await inspectBackupFile(encrypted)
    const encryptedStat = await fs.stat(encrypted)
    expect(inspection).toMatchObject({
      encrypted: true,
      version: 2,
      plainBytes: plain.length,
      profile: {
        algorithm: 'chacha20-poly1305',
        passwordBinding: 'stream-profile',
      },
    })
    expect(encryptedStat.size).toBeLessThan(plain.length + 1024)
    const prefix = Buffer.alloc(BACKUP_ENVELOPE_MAGIC.length + 1)
    const handle = await fs.open(encrypted, 'r')
    try {
      await handle.read(prefix, 0, prefix.length, 0)
    } finally {
      await handle.close()
    }
    expect(prefix.subarray(0, BACKUP_ENVELOPE_MAGIC.length)).toEqual(BACKUP_ENVELOPE_MAGIC)
    expect(prefix[BACKUP_ENVELOPE_MAGIC.length]).toBe(2)

    await decodeBackupFile(encrypted, restored)
    expect(await fs.readFile(restored)).toEqual(plain)
    expect((await fs.readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('streams and authenticates a large legacy-v1 backup', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-backup-v1-'))
    created.push(root)
    const source = path.join(root, 'legacy.tar.gz')
    const restored = path.join(root, 'restored.tar.gz')
    const plain = Buffer.alloc((1024 * 1024) + 73, 0xa7)
    const legacy = encodeBackupPayload(plain, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
      passwordBinding: 'legacy-profile',
    })
    expect(legacy[BACKUP_ENVELOPE_MAGIC.length]).toBe('{'.charCodeAt(0))
    await fs.writeFile(source, legacy)

    expect(await inspectBackupFile(source)).toMatchObject({
      encrypted: true,
      version: 1,
      profile: { algorithm: 'aes-256-gcm', passwordBinding: 'legacy-profile' },
    })
    await decodeBackupFile(source, restored)
    expect(await fs.readFile(restored)).toEqual(plain)
  })

  it('never publishes plaintext when a binary-v2 backup is tampered', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-backup-tamper-'))
    created.push(root)
    const source = path.join(root, 'source.tar.gz')
    const encrypted = path.join(root, 'encrypted.tar.gz')
    const restored = path.join(root, 'restored.tar.gz')
    await fs.writeFile(source, Buffer.alloc((1024 * 1024) + 13, 0x3c))
    await encodeBackupFile(source, encrypted, {
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
      passwordBinding: 'tamper-profile',
    })
    const inspection = await inspectBackupFile(encrypted)
    const handle = await fs.open(encrypted, 'r+')
    try {
      const offset = Math.floor((inspection.cipherStart + inspection.cipherEnd) / 2)
      const byte = Buffer.alloc(1)
      await handle.read(byte, 0, 1, offset)
      byte[0] ^= 1
      await handle.write(byte, 0, 1, offset)
    } finally {
      await handle.close()
    }
    await fs.writeFile(restored, 'KEEP-OLD')

    await expect(decodeBackupFile(encrypted, restored)).rejects.toMatchObject({
      code: 'DURABLE_ENVELOPE_INVALID',
    })
    expect(await fs.readFile(restored, 'utf8')).toBe('KEEP-OLD')
    expect((await fs.readdir(root)).filter((name) => name.includes('.plain-tmp-'))).toEqual([])
  })

  it('streams a large real SQLite database through seal and unseal', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-sqlite-stream-'))
    created.push(root)
    const source = path.join(root, 'workspace.sqlite')
    const sealed = path.join(root, 'workspace.sqlite.sealed')
    const restored = path.join(root, 'restored.sqlite')
    const database = new Database(source)
    database.exec('CREATE TABLE private_data (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)')
    database.prepare('INSERT INTO private_data (payload) VALUES (zeroblob(?))').run(4 * 1024 * 1024)
    database.close()
    const key = '44'.repeat(32)

    await sealSqliteFile(source, sealed, key, 'chacha20-poly1305')
    await fs.rm(source, { force: true })
    await unsealSqliteFile(sealed, restored, key)

    const opened = new Database(restored, { readonly: true })
    expect(opened.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(opened.prepare('SELECT COUNT(*) AS count, SUM(length(payload)) AS bytes FROM private_data').get())
      .toEqual({ count: 1, bytes: 4 * 1024 * 1024 })
    opened.close()
    expect((await fs.readdir(root)).filter((name) => name.includes('.tmp-') || name.includes('.previous-')))
      .toEqual([])
  })

  it('cleans only stale, strictly named unpublished backup artifacts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-backup-cleanup-'))
    created.push(root)
    const staleFile = path.join(root, 'phd-atlas-backup-old.tar.gz.tmp-987654321-456')
    const staleDirectory = path.join(root, '.restore-workspace-987654321-456')
    const freshFile = path.join(root, 'phd-atlas-app-fresh.json.tmp-987654321-789')
    const published = path.join(root, 'phd-atlas-backup-valid.tar.gz')
    const interruptedPrevious = path.join(root, 'phd-atlas-backup-recover.tar.gz.previous-987654321-100')
    const recovered = path.join(root, 'phd-atlas-backup-recover.tar.gz')
    const nearMiss = path.join(root, 'phd-atlas-backup-valid.tar.gz.tmp-not-managed')
    const sidecar = `${published}.meta`
    await fs.writeFile(staleFile, 'stale')
    await fs.mkdir(staleDirectory)
    await fs.writeFile(path.join(staleDirectory, 'plain'), 'stale')
    await fs.writeFile(freshFile, 'fresh')
    await fs.writeFile(published, 'published')
    await fs.writeFile(interruptedPrevious, 'authenticated-previous')
    await fs.writeFile(nearMiss, 'near-miss')
    await fs.writeFile(sidecar, 'metadata')
    const now = Date.now() + (60 * 60 * 1000)
    const freshTime = new Date(now - 1000)
    await fs.utimes(freshFile, freshTime, freshTime)

    expect(await cleanupInterruptedBackupArtifacts({
      rootPath: root,
      now,
      staleAfterMs: 15 * 60 * 1000,
    })).toBe(3)
    await expect(fs.stat(staleFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(staleDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(freshFile)).resolves.toBeDefined()
    await expect(fs.stat(published)).resolves.toBeDefined()
    expect(await fs.readFile(recovered, 'utf8')).toBe('authenticated-previous')
    await expect(fs.stat(nearMiss)).resolves.toBeDefined()
    await expect(fs.stat(sidecar)).resolves.toBeDefined()
  })
})
