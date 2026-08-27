import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultAppPath = fileURLToPath(
  new URL('../dist-desktop/mac-arm64/PhD Atlas.app', import.meta.url),
)

export function signMacApp(appPath = process.argv[2] || defaultAppPath) {
  if (!existsSync(appPath)) {
    throw new Error(`Mac app missing: ${appPath}`)
  }
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
  execFileSync('codesign', [
    '--sign',
    '-',
    '--force',
    '--deep',
    '--timestamp=none',
    appPath,
  ], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' })
  console.log(`Ad-hoc signed ${appPath}`)
  return appPath
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  signMacApp()
}
