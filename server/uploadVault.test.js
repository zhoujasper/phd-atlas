import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
  it('uses 512 MB-safe defaults and accepts bounded environment overrides', async () => {
    const root = await testRoot('capacity-configuration')
    const environmentNames = [
      'PHD_ATLAS_UPLOAD_IO_MAX_CONCURRENT',
      'PHD_ATLAS_UPLOAD_IO_MAX_QUEUED',
      'PHD_ATLAS_UPLOAD_IO_MAX_IN_FLIGHT_BYTES',
      'PHD_ATLAS_UPLOAD_IO_MAX_QUEUED_BYTES',
      'PHD_ATLAS_UPLOAD_IO_WAIT_MS',
      'PHD_ATLAS_UPLOAD_MIGRATION_LOCK_WAIT_MS',
      'PHD_ATLAS_UPLOAD_MAX_FILE_BYTES',
    ]
    const prior = new Map(environmentNames.map((name) => [name, process.env[name]]))
    try {
      for (const name of environmentNames) delete process.env[name]
      const defaults = createUploadVault({ root }).capacity().limits
      expect(defaults).toMatchObject({
        maxConcurrent: 2,
        maxQueued: 64,
        maxInFlightBytes: 32 * 1024 * 1024,
        maxQueuedBytes: 64 * 1024 * 1024,
        queueTimeoutMs: 20_000,
        migrationLockTimeoutMs: 20_000,
        maxSingleFileBytes: 25 * 1024 * 1024,
      })

      process.env.PHD_ATLAS_UPLOAD_IO_MAX_CONCURRENT = '2'
      process.env.PHD_ATLAS_UPLOAD_IO_MAX_QUEUED = '40'
      process.env.PHD_ATLAS_UPLOAD_IO_MAX_IN_FLIGHT_BYTES = String(48 * 1024 * 1024)
      process.env.PHD_ATLAS_UPLOAD_IO_MAX_QUEUED_BYTES = String(80 * 1024 * 1024)
      process.env.PHD_ATLAS_UPLOAD_IO_WAIT_MS = '12000'
      process.env.PHD_ATLAS_UPLOAD_MIGRATION_LOCK_WAIT_MS = '9000'
      process.env.PHD_ATLAS_UPLOAD_MAX_FILE_BYTES = String(20 * 1024 * 1024)
      expect(createUploadVault({ root }).capacity().limits).toMatchObject({
        maxConcurrent: 2,
        maxQueued: 40,
        maxInFlightBytes: 48 * 1024 * 1024,
        maxQueuedBytes: 80 * 1024 * 1024,
        queueTimeoutMs: 12_000,
        migrationLockTimeoutMs: 9_000,
        maxSingleFileBytes: 20 * 1024 * 1024,
      })
    } finally {
      for (const [name, value] of prior) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

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

  it('keeps mail attachments encrypted in recoverable stages until atomic promotion', async () => {
    const root = await testRoot('mail-stage-promotion')
    const firstProcess = createUploadVault({ root, policyProvider: () => aesPolicy })
    const plain = Buffer.from('durable inbound mail attachment')
    const staged = await firstProcess.stageMailBuffer('mail-final.pdf', plain)

    expect(staged.storageName).toBe('mail-final.pdf')
    expect(staged.stageName).toMatch(/^\.mail-stage-v1-/)
    await expect(firstProcess.exists('mail-final.pdf')).resolves.toBe(false)
    expect(await firstProcess.listMailStages()).toEqual([staged])
    expect((await raw(root, staged.stageName)).includes(plain)).toBe(false)

    // A fresh vault instance models restart after the DB commit but before the
    // rename. It can discover and atomically promote the still-encrypted stage.
    const restarted = createUploadVault({ root, policyProvider: () => aesPolicy })
    await expect(
      restarted.promoteMailStage(staged.stageName, staged.storageName),
    ).resolves.toMatchObject({ created: true, storageName: 'mail-final.pdf' })
    await expect(restarted.readBuffer('mail-final.pdf')).resolves.toEqual(plain)
    await expect(restarted.listMailStages()).resolves.toEqual([])
  })

  it('authenticates before exposing a chunked read stream and releases vault I/O during a slow consumer', async () => {
    const root = await testRoot('stream-roundtrip')
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: { chunkBytes: 64 * 1024 },
    })
    const plain = Buffer.from('private-stream-content-'.repeat(40_000))
    await vault.writeBuffer('large-private.bin', plain)

    let releaseConsumer
    let markConsumerStarted
    const consumerGate = new Promise((resolve) => { releaseConsumer = resolve })
    const consumerStarted = new Promise((resolve) => { markConsumerStarted = resolve })
    const progress = []
    const download = vault.withReadStream('large-private.bin', {
      onProgress: (bytes, details) => progress.push({ bytes, phase: details.phase }),
    }, async (stream, metadata) => {
      expect(metadata).toMatchObject({ size: plain.length, encrypted: true })
      const chunks = []
      let first = true
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk))
        if (first) {
          first = false
          markConsumerStarted()
          await consumerGate
        }
      }
      return Buffer.concat(chunks)
    })

    await consumerStarted
    for (let attempt = 0; attempt < 50 && vault.capacity().active !== 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(vault.capacity()).toMatchObject({
      active: 0,
      activeBytes: 0,
    })
    releaseConsumer()
    await expect(download).resolves.toEqual(plain)
    expect(progress.some((entry) => entry.phase === 'verify' && entry.bytes > 0)).toBe(true)
    expect(progress.some((entry) => entry.phase === 'stream' && entry.bytes > 0)).toBe(true)
  })

  it('rejects a damaged encrypted stream before invoking its network consumer', async () => {
    const root = await testRoot('stream-tamper')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    await vault.writeBuffer('tampered.bin', Buffer.from('authenticated stream payload'))
    const disk = await raw(root, 'tampered.bin')
    disk[disk.length - 1] ^= 0xff
    await fs.writeFile(path.join(root, 'tampered.bin'), disk)
    const consumer = vi.fn()

    await expect(vault.withReadStream('tampered.bin', consumer)).rejects.toMatchObject({
      code: 'UPLOAD_AUTHENTICATION_FAILED',
    })
    expect(consumer).not.toHaveBeenCalled()
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

  it('keeps Multer uploads readable from encrypted stages until durable promotion', async () => {
    const root = await testRoot('multer-durable-stage')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const storage = vault.multerStorage({
      filename: () => 'durable-letter.pdf',
      staged: true,
    })
    const plain = Buffer.from('%PDF- durable staged recommendation')
    const stored = await multerStore(storage, {
      originalname: 'letter.pdf',
      mimetype: 'application/pdf',
      stream: Readable.from([plain]),
    })

    expect(stored).toMatchObject({ filename: 'durable-letter.pdf', size: plain.length })
    expect(stored.stagedFilename).toMatch(/^\.upload-stage-v1-/)
    await expect(fs.stat(path.join(root, 'durable-letter.pdf'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await raw(root, stored.stagedFilename)).includes(plain)).toBe(false)
    await expect(vault.readBuffer(stored.filename)).resolves.toEqual(plain)
    await expect(vault.inspect(stored.filename)).resolves.toMatchObject({ size: plain.length, encrypted: true })
    await expect(vault.listUploadStages()).resolves.toEqual([{
      stageName: stored.stagedFilename,
      storageName: stored.filename,
    }])

    await expect(vault.promoteUploadStage(stored.stagedFilename, stored.filename))
      .resolves.toMatchObject({ created: true, storageName: stored.filename })
    await expect(vault.listUploadStages()).resolves.toEqual([])
    await expect(vault.readBuffer(stored.filename)).resolves.toEqual(plain)
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

  it('serializes migrations from separate vault instances that share one root', async () => {
    const root = await testRoot('concurrent-migration')
    await fs.writeFile(path.join(root, 'document.pdf'), Buffer.from('shared migration input'))

    let releaseFirstMigration
    const firstMigrationBlocked = new Promise((resolve) => {
      releaseFirstMigration = resolve
    })
    let firstMigrationEntered
    const firstMigrationReady = new Promise((resolve) => {
      firstMigrationEntered = resolve
    })
    const firstVault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      async migrationHook(phase) {
        if (phase !== 'after-next-written') return
        firstMigrationEntered()
        await firstMigrationBlocked
      },
    })
    const secondVault = createUploadVault({ root, policyProvider: () => aesPolicy })

    const first = firstVault.migrate(aesPolicy)
    await firstMigrationReady
    let secondFinished = false
    const second = secondVault.migrate(aesPolicy).then((result) => {
      secondFinished = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(secondFinished).toBe(false)

    releaseFirstMigration()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    await expect(secondVault.readBuffer('document.pdf')).resolves.toEqual(Buffer.from('shared migration input'))
    expect((await names(root)).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('times out behind an active migration owner without deleting its lock or leaking the exclusive slot', async () => {
    const root = await testRoot('migration-lock-timeout')
    await fs.writeFile(path.join(root, 'document.pdf'), Buffer.from('active migration owner'))
    let releaseFirstMigration
    const firstMigrationGate = new Promise((resolve) => { releaseFirstMigration = resolve })
    let markFirstMigrationReady
    const firstMigrationReady = new Promise((resolve) => { markFirstMigrationReady = resolve })
    const firstVault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      async migrationHook(phase) {
        if (phase !== 'after-next-written') return
        markFirstMigrationReady()
        await firstMigrationGate
      },
    })
    const waitingVault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: { migrationLockTimeoutMs: 80 },
    })
    const first = firstVault.migrate(aesPolicy)
    await firstMigrationReady
    const ownerPath = path.join(root, '.upload-vault-migration.lock', 'owner.json')
    const ownerBeforeTimeout = await fs.readFile(ownerPath, 'utf8')

    try {
      await expect(waitingVault.migrate(aesPolicy)).rejects.toMatchObject({
        code: 'UPLOAD_MIGRATION_LOCK_TIMEOUT',
        status: 503,
        retryAfterSeconds: 1,
        retryable: true,
      })
      await expect(fs.readFile(ownerPath, 'utf8')).resolves.toBe(ownerBeforeTimeout)
      expect(waitingVault.capacity()).toMatchObject({
        active: 0,
        exclusiveActive: false,
        queued: 0,
      })
      await expect(waitingVault.withExclusive(() => 'exclusive-slot-released')).resolves.toBe('exclusive-slot-released')
    } finally {
      releaseFirstMigration()
      await first
    }

    await expect(waitingVault.migrate(aesPolicy, { lockTimeoutMs: 5_000 })).resolves.toMatchObject({
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
    })
    expect(waitingVault.capacity()).toMatchObject({ exclusiveActive: false, queued: 0 })
  })

  it('aborts migration-lock waiting, cleans listeners, and permits later exclusive work', async () => {
    const root = await testRoot('migration-lock-abort')
    await fs.writeFile(path.join(root, 'document.pdf'), Buffer.from('abort lock waiter'))
    let releaseFirstMigration
    const firstMigrationGate = new Promise((resolve) => { releaseFirstMigration = resolve })
    let markFirstMigrationReady
    const firstMigrationReady = new Promise((resolve) => { markFirstMigrationReady = resolve })
    const firstVault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      async migrationHook(phase) {
        if (phase !== 'after-next-written') return
        markFirstMigrationReady()
        await firstMigrationGate
      },
    })
    const waitingVault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const first = firstVault.migrate(aesPolicy)
    await firstMigrationReady
    const ownerPath = path.join(root, '.upload-vault-migration.lock', 'owner.json')
    const ownerBeforeAbort = await fs.readFile(ownerPath, 'utf8')
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const waiting = waitingVault.migrate(aesPolicy, {
      signal: controller.signal,
      lockTimeoutMs: 5_000,
    })

    try {
      for (let attempt = 0; attempt < 100 && !waitingVault.capacity().exclusiveActive; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      expect(waitingVault.capacity().exclusiveActive).toBe(true)
      controller.abort(new Error('test cancellation'))
      await expect(waiting).rejects.toMatchObject({
        code: 'UPLOAD_CANCELLED',
        status: 499,
        retryable: true,
      })
      await expect(fs.readFile(ownerPath, 'utf8')).resolves.toBe(ownerBeforeAbort)
      expect(removeListener.mock.calls.some(([eventName]) => eventName === 'abort')).toBe(true)
      expect(waitingVault.capacity()).toMatchObject({
        active: 0,
        exclusiveActive: false,
        queued: 0,
      })
      await expect(waitingVault.withExclusive(() => 'available-after-abort')).resolves.toBe('available-after-abort')
    } finally {
      releaseFirstMigration()
      await first
    }
  })

  it('cooperatively aborts after acquiring the migration lock and recovers the interrupted file', async () => {
    const root = await testRoot('migration-in-flight-abort')
    const plain = Buffer.from('recoverable in-flight cancellation')
    await fs.writeFile(path.join(root, 'document.pdf'), plain)
    let releaseMigrationHook
    const migrationHookGate = new Promise((resolve) => { releaseMigrationHook = resolve })
    let markDestructivePhase
    const destructivePhase = new Promise((resolve) => { markDestructivePhase = resolve })
    const controller = new AbortController()
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      async migrationHook(phase) {
        if (phase !== 'after-original-moved') return
        markDestructivePhase()
        await migrationHookGate
      },
    })
    const migrating = vault.migrate(aesPolicy, {
      signal: controller.signal,
      lockTimeoutMs: 5_000,
    })

    await destructivePhase
    controller.abort(new Error('cancel in-flight migration'))
    releaseMigrationHook()
    await expect(migrating).rejects.toMatchObject({
      code: 'UPLOAD_CANCELLED',
      status: 499,
      retryable: true,
    })
    expect(vault.capacity()).toMatchObject({ exclusiveActive: false, queued: 0 })
    await expect(vault.withExclusive(() => 'slot-available')).resolves.toBe('slot-available')

    await expect(vault.migrate(aesPolicy)).resolves.toMatchObject({
      encryptionAtRest: true,
      encryptionAlgorithm: 'aes-256-gcm',
    })
    await expect(vault.readBuffer('document.pdf')).resolves.toEqual(plain)
    expect((await names(root)).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('lets only one waiter reclaim a dead lock and preserves the live replacement owner', async () => {
    const root = await testRoot('migration-lock-concurrent-reclaim')
    await fs.writeFile(path.join(root, 'document.pdf'), Buffer.from('concurrent stale-lock recovery'))
    const lockDirectory = path.join(root, '.upload-vault-migration.lock')
    await fs.mkdir(lockDirectory)
    await fs.writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
      processId: 2_147_483_647,
      token: 'dead-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    }))
    let releaseLiveOwner
    const liveOwnerGate = new Promise((resolve) => { releaseLiveOwner = resolve })
    let markLiveOwnerEntered
    const liveOwnerEntered = new Promise((resolve) => { markLiveOwnerEntered = resolve })
    let entered = 0
    const createWaiter = () => createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: { migrationLockTimeoutMs: 5_000 },
      async migrationHook(phase) {
        if (phase !== 'after-next-written') return
        entered += 1
        if (entered === 1) markLiveOwnerEntered()
        await liveOwnerGate
      },
    })
    const firstVault = createWaiter()
    const secondVault = createWaiter()
    const migrations = [firstVault.migrate(aesPolicy), secondVault.migrate(aesPolicy)]

    try {
      await liveOwnerEntered
      const ownerPath = path.join(lockDirectory, 'owner.json')
      const liveOwner = await fs.readFile(ownerPath, 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 180))
      expect(entered).toBe(1)
      await expect(fs.readFile(ownerPath, 'utf8')).resolves.toBe(liveOwner)
    } finally {
      releaseLiveOwner()
    }
    await expect(Promise.all(migrations)).resolves.toHaveLength(2)
    expect(entered).toBe(1)
    expect((await names(root)).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('removes a migration lock left by a terminated process before startup recovery', async () => {
    const root = await testRoot('abandoned-migration-lock')
    await fs.writeFile(path.join(root, 'document.pdf'), Buffer.from('recover after terminated migration'))
    const lockDirectory = path.join(root, '.upload-vault-migration.lock')
    await fs.mkdir(lockDirectory)
    await fs.writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
      processId: 2_147_483_647,
      token: 'terminated-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    }))

    const recovered = createUploadVault({ root, policyProvider: () => aesPolicy })
    await expect(recovered.migrate(aesPolicy)).resolves.toMatchObject({
      encryptionAlgorithm: 'aes-256-gcm',
    })
    await expect(recovered.readBuffer('document.pdf')).resolves.toEqual(Buffer.from('recover after terminated migration'))
    expect(await names(root)).toEqual(['document.pdf'])
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

  it('completes 100 concurrent small-file writes without corruption or temporary residue', async () => {
    const root = await testRoot('hundred-small-files')
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: {
        maxConcurrent: 8,
        maxQueued: 128,
        maxInFlightBytes: 16 * 1024 * 1024,
        maxQueuedBytes: 128 * 1024 * 1024,
        queueTimeoutMs: 60_000,
      },
    })
    const payloads = Array.from({ length: 100 }, (_, index) => (
      Buffer.from(`%PDF-${String(index).padStart(3, '0')}-${'private-upload-'.repeat(64)}`)
    ))
    const storage = vault.multerStorage({
      filename: (_request, file) => `concurrent-${file.index}.pdf`,
    })

    await Promise.all(payloads.map((payload, index) => (
      multerStore(storage, {
        index,
        originalname: `concurrent-${index}.pdf`,
        mimetype: 'application/pdf',
        stream: Readable.from([payload.subarray(0, 17), payload.subarray(17)]),
      })
    )))
    const restored = await Promise.all(payloads.map((_payload, index) => (
      vault.readBuffer(`concurrent-${index}.pdf`, { maxBytes: payloads[index].length })
    )))

    expect(restored).toEqual(payloads)
    expect(vault.capacity()).toMatchObject({
      active: 0,
      queued: 0,
      rejected: 0,
    })
    expect(vault.capacity().peakActive).toBeLessThanOrEqual(8)
    expect((await names(root)).filter((name) => name.startsWith('.'))).toEqual([])
  }, 90_000)

  it('holds large download leases inside the global in-flight byte ceiling', async () => {
    const root = await testRoot('large-read-capacity')
    const mebibyte = 1024 * 1024
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: {
        maxConcurrent: 8,
        maxQueued: 16,
        maxInFlightBytes: 6 * mebibyte,
        maxQueuedBytes: 32 * mebibyte,
        maxSingleFileBytes: 3 * mebibyte,
      },
    })
    const payload = Buffer.alloc(2 * mebibyte, 0x5a)
    await Promise.all(Array.from({ length: 4 }, (_, index) => (
      vault.writeBuffer(`large-${index}.bin`, payload)
    )))

    let activeConsumers = 0
    let peakConsumers = 0
    let releaseConsumers
    const consumerGate = new Promise((resolve) => { releaseConsumers = resolve })
    const reads = Array.from({ length: 4 }, (_, index) => (
      vault.withReadBuffer(`large-${index}.bin`, { maxBytes: payload.length }, async (content) => {
        activeConsumers += 1
        peakConsumers = Math.max(peakConsumers, activeConsumers)
        expect(content.equals(payload)).toBe(true)
        await consumerGate
        activeConsumers -= 1
      })
    ))

    for (let attempt = 0; attempt < 100 && activeConsumers < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(activeConsumers).toBe(2)
    expect(vault.capacity().activeBytes).toBeLessThanOrEqual(6 * mebibyte)
    releaseConsumers()
    await Promise.all(reads)

    expect(peakConsumers).toBe(2)
    expect(vault.capacity().peakActiveBytes).toBeLessThanOrEqual(6 * mebibyte)
    expect(vault.capacity()).toMatchObject({ active: 0, activeBytes: 0, queued: 0 })
  }, 30_000)

  it('reserves a full read safely when a queued same-key writer replaces a small file', async () => {
    const root = await testRoot('same-key-read-reservation')
    const mebibyte = 1024 * 1024
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: {
        maxConcurrent: 4,
        maxQueued: 16,
        maxInFlightBytes: 4 * mebibyte,
        maxQueuedBytes: 32 * mebibyte,
        maxSingleFileBytes: 3 * mebibyte,
      },
    })
    const storageNames = ['replacement-a.bin', 'replacement-b.bin']
    await Promise.all(storageNames.map((name) => vault.writeBuffer(name, Buffer.from('old'))))

    let releaseExclusive
    const exclusiveGate = new Promise((resolve) => { releaseExclusive = resolve })
    const exclusive = vault.withExclusive(() => exclusiveGate)
    const replacement = Buffer.alloc(2 * mebibyte, 0x6b)
    const writes = storageNames.map((name) => vault.writeBuffer(name, replacement))

    let activeConsumers = 0
    let peakConsumers = 0
    let releaseConsumers
    const consumerGate = new Promise((resolve) => { releaseConsumers = resolve })
    const reads = storageNames.map((name) => vault.withReadBuffer(name, async (content) => {
      expect(content.equals(replacement)).toBe(true)
      activeConsumers += 1
      peakConsumers = Math.max(peakConsumers, activeConsumers)
      await consumerGate
      activeConsumers -= 1
    }))

    releaseExclusive()
    await Promise.all(writes)
    for (let attempt = 0; attempt < 100 && activeConsumers < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(activeConsumers).toBe(1)
    expect(vault.capacity().activeBytes).toBeLessThanOrEqual(4 * mebibyte)
    releaseConsumers()
    await Promise.all([exclusive, ...reads])

    expect(peakConsumers).toBe(1)
    expect(vault.capacity()).toMatchObject({ active: 0, activeBytes: 0, queued: 0 })
  }, 30_000)

  it('rejects excess queued work structurally and releases cancelled admission', async () => {
    const root = await testRoot('bounded-queue')
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: {
        maxConcurrent: 1,
        maxQueued: 2,
        maxInFlightBytes: 4 * 1024 * 1024,
        maxQueuedBytes: 4 * 1024 * 1024,
        queueTimeoutMs: 5_000,
      },
    })
    let releaseExclusive
    const exclusiveGate = new Promise((resolve) => { releaseExclusive = resolve })
    const exclusive = vault.withExclusive(() => exclusiveGate)
    const controller = new AbortController()
    const cancelled = vault.writeBuffer('cancelled.bin', Buffer.from('cancelled'), undefined, {
      signal: controller.signal,
    })
    const retained = vault.writeBuffer('retained.bin', Buffer.from('retained'))

    await expect(vault.writeBuffer('rejected.bin', Buffer.from('rejected'))).rejects.toMatchObject({
      code: 'UPLOAD_VAULT_BUSY',
      status: 503,
      retryAfterSeconds: 1,
      retryable: true,
    })
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' })
    expect(vault.capacity().queued).toBe(1)
    releaseExclusive()
    await Promise.all([exclusive, retained])

    expect(vault.capacity()).toMatchObject({ active: 0, activeBytes: 0, queued: 0, rejected: 1 })
    expect(await names(root)).toEqual(['retained.bin'])
  })

  it('times out queued work without leaking admission or staging files', async () => {
    const root = await testRoot('queue-timeout')
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: {
        maxConcurrent: 1,
        maxQueued: 4,
        maxInFlightBytes: 4 * 1024 * 1024,
        queueTimeoutMs: 50,
      },
    })
    let releaseExclusive
    const exclusiveGate = new Promise((resolve) => { releaseExclusive = resolve })
    const exclusive = vault.withExclusive(() => exclusiveGate)

    await expect(vault.writeBuffer('timed-out.bin', Buffer.from('never staged'))).rejects.toMatchObject({
      code: 'UPLOAD_VAULT_BUSY',
      status: 503,
      retryable: true,
    })
    expect(vault.capacity()).toMatchObject({ active: 0, activeBytes: 0, queued: 0, rejected: 1 })
    expect(await names(root)).toEqual([])
    releaseExclusive()
    await exclusive
  })

  it('cancels an in-flight Multer stream and removes its encrypted staging artifact', async () => {
    const root = await testRoot('multer-abort')
    const vault = createUploadVault({ root, policyProvider: () => aesPolicy })
    const storage = vault.multerStorage({ filename: () => 'aborted.pdf' })
    const request = new EventEmitter()
    request.aborted = false
    let markStarted
    const started = new Promise((resolve) => { markStarted = resolve })
    let releaseSource
    const sourceGate = new Promise((resolve) => { releaseSource = resolve })
    const stream = Readable.from((async function * chunks() {
      yield Buffer.from('%PDF-first-encrypted-chunk')
      markStarted()
      await sourceGate
      yield Buffer.from('must-not-commit')
    })())
    const storing = new Promise((resolve, reject) => {
      storage._handleFile(request, {
        originalname: 'aborted.pdf',
        mimetype: 'application/pdf',
        stream,
      }, (error, result) => error ? reject(error) : resolve(result))
    })

    await started
    request.aborted = true
    request.emit('aborted')
    releaseSource()
    await expect(storing).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' })
    expect(await names(root)).toEqual([])
    expect(vault.capacity()).toMatchObject({ active: 0, activeBytes: 0, queued: 0 })
  })

  it('enforces the vault-level file ceiling and removes an interrupted stream artifact', async () => {
    const root = await testRoot('stream-size-ceiling')
    const vault = createUploadVault({
      root,
      policyProvider: () => aesPolicy,
      ioLimits: {
        maxSingleFileBytes: 5,
        maxInFlightBytes: 1024 * 1024,
      },
    })

    await expect(vault.writeStream(
      'oversized.bin',
      Readable.from([Buffer.from('123'), Buffer.from('456')]),
    )).rejects.toMatchObject({
      code: 'UPLOAD_FILE_TOO_LARGE',
      status: 413,
    })
    expect(await names(root)).toEqual([])
    expect(vault.capacity()).toMatchObject({ active: 0, activeBytes: 0, queued: 0 })
  })

  it('serializes same-name replacements and leaves one complete authenticated file', async () => {
    const root = await testRoot('same-name-replacements')
    const vault = createUploadVault({
      root,
      policyProvider: () => chachaPolicy,
      ioLimits: { maxConcurrent: 8, maxQueued: 32, queueTimeoutMs: 60_000 },
    })
    const payloads = Array.from({ length: 12 }, (_, index) => (
      Buffer.from(`complete-version-${index}-${'x'.repeat(index * 13)}`)
    ))

    await Promise.all(payloads.map((payload) => vault.writeBuffer('shared.bin', payload)))

    await expect(vault.readBuffer('shared.bin')).resolves.toEqual(payloads.at(-1))
    expect(await names(root)).toEqual(['shared.bin'])
  })
})
