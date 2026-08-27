import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const coauthorTrailerPattern = /^[\t ]*co-authored-by[\t ]*:/im

export function assertNoCoauthorTrailers(message, label = 'Commit message') {
  if (coauthorTrailerPattern.test(String(message ?? ''))) {
    throw new Error(
      `${label} contains a forbidden Co-authored-by trailer. `
      + 'PhD Atlas commits must have only their primary Git author.',
    )
  }
}

async function main() {
  const [messagePath] = process.argv.slice(2)
  if (!messagePath) {
    throw new Error('Usage: node tools/no-coauthors.mjs <commit-message-file>')
  }
  const resolvedPath = path.resolve(messagePath)
  assertNoCoauthorTrailers(await readFile(resolvedPath, 'utf8'), resolvedPath)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[no-coauthors] ${error?.message || error}`)
    process.exitCode = 1
  }
}
