import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundledDesktopNodeName } from './resolve-runtime-node.mjs'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const destDir = join(desktopRoot, 'resources', 'runtime')
mkdirSync(destDir, { recursive: true })
const dest = join(destDir, bundledDesktopNodeName())
copyFileSync(process.execPath, dest)
console.log(`Copied Node runtime to ${dest}`)
