import { writeFileSync } from 'node:fs'
import { buildIntegrityManifest, integrityManifestPath } from './integrity.mjs'

const manifest = buildIntegrityManifest()
writeFileSync(integrityManifestPath(), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${integrityManifestPath()} with ${Object.keys(manifest.files).length} hashes.`)
