import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import {
  decodeBackupPayload,
  decodeExternalStatePayload,
  encodeBackupPayload,
  encodeExternalStatePayload,
} from './durableEnvelope.js'
import { sealSqliteBuffer, unsealSqliteBuffer } from './sqliteSeal.js'

const created = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((target) => fs.rm(target, { force: true })))
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
})
