import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installPortableLayout } from './portablePaths.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const targets = [
  join(projectRoot, 'dist-desktop', 'mac-arm64'),
  join(projectRoot, 'dist-desktop', 'win-unpacked'),
  join(projectRoot, 'dist-desktop', 'linux-unpacked'),
]

for (const directory of targets) {
  if (!existsSync(directory)) continue
  installPortableLayout(directory)
  console.log(`Wrote portable layout in ${directory}`)
}
