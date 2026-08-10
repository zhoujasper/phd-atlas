import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BUNDLE_NAMES,
  DEFAULT_OUTPUT_ROOT,
  buildCodexSkillBundles,
  createDeterministicZip,
} from '../tools/build-codex-skill-bundles.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function temporaryDirectory(label) {
  const root = await mkdtemp(path.join(tmpdir(), `phd-atlas-${label}-`))
  temporaryRoots.push(root)
  return root
}

async function createPluginFixture(root) {
  const pluginRoot = path.join(root, 'plugin')
  const skillRoot = path.join(pluginRoot, 'skills', 'phd-atlas')
  await mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
  await mkdir(path.join(skillRoot, 'agents'), { recursive: true })
  await mkdir(path.join(skillRoot, 'scripts'), { recursive: true })
  await writeFile(
    path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
    '{"name":"phd-atlas","version":"0.1.0"}\n',
  )
  await writeFile(
    path.join(pluginRoot, '.mcp.json'),
    '{"mcpServers":{"phd-atlas":{"command":"node"}}}\n',
  )
  await writeFile(
    path.join(pluginRoot, 'manifest.json'),
    JSON.stringify({
      manifest_version: '0.3',
      name: 'phd-atlas',
      version: '0.1.0',
      server: {
        type: 'node',
        entry_point: 'skills/phd-atlas/scripts/phd-atlas-cli.mjs',
        mcp_config: {
          command: 'node',
          args: ['${__dirname}/skills/phd-atlas/scripts/phd-atlas-cli.mjs', 'mcp'],
          env: {},
        },
      },
    }) + '\n',
  )
  await writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: phd-atlas\n---\n')
  await writeFile(
    path.join(skillRoot, 'agents', 'openai.yaml'),
    'interface:\n  display_name: "PhD Atlas"\n',
  )
  await writeFile(path.join(skillRoot, 'scripts', 'phd-atlas-cli.mjs'), 'export {}\n')
  return { pluginRoot, skillRoot }
}

function readStoredZip(zip) {
  const files = new Map()
  const localEntries = new Map()
  let offset = 0
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x0403_4b50) {
    const localOffset = offset
    const flags = zip.readUInt16LE(offset + 6)
    const method = zip.readUInt16LE(offset + 8)
    const dosTime = zip.readUInt16LE(offset + 10)
    const dosDate = zip.readUInt16LE(offset + 12)
    const crc = zip.readUInt32LE(offset + 14)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const uncompressedSize = zip.readUInt32LE(offset + 22)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    expect(flags).toBe(0x0800)
    expect(method).toBe(0)
    expect(dosTime).toBe(0)
    expect(dosDate).toBe(0x21)
    expect(compressedSize).toBe(uncompressedSize)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8')
    files.set(name, zip.subarray(dataStart, dataStart + uncompressedSize))
    localEntries.set(name, {
      crc,
      localOffset,
      size: uncompressedSize,
    })
    offset = dataStart + compressedSize
  }
  const centralOffset = offset
  for (let index = 0; index < localEntries.size; index += 1) {
    expect(zip.readUInt32LE(offset)).toBe(0x0201_4b50)
    expect(zip.readUInt16LE(offset + 4) >>> 8).toBe(3)
    expect(zip.readUInt16LE(offset + 6)).toBe(20)
    expect(zip.readUInt16LE(offset + 8)).toBe(0x0800)
    expect(zip.readUInt16LE(offset + 10)).toBe(0)
    expect(zip.readUInt16LE(offset + 12)).toBe(0)
    expect(zip.readUInt16LE(offset + 14)).toBe(0x21)
    const crc = zip.readUInt32LE(offset + 16)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const uncompressedSize = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    expect(zip.readUInt16LE(offset + 34)).toBe(0)
    expect(zip.readUInt16LE(offset + 36)).toBe(0)
    expect(zip.readUInt32LE(offset + 38) >>> 16).toBe(0o100644)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    const local = localEntries.get(name)
    expect(local).toEqual({ crc, localOffset, size: uncompressedSize })
    expect(compressedSize).toBe(uncompressedSize)
    offset += 46 + nameLength + extraLength + commentLength
  }

  const eocdOffset = zip.length - 22
  expect(offset).toBe(eocdOffset)
  expect(zip.readUInt32LE(eocdOffset)).toBe(0x0605_4b50)
  expect(zip.readUInt16LE(eocdOffset + 4)).toBe(0)
  expect(zip.readUInt16LE(eocdOffset + 6)).toBe(0)
  expect(zip.readUInt16LE(eocdOffset + 8)).toBe(localEntries.size)
  expect(zip.readUInt16LE(eocdOffset + 10)).toBe(localEntries.size)
  expect(zip.readUInt32LE(eocdOffset + 12)).toBe(eocdOffset - centralOffset)
  expect(zip.readUInt32LE(eocdOffset + 16)).toBe(centralOffset)
  expect(zip.readUInt16LE(eocdOffset + 20)).toBe(0)
  return files
}

function expectedChecksum(filename, contents) {
  return `${createHash('sha256').update(contents).digest('hex')}  ${filename}\n`
}

function containsControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function safeArchiveDestination(extractionRoot, archivePath, expectedRoot = 'phd-atlas') {
  const normalized = archivePath.normalize('NFC')
  const segments = normalized.split('/')
  if (
    archivePath !== normalized
    || normalized.startsWith('/')
    || normalized.includes('\\')
    || path.posix.normalize(normalized) !== normalized
    || segments.length < (expectedRoot ? 2 : 1)
    || (expectedRoot && segments[0] !== expectedRoot)
    || segments.some((segment) => (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || /[<>:"|?*]/.test(segment)
      || containsControlCharacter(segment)
      || /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    ))
  ) {
    throw new Error(`Unsafe published ZIP entry: ${archivePath}`)
  }

  const destination = path.resolve(extractionRoot, ...segments)
  const relativeDestination = path.relative(extractionRoot, destination)
  if (
    !relativeDestination
    || relativeDestination === '..'
    || relativeDestination.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeDestination)
  ) {
    throw new Error(`Published ZIP entry escapes extraction root: ${archivePath}`)
  }
  return destination
}

async function extractStoredZip(zip, extractionRoot, expectedRoot = 'phd-atlas') {
  const files = readStoredZip(zip)
  for (const [archivePath, contents] of files) {
    const destination = safeArchiveDestination(extractionRoot, archivePath, expectedRoot)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, contents, { flag: 'wx', mode: 0o600 })
  }
  return files
}

function isolatedMcpEnvironment(configRoot) {
  const allowedNames = new Set([
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR',
  ])
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => (
      value !== undefined && allowedNames.has(name.toLocaleUpperCase('en-US'))
    )),
  )
  environment.PHD_ATLAS_CONFIG_DIR = configRoot
  environment.PHD_ATLAS_DISABLE_BROWSER_OPEN = '1'
  return environment
}

function runPublishedMcpSmoke(pluginRoot, configRoot, manifestKind = 'codex') {
  let server
  let workingDirectory
  if (manifestKind === 'claude') {
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      manifest_version: '0.3',
      server: {
        type: 'node',
        entry_point: 'skills/phd-atlas/scripts/phd-atlas-cli.mjs',
      },
    })
    server = manifest.server.mcp_config
    server = {
      ...server,
      args: server.args.map((argument) => argument.replace('${__dirname}', pluginRoot)),
    }
    workingDirectory = pluginRoot
  } else {
    const mcpManifest = JSON.parse(
      readFileSync(path.join(pluginRoot, '.mcp.json'), 'utf8'),
    )
    server = mcpManifest?.mcpServers?.['phd-atlas']
    expect(server).toMatchObject({
      cwd: '.',
      command: 'node',
      args: ['./skills/phd-atlas/scripts/phd-atlas-cli.mjs', 'mcp'],
    })
    workingDirectory = path.resolve(pluginRoot, server.cwd)
    expect(path.relative(pluginRoot, workingDirectory)).toBe('')
  }
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'phd-atlas-bundle-smoke', version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map((message) => JSON.stringify(message)).join('\n') + '\n'
  const result = spawnSync(server.command, server.args, {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: isolatedMcpEnvironment(configRoot),
    input,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10_000,
    windowsHide: true,
  })

  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  const responses = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  expect(responses.find((message) => message.id === 1)).toMatchObject({
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'phd-atlas' },
    },
  })
  const toolsResponse = responses.find((message) => message.id === 2)
  const publishedTools = toolsResponse?.result?.tools ?? []
  expect(publishedTools).toHaveLength(19)
  for (const tool of publishedTools) {
    expect(tool).toMatchObject({
      title: expect.any(String),
      inputSchema: expect.any(Object),
      outputSchema: expect.any(Object),
      annotations: {
        title: expect.any(String),
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      },
    })
  }
  const toolNames = new Set(publishedTools.map((tool) => tool.name))
  expect(toolNames.has('phd_atlas_team_students')).toBe(false)
  expect([...toolNames]).toEqual(expect.arrayContaining([
    'phd_atlas_login_start',
    'phd_atlas_login_finish',
    'phd_atlas_accounts_list',
    'phd_atlas_account_use',
    'phd_atlas_status',
    'phd_atlas_capabilities',
    'phd_atlas_api',
    'phd_atlas_upload',
    'phd_atlas_download',
    'phd_atlas_logout',
  ]))
}

describe('Codex Skill bundle builder', () => {
  it('writes standard ZIP metadata and known CRC-32 vectors', () => {
    const vectorZip = createDeterministicZip([
      { archivePath: 'phd-atlas/vector.txt', data: Buffer.from('123456789') },
    ])
    expect(vectorZip.readUInt32LE(14)).toBe(0xcbf4_3926)
    expect(readStoredZip(vectorZip).get('phd-atlas/vector.txt')?.toString()).toBe('123456789')

    const emptyZip = createDeterministicZip([
      { archivePath: 'phd-atlas/empty.txt', data: Buffer.alloc(0) },
    ])
    expect(emptyZip.readUInt32LE(14)).toBe(0)
    expect(readStoredZip(emptyZip).get('phd-atlas/empty.txt')).toEqual(Buffer.alloc(0))
  })

  it('builds byte-identical Skill, Codex Plugin, and Claude MCPB archives with checksums', async () => {
    const root = await temporaryDirectory('bundles')
    const { pluginRoot, skillRoot } = await createPluginFixture(root)
    const firstOutput = path.join(root, 'first')
    const secondOutput = path.join(root, 'second')

    await buildCodexSkillBundles({ pluginRoot, outputRoot: firstOutput })
    await writeFile(path.join(skillRoot, 'SKILL.md'), '---\r\nname: phd-atlas\r\n---\r\n')
    await utimes(path.join(skillRoot, 'SKILL.md'), new Date(), new Date())
    await buildCodexSkillBundles({ pluginRoot, outputRoot: secondOutput })

    const skillZip = await readFile(path.join(firstOutput, BUNDLE_NAMES.skill))
    const pluginZip = await readFile(path.join(firstOutput, BUNDLE_NAMES.plugin))
    const claudeMcpb = await readFile(path.join(firstOutput, BUNDLE_NAMES.claude))
    expect(await readFile(path.join(secondOutput, BUNDLE_NAMES.skill))).toEqual(skillZip)
    expect(await readFile(path.join(secondOutput, BUNDLE_NAMES.plugin))).toEqual(pluginZip)
    expect(await readFile(path.join(secondOutput, BUNDLE_NAMES.claude))).toEqual(claudeMcpb)

    const skillFiles = readStoredZip(skillZip)
    expect([...skillFiles.keys()]).toEqual([
      'phd-atlas/SKILL.md',
      'phd-atlas/agents/openai.yaml',
      'phd-atlas/scripts/phd-atlas-cli.mjs',
    ])
    expect(skillFiles.has('phd-atlas/.mcp.json')).toBe(false)

    const pluginFiles = readStoredZip(pluginZip)
    expect([...pluginFiles.keys()]).toEqual([
      'phd-atlas/.codex-plugin/plugin.json',
      'phd-atlas/.mcp.json',
      'phd-atlas/manifest.json',
      'phd-atlas/skills/phd-atlas/SKILL.md',
      'phd-atlas/skills/phd-atlas/agents/openai.yaml',
      'phd-atlas/skills/phd-atlas/scripts/phd-atlas-cli.mjs',
    ])
    for (const [skillPath, contents] of skillFiles) {
      const relativePath = skillPath.slice('phd-atlas/'.length)
      expect(pluginFiles.get(`phd-atlas/skills/phd-atlas/${relativePath}`)).toEqual(contents)
    }
    expect(
      await readFile(path.join(firstOutput, `${BUNDLE_NAMES.skill}.sha256`), 'ascii'),
    ).toBe(expectedChecksum(BUNDLE_NAMES.skill, skillZip))
    expect(
      await readFile(path.join(firstOutput, `${BUNDLE_NAMES.plugin}.sha256`), 'ascii'),
    ).toBe(expectedChecksum(BUNDLE_NAMES.plugin, pluginZip))
    const claudeFiles = readStoredZip(claudeMcpb)
    expect([...claudeFiles.keys()]).toEqual([
      '.codex-plugin/plugin.json',
      '.mcp.json',
      'manifest.json',
      'skills/phd-atlas/SKILL.md',
      'skills/phd-atlas/agents/openai.yaml',
      'skills/phd-atlas/scripts/phd-atlas-cli.mjs',
    ])
    expect(JSON.parse(claudeFiles.get('manifest.json').toString())).toMatchObject({
      manifest_version: '0.3',
      name: 'phd-atlas',
    })
    expect(
      await readFile(path.join(firstOutput, `${BUNDLE_NAMES.claude}.sha256`), 'ascii'),
    ).toBe(expectedChecksum(BUNDLE_NAMES.claude, claudeMcpb))

    const beforeRepeat = await stat(path.join(firstOutput, BUNDLE_NAMES.plugin))
    await expect(buildCodexSkillBundles({ pluginRoot, outputRoot: firstOutput })).resolves.toEqual({
      checked: [],
      written: [],
    })
    expect((await stat(path.join(firstOutput, BUNDLE_NAMES.plugin))).mtimeMs).toBe(
      beforeRepeat.mtimeMs,
    )
  })

  it('checks all committed artifacts without rewriting stale output', async () => {
    const root = await temporaryDirectory('check')
    const { pluginRoot } = await createPluginFixture(root)
    const outputRoot = path.join(root, 'downloads')
    await buildCodexSkillBundles({ pluginRoot, outputRoot })
    await expect(buildCodexSkillBundles({ pluginRoot, outputRoot, check: true })).resolves.toEqual({
      checked: [
        BUNDLE_NAMES.skill,
        `${BUNDLE_NAMES.skill}.sha256`,
        BUNDLE_NAMES.plugin,
        `${BUNDLE_NAMES.plugin}.sha256`,
        BUNDLE_NAMES.claude,
        `${BUNDLE_NAMES.claude}.sha256`,
      ],
      written: [],
    })

    const stalePath = path.join(outputRoot, BUNDLE_NAMES.skill)
    await writeFile(stalePath, 'stale bundle')
    await rm(path.join(outputRoot, `${BUNDLE_NAMES.plugin}.sha256`))
    const staleMetadata = await stat(stalePath)
    let checkError
    try {
      await buildCodexSkillBundles({ pluginRoot, outputRoot, check: true })
    } catch (error) {
      checkError = error
    }
    expect(checkError?.message).toContain(`${BUNDLE_NAMES.skill} is stale`)
    expect(checkError?.message).toContain(`${BUNDLE_NAMES.plugin}.sha256 is missing`)
    await expect(readFile(stalePath, 'utf8')).resolves.toBe('stale bundle')
    expect((await stat(stalePath)).mtimeMs).toBe(staleMetadata.mtimeMs)

    const missingOutput = path.join(root, 'missing-output')
    await expect(
      buildCodexSkillBundles({ pluginRoot, outputRoot: missingOutput, check: true }),
    ).rejects.toThrow(`${BUNDLE_NAMES.skill} is missing`)
    await expect(lstat(missingOutput)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('extracts the checksummed published Plugin and completes a real MCP handshake', async () => {
    const root = await temporaryDirectory('published-plugin')
    const extractionRoot = path.join(root, 'extracted')
    const configRoot = path.join(root, 'config')
    const pluginZipPath = path.join(DEFAULT_OUTPUT_ROOT, BUNDLE_NAMES.plugin)
    const pluginZip = await readFile(pluginZipPath)
    const checksum = await readFile(`${pluginZipPath}.sha256`, 'ascii')

    expect(checksum).toMatch(/^[a-f0-9]{64}  phd-atlas-codex-plugin\.zip\n$/)
    expect(checksum).toBe(expectedChecksum(BUNDLE_NAMES.plugin, pluginZip))
    const extractedFiles = await extractStoredZip(pluginZip, extractionRoot)
    expect(extractedFiles.has('phd-atlas/.mcp.json')).toBe(true)
    expect(extractedFiles.has(
      'phd-atlas/skills/phd-atlas/scripts/phd-atlas-cli.mjs',
    )).toBe(true)

    runPublishedMcpSmoke(path.join(extractionRoot, 'phd-atlas'), configRoot)
  })

  it('extracts the checksummed published Claude MCPB and completes a real MCP handshake', async () => {
    const root = await temporaryDirectory('published-claude')
    const extractionRoot = path.join(root, 'extracted')
    const configRoot = path.join(root, 'config')
    const mcpbPath = path.join(DEFAULT_OUTPUT_ROOT, BUNDLE_NAMES.claude)
    const mcpb = await readFile(mcpbPath)
    const checksum = await readFile(`${mcpbPath}.sha256`, 'ascii')

    expect(checksum).toMatch(/^[a-f0-9]{64}  phd-atlas-claude\.mcpb\n$/)
    expect(checksum).toBe(expectedChecksum(BUNDLE_NAMES.claude, mcpb))
    const extractedFiles = await extractStoredZip(mcpb, extractionRoot, null)
    expect(extractedFiles.has('manifest.json')).toBe(true)
    expect(extractedFiles.has('skills/phd-atlas/scripts/phd-atlas-cli.mjs')).toBe(true)

    runPublishedMcpSmoke(extractionRoot, configRoot, 'claude')
  })

  it('rejects traversal, credential state, private keys, and symlinked content', async () => {
    expect(() => createDeterministicZip([
      { archivePath: '../outside.txt', data: Buffer.from('unsafe') },
    ])).toThrow('traversal')
    expect(() => createDeterministicZip([
      { archivePath: 'phd-atlas/con.txt', data: Buffer.from('unsafe') },
    ])).toThrow('not portable')
    expect(() => createDeterministicZip([
      { archivePath: 'phd-atlas/file.txt:token', data: Buffer.from('unsafe') },
    ])).toThrow('not portable')

    const root = await temporaryDirectory('safety')
    const { pluginRoot, skillRoot } = await createPluginFixture(root)
    const outputRoot = path.join(root, 'downloads')
    await writeFile(path.join(skillRoot, 'config.json'), '{"accessToken":"secret"}\n')
    await expect(buildCodexSkillBundles({ pluginRoot, outputRoot })).rejects.toThrow(
      'Credential or local configuration file',
    )
    await rm(path.join(skillRoot, 'config.json'))

    await writeFile(
      path.join(skillRoot, 'scripts', 'embedded.txt'),
      ['-----BEGIN ', 'PRIVATE KEY-----\nnot-a-real-key\n'].join(''),
    )
    await expect(buildCodexSkillBundles({ pluginRoot, outputRoot })).rejects.toThrow(
      'Private key material',
    )
    await rm(path.join(skillRoot, 'scripts', 'embedded.txt'))

    const external = path.join(root, 'external')
    await mkdir(external)
    await writeFile(path.join(external, 'escaped.txt'), 'escaped')
    await symlink(
      external,
      path.join(skillRoot, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(buildCodexSkillBundles({ pluginRoot, outputRoot })).rejects.toThrow(
      'Symbolic links and junctions',
    )
    await rm(path.join(skillRoot, 'linked'))

    const outputAlias = path.join(root, 'output-alias')
    await symlink(
      skillRoot,
      outputAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      buildCodexSkillBundles({ pluginRoot, outputRoot: path.join(outputAlias, 'generated') }),
    ).rejects.toThrow('resolve outside the plugin source')
    await expect(lstat(path.join(skillRoot, 'generated'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
