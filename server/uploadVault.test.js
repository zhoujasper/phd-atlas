import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createUploadVault,
  UploadVaultError,
  uploadEncryptionPolicy,
  uploadVaultFormat,
} from './uploadVault.js'

const scratchRoot = path.resolve('logs/tmp/upload-vault-tests')
const testRoots = new Set()

const aesPolicy = {
  encryptionAtRest: true,
  encryptionAlgorithm: 'aes-256-gcm',
  passwordBinding: 'admin-password-verifier-a',
}

const chachaPolicy = {
  encryptionAtRest: true,
  encryptionAlgorithm: 'chacha20-poly1305',
  passwordBinding: 'admin-password-verifier-b',
}

beforeAll(async () => {
  await fs.mkdir(scratchRoot, { recursive: true })
})

afterEach(async () => {
  await Promise.all([...testRoots].map((target) => fs.rm(target, { recursive: true, force: true })))
  testRoots.clear()
})

async function testRoot(label) {
  const root = await fs.mkdtemp(path.join(scratchRoot, `${label}-`))
  testRoots.add(root)
  return root
}

async function raw(root, name) {
  return fs.readFile(path.join(root, name))
}

async function names(root) {
  return (await fs.readdir(root)).sort()
}

function multerStore(storage, file) {
  return new Promise((resolve, reject) => {
    storage._handleFile({}, file, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

describe('upload vault', () => {
  it.each([
    ['AES-256-GCM', aesPolicy],
    ['ChaCha20-Poly1305', chachaPolicy],
  ])('writes %s ciphertext and returns authenticated plaintext only in memory', async (_label, policy) => {
    const root = await testRoot('roundtrip')
    const vault = createUploadVault({ root, policyProvider: () => policy })
    const plain = Buffer.from('private application attachment\0with binary bytes\xff', 'latin1')

    await vault.writeBuffer('proposal.pdf', plain)

    const disk = await raw(root, 'proposal.pdf')
    expect(disk.subarray(0, Buffer.byteLength(uploadVaultFormat.magic)).toString('utf8')).toBe(uploadVaultFormat.magic)
    expect(disk.includes(plain)).toBe(false)
    await expect(vault.readBuffer('proposal.pdf')).resolves.toEqual(plain)
    await expect(vault.readPrefix('proposal.pdf', 7)).resolves.toEqual(plain.subarray(0, 7))
    await expect(vault.inspect('proposal.pdf')).resolves.toMatchObject({
      encrypted: true,
      algorithm: policy.encryptionAlgorithm,
      passwordBound: true,
      size: plain.length,
    })
  })

  it.each([
    ['authenticated metadata', (disk) => {
      const offset = disk.indexOf(Buffer.from('admin-password-verifier-a'))
      if (offset < 0) throw new Error('Expected password-bound metadata in test envelope.')
      disk[offset] ^= 0x01
    }],
    ['ciphertext', (disk) => { disk[disk.length - 17] ^= 0xff }],
    ['authentication tag', (disk) => { disk[disk.length - 1] ^= 0xff }],
  ])('fails closed when %s is modified', async (_part, mutate) => {
    const root = await testRoot('tamper')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await vault.writeBuffer('cv.docx', Buffer.from('confidential cv content'))
    const disk = await raw(root, 'cv.docx')
    mutate(disk)
    await fs.writeFile(path.join(root, 'cv.docx'), disk)

    await expect(vault.readBuffer('cv.docx')).rejects.toMatchObject({
      code: 'UPLOAD_AUTHENTICATION_FAILED',
    })
  })

  it('fails closed for every damaged magic byte and for an unknown envelope signature', async () => {
    const root = await testRoot('magic-tamper')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await vault.writeBuffer('original.bin', Buffer.from('authenticated private upload'))
    const disk = await raw(root, 'original.bin')
    const magicLength = Buffer.byteLength(uploadVaultFormat.magic)

    for (let index = 0; index < magicLength; index += 1) {
      const tampered = Buffer.from(disk)
      tampered[index] ^= 0xff
      const name = `magic-byte-${index}.bin`
      await fs.writeFile(path.join(root, name), tampered)
      await expect(vault.readBuffer(name)).rejects.toMatchObject({
        code: 'UPLOAD_ENVELOPE_MAGIC_INVALID',
      })
    }

    const unknown = Buffer.from(disk)
    unknown.fill(0x58, 0, magicLength)
    await fs.writeFile(path.join(root, 'unknown-magic.bin'), unknown)
    await expect(vault.readBuffer('unknown-magic.bin')).rejects.toMatchObject({
      code: 'UPLOAD_ENVELOPE_MAGIC_INVALID',
    })
  })

  it('still recognizes genuine headerless legacy plaintext', async () => {
    const root = await testRoot('legacy-discriminator')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const legacy = Buffer.from('PHDUPLOAD legacy document without a versioned envelope header')
    await fs.writeFile(path.join(root, 'legacy.txt'), legacy)

    await expect(vault.readBuffer('legacy.txt')).resolves.toEqual(legacy)
    await vault.migrate(aesPolicy)
    await expect(vault.readBuffer('legacy.txt')).resolves.toEqual(legacy)
    await expect(vault.inspect('legacy.txt')).resolves.toMatchObject({ encrypted: true })
  })

  it('enforces a decrypted byte ceiling before returning mail or download buffers', async () => {
    const root = await testRoot('decrypted-byte-limit')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await vault.writeBuffer('large.bin', Buffer.from('123456'))

    await expect(vault.readBuffer('large.bin', { maxBytes: 5 })).rejects.toMatchObject({
      code: 'UPLOAD_DECRYPTED_SIZE_LIMIT',
    })
    await expect(vault.asMailAttachment('large.bin', { maxBytes: 5 })).rejects.toMatchObject({
      code: 'UPLOAD_DECRYPTED_SIZE_LIMIT',
    })
    await expect(vault.readBuffer('large.bin', { maxBytes: 6 })).resolves.toEqual(Buffer.from('123456'))
  })

  it('can hold an exclusive vault boundary around workspace backup operations', async () => {
    const root = await testRoot('exclusive-operation')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const exclusive = vault.withExclusive(async ({ root: lockedRoot }) => {
      expect(lockedRoot).toBe(path.resolve(root))
      await gate
    })
    let writeFinished = false
    const write = vault.writeBuffer('queued.bin', Buffer.from('queued')).then(() => { writeFinished = true })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writeFinished).toBe(false)
    release()
    await exclusive
    await write
    expect(writeFinished).toBe(true)
  })

  it('provides a Multer storage engine that never commits plaintext to the final upload path', async () => {
    const root = await testRoot('multer')
    const vault = createUploadVault({ root, policyProvider: () => chachaPolicy })
    const storage = vault.multerStorage({ filename: () => 'stored-letter.pdf' })
    const plain = Buffer.from('%PDF- recommendation letter')

    const stored = await multerStore(storage, {
      originalname: 'letter.pdf',
      mimetype: 'application/pdf',
      stream: Readable.from([plain.subarray(0, 7), plain.subarray(7)]),
    })

    expect(stored).toMatchObject({
      filename: 'stored-letter.pdf',
      size: plain.length,
      encryptedAtRest: true,
    })
    expect((await raw(root, 'stored-letter.pdf')).includes(plain)).toBe(false)
    await expect(vault.readBuffer('stored-letter.pdf')).resolves.toEqual(plain)
  })

  it('writes only ciphertext to the temporary artifact while a Multer upload is still in progress', async () => {
    const root = await testRoot('multer-in-flight')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const storage = vault.multerStorage({ filename: () => 'in-flight.pdf' })
    const first = Buffer.from(`%PDF-${'PRIVATE-IN-FLIGHT-CONTENT-'.repeat(128)}`)
    const second = Buffer.from('upload-complete')
    let release
    let markFirstConsumed
    const gate = new Promise((resolve) => { release = resolve })
    const firstConsumed = new Promise((resolve) => { markFirstConsumed = resolve })
    const stream = Readable.from((async function * source() {
      yield first
      markFirstConsumed()
      await gate
      yield second
    })())

    const storing = multerStore(storage, {
      originalname: 'in-flight.pdf',
      mimetype: 'application/pdf',
      stream,
    })
    try {
      await firstConsumed
      const temporary = await raw(root, '.in-flight.pdf.vault-next')
      expect(temporary.includes(first)).toBe(false)
      expect(temporary.subarray(0, Buffer.byteLength(uploadVaultFormat.magic)).toString('utf8')).toBe(uploadVaultFormat.magic)
    } finally {
      release()
    }
    await storing
    await expect(vault.readBuffer('in-flight.pdf')).resolves.toEqual(Buffer.concat([first, second]))
  })

  it('selects a queued Multer upload policy only after earlier vault operations finish', async () => {
    const root = await testRoot('queued-policy')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const storage = vault.multerStorage({
      filename: () => 'queued.pdf',
      policy: () => activePolicy,
    })
    let activePolicy = aesPolicy
    let release
    let markBlocked
    const gate = new Promise((resolve) => { release = resolve })
    const blocked = new Promise((resolve) => { markBlocked = resolve })
    const blocker = vault.writeStream('blocker.bin', Readable.from((async function * source() {
      markBlocked()
      await gate
      yield Buffer.from('blocker')
    })()), aesPolicy)
    await blocked

    const storing = multerStore(storage, {
      originalname: 'queued.pdf',
      mimetype: 'application/pdf',
      stream: Readable.from([Buffer.from('%PDF-queued')]),
    })
    activePolicy = chachaPolicy
    release()
    await Promise.all([blocker, storing])

    await expect(vault.inspect('queued.pdf')).resolves.toMatchObject({
      encrypted: true,
      algorithm: 'chacha20-poly1305',
    })
  })

  it('lets authenticated upload middleware select the policy from the request', async () => {
    const root = await testRoot('request-policy')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const storage = vault.multerStorage({
      filename: () => 'request-policy.pdf',
      policy: (request) => request.encryptionPolicy,
    })
    const plain = Buffer.from('%PDF- request-scoped policy')

    await new Promise((resolve, reject) => {
      storage._handleFile(
        { encryptionPolicy: aesPolicy },
        {
          originalname: 'request.pdf',
          mimetype: 'application/pdf',
          stream: Readable.from([plain]),
        },
        (error, result) => error ? reject(error) : resolve(result),
      )
    })

    await expect(vault.inspect('request-policy.pdf')).resolves.toMatchObject({
      encrypted: true,
      algorithm: 'aes-256-gcm',
    })
  })

  it('returns Nodemailer content as a Buffer rather than a plaintext disk path', async () => {
    const root = await testRoot('mail')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await vault.writeBuffer('mail-file', Buffer.from('email attachment'))

    const attachment = await vault.asMailAttachment('mail-file', {
      filename: 'cv.pdf',
      contentType: 'application/pdf',
    })

    expect(attachment).toEqual({
      filename: 'cv.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('email attachment'),
    })
    expect(attachment).not.toHaveProperty('path')
  })

  it('migrates legacy plaintext to AES and then to ChaCha with a new password binding', async () => {
    const root = await testRoot('migration')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const first = Buffer.from('first private file')
    const second = Buffer.from('second private file')
    await fs.writeFile(path.join(root, 'first.pdf'), first)
    await fs.writeFile(path.join(root, 'second.docx'), second)

    await vault.migrate(aesPolicy)
    expect((await raw(root, 'first.pdf')).includes(first)).toBe(false)
    await expect(vault.inspect('first.pdf')).resolves.toMatchObject({ algorithm: 'aes-256-gcm' })

    await vault.migrate(chachaPolicy)
    await expect(vault.inspect('first.pdf')).resolves.toMatchObject({ algorithm: 'chacha20-poly1305' })
    await expect(vault.readBuffer('first.pdf')).resolves.toEqual(first)
    await expect(vault.readBuffer('second.docx')).resolves.toEqual(second)

    expect(await names(root)).toEqual(['first.pdf', 'second.docx'])
  })

  it('keeps uploads encrypted when the broader at-rest setting is disabled', async () => {
    const root = await testRoot('always-encrypted')
    const plain = Buffer.from('uploads remain private when database encryption is disabled')
    const disabledGlobalPolicy = uploadEncryptionPolicy({
      encryptionAtRest: false,
      encryptionAlgorithm: 'chacha20-poly1305',
      encryptionPasswordEnabled: false,
    })
    expect(disabledGlobalPolicy.encryptionAtRest).toBe(true)

    const vault = createUploadVault({ root, policyProvider: () => disabledGlobalPolicy })
    await vault.writeBuffer('always-private.pdf', plain, {
      ...disabledGlobalPolicy,
      encryptionAtRest: false,
    })
    await vault.migrate(disabledGlobalPolicy)

    expect((await raw(root, 'always-private.pdf')).includes(plain)).toBe(false)
    await expect(vault.inspect('always-private.pdf')).resolves.toMatchObject({
      encrypted: true,
      algorithm: 'chacha20-poly1305',
    })
    await expect(vault.readBuffer('always-private.pdf')).resolves.toEqual(plain)
  })

  it.each([
    'after-next-written',
    'after-original-moved',
    'after-next-promoted',
    'after-previous-removed',
  ])('resumes safely after an interruption at %s', async (failurePhase) => {
    const root = await testRoot('resume')
    const original = Buffer.from('never lose this application document')
    await fs.writeFile(path.join(root, 'document.pdf'), original)

    let interrupted = false
    const crashingVault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      migrationHook(phase) {
        if (!interrupted && phase === failurePhase) {
          interrupted = true
          const error = new Error('simulated server termination')
          error.code = 'UPLOAD_VAULT_SIMULATED_CRASH'
          throw error
        }
      },
    })
    await expect(crashingVault.migrate(aesPolicy)).rejects.toThrow('simulated server termination')

    const resumedVault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await resumedVault.migrate(aesPolicy)
    await expect(resumedVault.readBuffer('document.pdf')).resolves.toEqual(original)
    await expect(resumedVault.inspect('document.pdf')).resolves.toMatchObject({
      encrypted: true,
      algorithm: 'aes-256-gcm',
    })
    expect((await names(root)).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('promotes an authenticated orphan .vault-next from a brand-new upload and re-keys it', async () => {
    const root = await testRoot('new-upload-orphan')
    const plain = Buffer.from('brand-new upload survives before its first target promotion')
    const stagingVault = createUploadVault({ root, policyProvider: () => chachaPolicy })
    await stagingVault.writeBuffer('staged.bin', plain, chachaPolicy)
    await fs.rename(
      path.join(root, 'staged.bin'),
      path.join(root, '.recovered.bin.vault-next'),
    )

    const resumedVault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await expect(resumedVault.migrate(aesPolicy)).resolves.toMatchObject({
      encryptionAlgorithm: 'aes-256-gcm',
    })
    await expect(resumedVault.readBuffer('recovered.bin')).resolves.toEqual(plain)
    await expect(resumedVault.inspect('recovered.bin')).resolves.toMatchObject({
      encrypted: true,
      algorithm: 'aes-256-gcm',
    })
    expect(await names(root)).toEqual(['recovered.bin'])
  })

  it('removes a partial or magic-damaged orphan .vault-next without failing startup', async () => {
    const root = await testRoot('new-upload-corrupt-orphan')
    const stagingVault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await stagingVault.writeBuffer('staged.bin', Buffer.from('never expose a damaged staged upload'))
    const damaged = await raw(root, 'staged.bin')
    damaged[0] ^= 0xff
    await fs.writeFile(path.join(root, '.damaged.bin.vault-next'), damaged)
    await fs.writeFile(path.join(root, '.partial.bin.vault-next'), Buffer.from('partial plaintext bytes'))
    await fs.rm(path.join(root, 'staged.bin'))

    const resumedVault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await expect(resumedVault.migrate(aesPolicy)).resolves.toMatchObject({ migrated: 0 })
    await expect(resumedVault.exists('damaged.bin')).resolves.toBe(false)
    await expect(resumedVault.exists('partial.bin')).resolves.toBe(false)
    expect(await names(root)).toEqual([])
  })

  it('keeps the original readable when replacement verification cannot authenticate', async () => {
    const root = await testRoot('rollback')
    const original = Buffer.from('original upload remains recoverable')
    await fs.writeFile(path.join(root, 'safe.txt'), original)

    const nextPath = path.join(root, '.safe.txt.vault-next')
    await fs.writeFile(nextPath, Buffer.from(`${uploadVaultFormat.magic}corrupt`))
    const recovered = createUploadVault({ root, policyProvider: () => aesPolicy })
    await recovered.migrate(aesPolicy)

    await expect(recovered.readBuffer('safe.txt')).resolves.toEqual(original)
  })

  it('restores the authenticated previous artifact when an interrupted promoted target is corrupt', async () => {
    const root = await testRoot('corrupt-promoted-target')
    const original = Buffer.from('previous artifact survives a damaged promoted target')
    await fs.writeFile(path.join(root, 'recover.pdf'), original)

    const crashingVault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      migrationHook(phase) {
        if (phase !== 'after-next-promoted') return
        const error = new Error('simulated server termination')
        error.code = 'UPLOAD_VAULT_SIMULATED_CRASH'
        throw error
      },
    })
    await expect(crashingVault.migrate(aesPolicy)).rejects.toThrow('simulated server termination')
    const target = await raw(root, 'recover.pdf')
    target[target.length - 1] ^= 0xff
    await fs.writeFile(path.join(root, 'recover.pdf'), target)

    const recovered = createUploadVault({ root, policyProvider: () => aesPolicy })
    await recovered.migrate(aesPolicy)
    await expect(recovered.readBuffer('recover.pdf')).resolves.toEqual(original)
    await expect(recovered.inspect('recover.pdf')).resolves.toMatchObject({
      encrypted: true,
      algorithm: 'aes-256-gcm',
    })
  })

  it('rejects storage-name traversal and never reads outside the configured root', async () => {
    const root = await testRoot('path')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await expect(vault.readBuffer('../secret.txt')).rejects.toBeInstanceOf(UploadVaultError)
    await expect(vault.writeBuffer('nested/secret.txt', Buffer.from('x'))).rejects.toMatchObject({
      code: 'UPLOAD_NAME_INVALID',
    })
  })
})
