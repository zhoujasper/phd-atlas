import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The recurring failure in this codebase has one shape: a rule written down in
 * two places, which drift, after which one layer accepts what another rejects.
 * It has cost a settings key that vanished on reload, a save that could never
 * complete, and a workspace that downloaded itself three times.
 *
 * None of those announced themselves. So rather than trusting review to catch
 * the next copy, this walks the source and fails on any constant set defined
 * under one name in two files. Two lists that genuinely differ are fine — they
 * just have to say so by carrying different names.
 */
const ROOTS = ['server', 'shared', 'src']
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'logs'])
const MINIMUM_ENTRIES = 3

function sourceFiles(root) {
  const found = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) found.push(full)
    }
  }
  walk(path.join(process.cwd(), root))
  return found
}

function constantSetDefinitions() {
  const definitions = new Map()
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = fs.readFileSync(file, 'utf8')
      const pattern = /(?:const|export const)\s+([A-Z][A-Z0-9_]{6,})\s*=\s*(?:Object\.freeze\()?new Set\(\[([^\]]*)\]/gu
      for (const match of source.matchAll(pattern)) {
        const entries = [...match[2].matchAll(/'([^']+)'/gu)].map((item) => item[1]).sort()
        if (entries.length < MINIMUM_ENTRIES) continue
        const relative = path.relative(process.cwd(), file).split(path.sep).join('/')
        if (!definitions.has(match[1])) definitions.set(match[1], [])
        definitions.get(match[1]).push({ file: relative, entries: entries.join('|') })
      }
    }
  }
  return definitions
}

describe('constant definitions are not duplicated', () => {
  it('defines each named constant set in exactly one file', () => {
    const duplicated = [...constantSetDefinitions().entries()]
      .filter(([, list]) => list.length > 1)
      .map(([name, list]) => {
        const drifted = new Set(list.map((entry) => entry.entries)).size > 1
        return `${name} ${drifted ? '(ALREADY DRIFTED)' : ''} -> ${list.map((entry) => entry.file).join(', ')}`
      })

    // If this fails: move the set into a module both files import. If the two
    // lists are meant to differ, rename them so neither reads as a stale copy
    // of the other.
    expect(duplicated).toEqual([])
  })
})
