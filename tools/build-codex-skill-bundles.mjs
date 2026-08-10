import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')

export const DEFAULT_PLUGIN_ROOT = path.join(
  projectRoot,
  'integrations',
  'codex',
  'plugins',
  'phd-atlas',
)
export const DEFAULT_OUTPUT_ROOT = path.join(projectRoot, 'public', 'downloads')

const ARCHIVE_ROOT = 'phd-atlas'
const FIXED_DOS_TIME = 0
const FIXED_DOS_DATE = 0x21 // 1980-01-01, the earliest date representable by ZIP.
const UTF8_FLAG = 0x0800
const STORE_METHOD = 0
const ZIP_VERSION = 20
const UNIX_ZIP_VERSION = (3 << 8) | ZIP_VERSION
const REGULAR_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_ZIP_ENTRIES = 0xfffe
const MAX_ZIP_BYTES = MAX_ARCHIVE_BYTES + (32 * 1024 * 1024)
const ZIP64_UINT32_SENTINEL = 0xffff_ffff

const FORBIDDEN_PATH_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  'node_modules',
])
const FORBIDDEN_SECRET_FILE_NAMES = new Set([
  '.ds_store',
  '.env',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  'accounts.json',
  'auth-state.json',
  'config.json',
  'config.lock',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'session.json',
  'thumbs.db',
  'tokens.json',
])
const FORBIDDEN_SECRET_SUFFIXES = [
  '.cer',
  '.crt',
  '.jks',
  '.key',
  '.kdbx',
  '.keystore',
  '.local',
  '.p12',
  '.pem',
  '.pfx',
  '.ppk',
  '.token',
]
const NORMALIZED_TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const PRIVATE_KEY_MARKER = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/
const WINDOWS_RESERVED_BASENAME = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\..*)?$/i
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb8_8320 : 0)
  }
  return value >>> 0
})

export const BUNDLE_NAMES = Object.freeze({
  skill: 'phd-atlas-codex-skill.zip',
  plugin: 'phd-atlas-codex-plugin.zip',
  claude: 'phd-atlas-claude.mcpb',
})

function pathKey(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved
}

function isSameOrInside(candidate, parent) {
  const candidateKey = pathKey(candidate)
  const parentKey = pathKey(parent)
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}${path.sep}`)
}

function containsControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function assertPortablePathSegment(segment, sourcePath) {
  if (
    segment.endsWith('.')
    || segment.endsWith(' ')
    || /[<>:"|?*]/.test(segment)
    || WINDOWS_RESERVED_BASENAME.test(segment)
  ) {
    throw new Error(`Path is not portable across Windows, macOS, and Linux: ${sourcePath}`)
  }
}

function assertSafeFilesystemName(name, sourcePath) {
  if (
    !name
    || name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')
    || containsControlCharacter(name)
  ) {
    throw new Error(`Unsafe bundle path segment at ${sourcePath}`)
  }
  assertPortablePathSegment(name.normalize('NFC'), sourcePath)
}

function assertNoCredentialPath(relativeSegments, sourcePath) {
  const lowerSegments = relativeSegments.map((segment) => segment.toLocaleLowerCase('en-US'))
  for (const segment of lowerSegments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new Error(`Forbidden generated or repository directory in Codex bundle: ${sourcePath}`)
    }
  }

  const basename = lowerSegments.at(-1) ?? ''
  if (
    FORBIDDEN_SECRET_FILE_NAMES.has(basename)
    || basename.startsWith('.env.')
    || basename.startsWith('credentials.')
    || basename.startsWith('tokens.')
    || FORBIDDEN_SECRET_SUFFIXES.some((suffix) => basename.endsWith(suffix))
  ) {
    throw new Error(`Credential or local configuration file cannot enter a Codex bundle: ${sourcePath}`)
  }
}

function normalizeArchivePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath) {
    throw new Error('ZIP entry path must be a non-empty string')
  }
  const normalized = rawPath.normalize('NFC')
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.includes('\\')
    || containsControlCharacter(normalized)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${rawPath}`)
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`ZIP path traversal is forbidden: ${rawPath}`)
  }
  for (const segment of segments) {
    assertPortablePathSegment(segment, rawPath)
  }
  if (path.posix.normalize(normalized) !== normalized) {
    throw new Error(`Non-canonical ZIP entry path: ${rawPath}`)
  }
  return normalized
}

function normalizeBundleContents(sourcePath, data) {
  if (!NORMALIZED_TEXT_EXTENSIONS.has(path.extname(sourcePath).toLocaleLowerCase('en-US'))) {
    return data
  }
  let text
  try {
    text = utf8Decoder.decode(data)
  } catch {
    throw new Error(`Codex bundle text file is not valid UTF-8: ${sourcePath}`)
  }
  return Buffer.from(text.replace(/\r\n?/g, '\n'), 'utf8')
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
}

async function assertRealDirectory(directory, label) {
  const metadata = await lstat(directory).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${directory}`)
    }
    throw error
  })
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink or special file: ${directory}`)
  }
  return realpath(directory)
}

async function canonicalizePathWithMissingTail(targetPath) {
  let cursor = path.resolve(targetPath)
  const missingSegments = []
  while (true) {
    try {
      return path.join(await realpath(cursor), ...missingSegments.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw error
      missingSegments.push(path.basename(cursor))
      cursor = parent
    }
  }
}

async function collectDirectoryFiles({ sourceRoot, archiveRoot }) {
  const resolvedSourceRoot = path.resolve(sourceRoot)
  const canonicalSourceRoot = await assertRealDirectory(resolvedSourceRoot, 'Codex bundle source')
  const entries = []
  let totalBytes = 0

  async function visit(directory, relativeSegments) {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => compareUtf8(left.name, right.name))

    for (const child of children) {
      assertSafeFilesystemName(child.name, path.join(directory, child.name))
      const nextSegments = [...relativeSegments, child.name]
      const sourcePath = path.join(directory, child.name)
      const metadata = await lstat(sourcePath)
      if (metadata.isSymbolicLink()) {
        throw new Error(`Symbolic links and junctions are forbidden in Codex bundles: ${sourcePath}`)
      }
      if (metadata.isDirectory()) {
        assertNoCredentialPath(nextSegments, sourcePath)
        await visit(sourcePath, nextSegments)
        continue
      }
      if (!metadata.isFile()) {
        throw new Error(`Special files are forbidden in Codex bundles: ${sourcePath}`)
      }

      assertNoCredentialPath(nextSegments, sourcePath)
      if (metadata.size > MAX_ENTRY_BYTES) {
        throw new Error(`Codex bundle file exceeds ${MAX_ENTRY_BYTES} bytes: ${sourcePath}`)
      }
      totalBytes += metadata.size
      if (totalBytes > MAX_ARCHIVE_BYTES) {
        throw new Error(`Codex bundle exceeds ${MAX_ARCHIVE_BYTES} uncompressed bytes`)
      }

      const handle = await open(sourcePath, 'r')
      let sourceData
      try {
        const beforeRead = await handle.stat()
        if (!beforeRead.isFile() || !sameFileSnapshot(metadata, beforeRead)) {
          throw new Error(`Codex bundle file changed before it was read: ${sourcePath}`)
        }
        const canonicalPath = await realpath(sourcePath)
        if (!isSameOrInside(canonicalPath, canonicalSourceRoot)) {
          throw new Error(`Codex bundle file escaped its source root: ${sourcePath}`)
        }
        sourceData = await handle.readFile()
        const afterRead = await handle.stat()
        if (!sameFileSnapshot(beforeRead, afterRead) || sourceData.length !== afterRead.size) {
          throw new Error(`Codex bundle file changed while it was being read: ${sourcePath}`)
        }
      } finally {
        await handle.close()
      }
      const data = normalizeBundleContents(sourcePath, sourceData)
      if (PRIVATE_KEY_MARKER.test(data.toString('utf8'))) {
        throw new Error(`Private key material cannot enter a Codex bundle: ${sourcePath}`)
      }
      const relativePath = nextSegments.map((segment) => segment.normalize('NFC')).join('/')
      entries.push({
        archivePath: normalizeArchivePath(`${archiveRoot}/${relativePath}`),
        data,
      })
    }
  }

  await visit(resolvedSourceRoot, [])
  entries.sort((left, right) => compareUtf8(left.archivePath, right.archivePath))
  if (entries.length === 0) {
    throw new Error(`Codex bundle source is empty: ${sourceRoot}`)
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`Codex bundle contains more than ${MAX_ZIP_ENTRIES} files`)
  }

  const portableNames = new Map()
  for (const entry of entries) {
    const portableKey = entry.archivePath.toLocaleLowerCase('en-US')
    const previous = portableNames.get(portableKey)
    if (previous) {
      throw new Error(`Codex bundle paths collide on case-insensitive filesystems: ${previous} and ${entry.archivePath}`)
    }
    portableNames.set(portableKey, entry.archivePath)
  }
  return entries
}

function crc32(data) {
  let crc = 0xffff_ffff
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

export function createDeterministicZip(rawEntries) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new Error('A ZIP bundle must contain at least one file')
  }
  if (rawEntries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP bundle contains more than ${MAX_ZIP_ENTRIES} files`)
  }

  const entries = rawEntries
    .map((entry) => ({
      archivePath: normalizeArchivePath(entry.archivePath),
      data: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data),
    }))
    .sort((left, right) => compareUtf8(left.archivePath, right.archivePath))
  const seenPaths = new Set()
  const localParts = []
  const centralParts = []
  let localOffset = 0
  let centralSize = 0
  let totalBytes = 0

  for (const entry of entries) {
    const portableKey = entry.archivePath.toLocaleLowerCase('en-US')
    if (seenPaths.has(portableKey)) {
      throw new Error(`Duplicate or case-colliding ZIP entry: ${entry.archivePath}`)
    }
    seenPaths.add(portableKey)
    if (entry.data.length > MAX_ENTRY_BYTES) {
      throw new Error(`ZIP entry exceeds ${MAX_ENTRY_BYTES} bytes: ${entry.archivePath}`)
    }
    totalBytes += entry.data.length
    if (totalBytes > MAX_ARCHIVE_BYTES) {
      throw new Error(`ZIP bundle exceeds ${MAX_ARCHIVE_BYTES} uncompressed bytes`)
    }

    const name = Buffer.from(entry.archivePath, 'utf8')
    if (name.length > 0xffff) {
      throw new Error(`ZIP entry name is too long: ${entry.archivePath}`)
    }
    const checksum = crc32(entry.data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x0403_4b50, 0)
    localHeader.writeUInt16LE(ZIP_VERSION, 4)
    localHeader.writeUInt16LE(UTF8_FLAG, 6)
    localHeader.writeUInt16LE(STORE_METHOD, 8)
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10)
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(entry.data.length, 18)
    localHeader.writeUInt32LE(entry.data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x0201_4b50, 0)
    centralHeader.writeUInt16LE(UNIX_ZIP_VERSION, 4)
    centralHeader.writeUInt16LE(ZIP_VERSION, 6)
    centralHeader.writeUInt16LE(UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(STORE_METHOD, 10)
    centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12)
    centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(entry.data.length, 20)
    centralHeader.writeUInt32LE(entry.data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(REGULAR_FILE_ATTRIBUTES, 38)
    centralHeader.writeUInt32LE(localOffset, 42)

    localParts.push(localHeader, name, entry.data)
    centralParts.push(centralHeader, name)
    localOffset += localHeader.length + name.length + entry.data.length
    centralSize += centralHeader.length + name.length
    if (
      localOffset >= ZIP64_UINT32_SENTINEL
      || centralSize >= ZIP64_UINT32_SENTINEL
    ) {
      throw new Error('ZIP64 bundles are not supported')
    }
    if (localOffset + centralSize + 22 > MAX_ZIP_BYTES) {
      throw new Error(`ZIP bundle exceeds ${MAX_ZIP_BYTES} total bytes`)
    }
  }

  const centralDirectory = Buffer.concat(centralParts)
  if (
    centralDirectory.length !== centralSize
    || localOffset + centralDirectory.length >= ZIP64_UINT32_SENTINEL
  ) {
    throw new Error('ZIP64 bundles are not supported')
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x0605_4b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}

function checksumArtifact(filename, contents) {
  const digest = createHash('sha256').update(contents).digest('hex')
  return Buffer.from(`${digest}  ${filename}\n`, 'ascii')
}

async function assertRequiredFile(filePath, label) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing: ${filePath}`)
    }
    throw error
  })
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`)
  }
}

export async function createCodexSkillBundleArtifacts({
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) {
  const resolvedPluginRoot = path.resolve(pluginRoot)
  const skillRoot = path.join(resolvedPluginRoot, 'skills', 'phd-atlas')
  await assertRequiredFile(
    path.join(resolvedPluginRoot, '.codex-plugin', 'plugin.json'),
    'Codex plugin manifest',
  )
  await assertRequiredFile(path.join(resolvedPluginRoot, '.mcp.json'), 'Codex MCP manifest')
  await assertRequiredFile(path.join(resolvedPluginRoot, 'manifest.json'), 'Claude MCPB manifest')
  await assertRequiredFile(path.join(skillRoot, 'SKILL.md'), 'Codex skill manifest')

  const pluginEntries = await collectDirectoryFiles({
    sourceRoot: resolvedPluginRoot,
    archiveRoot: ARCHIVE_ROOT,
  })
  const skillPrefix = `${ARCHIVE_ROOT}/skills/phd-atlas/`
  const skillEntries = pluginEntries
    .filter((entry) => entry.archivePath.startsWith(skillPrefix))
    .map((entry) => ({
      archivePath: `${ARCHIVE_ROOT}/${entry.archivePath.slice(skillPrefix.length)}`,
      data: entry.data,
    }))
  if (skillEntries.length === 0) {
    throw new Error(`Codex skill source is empty: ${skillRoot}`)
  }
  const skillZip = createDeterministicZip(skillEntries)
  const pluginZip = createDeterministicZip(pluginEntries)
  const mcpbPrefix = `${ARCHIVE_ROOT}/`
  const mcpbEntries = pluginEntries.map((entry) => ({
    archivePath: entry.archivePath.slice(mcpbPrefix.length),
    data: entry.data,
  }))
  const claudeMcpb = createDeterministicZip(mcpbEntries)
  const artifacts = [
    { filename: BUNDLE_NAMES.skill, contents: skillZip },
    { filename: `${BUNDLE_NAMES.skill}.sha256`, contents: checksumArtifact(BUNDLE_NAMES.skill, skillZip) },
    { filename: BUNDLE_NAMES.plugin, contents: pluginZip },
    { filename: `${BUNDLE_NAMES.plugin}.sha256`, contents: checksumArtifact(BUNDLE_NAMES.plugin, pluginZip) },
    { filename: BUNDLE_NAMES.claude, contents: claudeMcpb },
    { filename: `${BUNDLE_NAMES.claude}.sha256`, contents: checksumArtifact(BUNDLE_NAMES.claude, claudeMcpb) },
  ]
  return artifacts
}

async function readExistingArtifact(filePath) {
  const metadata = await lstat(filePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Generated Codex bundle must be a regular file: ${filePath}`)
  }
  return readFile(filePath)
}

async function checkArtifacts(outputRoot, artifacts) {
  const mismatches = []
  for (const artifact of artifacts) {
    const destination = path.join(outputRoot, artifact.filename)
    try {
      const existing = await readExistingArtifact(destination)
      if (!existing.equals(artifact.contents)) {
        mismatches.push(`${artifact.filename} is stale`)
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        mismatches.push(`${artifact.filename} is missing`)
      } else {
        throw error
      }
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Codex bundle check failed:\n- ${mismatches.join('\n- ')}`)
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function renameWithRetry(source, destination) {
  const retryable = new Set(['EACCES', 'EBUSY', 'EPERM'])
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      lastError = error
      if (!retryable.has(error?.code) || attempt === 4) throw error
      await wait(25 * (2 ** attempt))
    }
  }
  throw lastError
}

async function replaceArtifact(destination, contents) {
  try {
    const existing = await readExistingArtifact(destination)
    if (existing.equals(contents)) return false
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  const backup = `${destination}.${process.pid}.${randomUUID()}.bak`
  let backupCreated = false
  let committed = false
  try {
    const handle = await open(temporary, 'wx', 0o644)
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await renameWithRetry(temporary, destination)
      committed = true
    } catch (replaceError) {
      if (!['EACCES', 'EBUSY', 'EEXIST', 'EPERM'].includes(replaceError?.code)) {
        throw replaceError
      }
      try {
        await renameWithRetry(destination, backup)
        backupCreated = true
      } catch (backupError) {
        if (backupError?.code !== 'ENOENT') throw backupError
      }

      try {
        await renameWithRetry(temporary, destination)
        committed = true
      } catch (commitError) {
        if (backupCreated) {
          try {
            await renameWithRetry(backup, destination)
            backupCreated = false
          } catch (restoreError) {
            throw new AggregateError(
              [commitError, restoreError],
              `Failed to replace or restore generated Codex bundle: ${destination}`,
            )
          }
        }
        throw commitError
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (committed && backupCreated) {
      await rm(backup, { force: true, maxRetries: 5, retryDelay: 25 })
    }
  }
  return true
}

async function existingCanonicalDirectory(directory, label) {
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directory}`)
  }
  return realpath(directory)
}

export async function buildCodexSkillBundles({
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  check = false,
} = {}) {
  const resolvedPluginRoot = path.resolve(pluginRoot)
  const resolvedOutputRoot = path.resolve(outputRoot)
  const canonicalPluginRoot = await assertRealDirectory(resolvedPluginRoot, 'Codex plugin source')
  const canonicalOutputCandidate = await canonicalizePathWithMissingTail(resolvedOutputRoot)
  if (
    isSameOrInside(resolvedOutputRoot, resolvedPluginRoot)
    || isSameOrInside(canonicalOutputCandidate, canonicalPluginRoot)
  ) {
    throw new Error('Codex bundle output directory must resolve outside the plugin source')
  }
  const artifacts = await createCodexSkillBundleArtifacts({ pluginRoot: canonicalPluginRoot })
  if (check) {
    const canonicalOutputRoot = await existingCanonicalDirectory(
      resolvedOutputRoot,
      'Codex bundle output',
    )
    if (canonicalOutputRoot && isSameOrInside(canonicalOutputRoot, canonicalPluginRoot)) {
      throw new Error('Codex bundle output directory resolves inside the plugin source')
    }
    await checkArtifacts(resolvedOutputRoot, artifacts)
    return { checked: artifacts.map((artifact) => artifact.filename), written: [] }
  }

  await mkdir(resolvedOutputRoot, { recursive: true, mode: 0o755 })
  const canonicalOutputRoot = await existingCanonicalDirectory(
    resolvedOutputRoot,
    'Codex bundle output',
  )
  if (!canonicalOutputRoot) {
    throw new Error(`Codex bundle output disappeared during build: ${resolvedOutputRoot}`)
  }
  if (isSameOrInside(canonicalOutputRoot, canonicalPluginRoot)) {
    throw new Error('Codex bundle output directory resolves inside the plugin source')
  }
  const written = []
  for (const artifact of artifacts) {
    const destination = path.join(resolvedOutputRoot, artifact.filename)
    if (await replaceArtifact(destination, artifact.contents)) {
      written.push(artifact.filename)
    }
  }
  return { checked: [], written }
}

function parseArguments(argv) {
  let check = false
  for (const argument of argv) {
    if (argument === '--check') {
      check = true
    } else if (argument === '--help' || argument === '-h') {
      return { help: true, check }
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return { help: false, check }
}

function usage() {
  return [
    'Usage: node tools/build-codex-skill-bundles.mjs [--check]',
    '',
    'Build deterministic PhD Atlas Skill, Codex Plugin, and Claude MCPB files plus SHA-256 checksums.',
    '--check compares the committed public/downloads artifacts without writing.',
    '',
  ].join('\n')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && pathKey(invokedPath) === pathKey(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
    } else {
      const result = await buildCodexSkillBundles({ check: options.check })
      if (options.check) {
        process.stdout.write(`Verified ${result.checked.length} MCP / Skill bundle artifacts.\n`)
      } else if (result.written.length === 0) {
        process.stdout.write('MCP / Skill bundle artifacts are already current.\n')
      } else {
        process.stdout.write(`Generated ${result.written.join(', ')}.\n`)
      }
    }
  } catch (error) {
    process.stderr.write(`Codex bundle build failed: ${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
