import { spawn } from 'node:child_process'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_SCANNED_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_SENSITIVE_PATHS = new Set(['.env.example'])
const GENERATED_ROOT_PATHS = new Set(['.git', 'node_modules'])
const SENSITIVE_PATH = /(^|\/)(?:\.env(?:\.|$)|storage(?:\/|$)|uploads?(?:\/|$)|[^/]+\.(?:pem|key|p12|pfx|sqlite|db|bak|backup))$/i
const SECRET_SIGNATURES = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['github-token', /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/u],
  ['openai-key', /\bsk-[A-Za-z0-9]{32,}\b/u],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/u],
  ['stripe-live-key', /\bsk_live_[0-9A-Za-z]{20,}\b/u],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/u],
]

function gitFileList(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', argumentsList, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = []
    const errors = []
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.on('data', (chunk) => errors.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString('utf8') || `git ls-files exited with ${code}`))
        return
      }
      resolve(
        Buffer.concat(output)
          .toString('utf8')
          .split('\0')
          .filter(Boolean),
      )
    })
  })
}

export function excludeDeletedTrackedFiles(sourceFiles, deletedFiles) {
  const deleted = new Set(deletedFiles)
  return sourceFiles.filter((relativePath) => !deleted.has(relativePath))
}

async function trackedFiles() {
  try {
    await lstat(path.join(root, '.git'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return filesystemSourceFiles(root)
  }
  const [sourceFiles, deletedFiles] = await Promise.all([
    gitFileList(['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    gitFileList(['ls-files', '-z', '--deleted']),
  ])
  // A path explicitly deleted in the current working tree is not part of the
  // source that would ship with this change. Other read failures remain
  // findings below, preserving the audit's fail-closed behavior.
  return excludeDeletedTrackedFiles(sourceFiles, deletedFiles)
}

export async function filesystemSourceFiles(sourceRoot) {
  const files = []
  async function visit(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (!relativeDirectory && GENERATED_ROOT_PATHS.has(entry.name)) continue
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to audit a symbolic link outside generated dependencies: ${relativePath}`)
      }
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relativePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`Refusing to skip a non-file source entry: ${relativePath}`)
      }
      files.push(relativePath)
    }
  }
  await visit(sourceRoot)
  return files
}

export async function auditTrackedSource(files) {
  const sourceFiles = files ?? await trackedFiles()
  const findings = []
  for (const relativePath of sourceFiles) {
    const normalized = relativePath.replaceAll('\\', '/')
    if (SENSITIVE_PATH.test(normalized) && !ALLOWED_SENSITIVE_PATHS.has(normalized)) {
      findings.push({ path: normalized, rule: 'sensitive-path' })
      continue
    }
    let bytes
    try {
      bytes = await readFile(path.join(root, relativePath))
    } catch {
      findings.push({ path: normalized, rule: 'unreadable-tracked-file' })
      continue
    }
    if (bytes.length > MAX_SCANNED_FILE_BYTES || bytes.includes(0)) continue
    const text = bytes.toString('utf8')
    for (const [rule, signature] of SECRET_SIGNATURES) {
      if (signature.test(text)) findings.push({ path: normalized, rule })
    }
  }
  return findings
}

async function main() {
  const findings = await auditTrackedSource()
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[security:source] ${finding.path}: ${finding.rule}`)
    }
    process.exitCode = 1
    return
  }
  console.log('[security:source] No source secret signatures or runtime-data paths found.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
