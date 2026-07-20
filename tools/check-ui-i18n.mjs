import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const sourceRoot = path.join(process.cwd(), 'src')
const englishRoot = path.join(sourceRoot, 'i18n', 'en')
const errors = []
const translationKeys = new Set()
const publicEdition = fs.readFileSync(path.join(sourceRoot, 'edition.ts'), 'utf8')
  .includes('PUBLIC_EDITION = true')

function collectTranslationKeys(value, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectTranslationKeys(child, prefix ? `${prefix}.${key}` : key)
    }
    return
  }
  translationKeys.add(prefix)
}

for (const file of fs.readdirSync(englishRoot).filter((name) => name.endsWith('.json'))) {
  collectTranslationKeys(JSON.parse(fs.readFileSync(path.join(englishRoot, file), 'utf8')))
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(entryPath)
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return []
    return [entryPath]
  })
}

function location(file, sourceFile, node) {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  return `${path.relative(process.cwd(), file)}:${line}`
}

function staticTranslationKey(call) {
  if (ts.isIdentifier(call.expression) && call.expression.text === 'tx') return call.arguments[0]
  if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'tx') return call.arguments[0]
  if (ts.isIdentifier(call.expression) && call.expression.text === 't') return call.arguments[1]
  return null
}

function isAllowedVisibleLiteral(value) {
  return value === '1 GB'
    || value === 'PhD Atlas v'
    || value === '&times;'
}

function isAllowedAttributeLiteral(value) {
  return value === 'PhD Atlas'
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    || /^[a-z]+\.example\.com$/i.test(value)
}

for (const file of sourceFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const keyNode = staticTranslationKey(node)
      const omittedPublicTeamKey = publicEdition
        && keyNode
        && ts.isStringLiteral(keyNode)
        && keyNode.text.startsWith('team.')
      if (keyNode && ts.isStringLiteral(keyNode) && !omittedPublicTeamKey && !translationKeys.has(keyNode.text)) {
        errors.push(`${location(file, sourceFile, keyNode)}: missing English i18n key ${keyNode.text}`)
      }
    }

    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, ' ').trim()
      if (/[A-Za-z\u3400-\u9fff]{2}/.test(value) && !isAllowedVisibleLiteral(value)) {
        errors.push(`${location(file, sourceFile, node)}: hardcoded JSX text ${JSON.stringify(value)}`)
      }
    }

    if (
      ts.isJsxAttribute(node)
      && node.initializer
      && ts.isStringLiteral(node.initializer)
      && ['aria-label', 'title', 'placeholder', 'alt'].includes(node.name.text)
    ) {
      const value = node.initializer.text
      if (/[A-Za-z\u3400-\u9fff]{2}/.test(value) && !isAllowedAttributeLiteral(value)) {
        errors.push(`${location(file, sourceFile, node)}: hardcoded ${node.name.text} ${JSON.stringify(value)}`)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (!file.endsWith('.worker.ts')) {
    const rawErrorMessage = /(?:error|err|reason|cause) instanceof Error\s*\?\s*(?:error|err|reason|cause)\.message/g
    for (const match of source.matchAll(rawErrorMessage)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length
      errors.push(`${path.relative(process.cwd(), file)}:${line}: raw Error.message can bypass localization`)
    }
  }
}

const errorMessageSource = fs.readFileSync(path.join(sourceRoot, 'errorMessages.ts'), 'utf8')
const mappedErrorCodes = new Set(Array.from(
  errorMessageSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*'apiErrors\./gm),
  (match) => match[1],
))
const speciallyResolvedErrorCodes = new Set(['PRO_REQUIRED', 'STORAGE_QUOTA_EXCEEDED'])
const serverRoot = path.join(process.cwd(), 'server')
const serverSource = fs.readdirSync(serverRoot)
  .filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'))
  .map((file) => fs.readFileSync(path.join(serverRoot, file), 'utf8'))
  .join('\n')
const serverErrorCodes = new Set(Array.from(
  serverSource.matchAll(/(?:fail\([^\n]*?|code\s*:\s*)['"]([A-Z][A-Z0-9_]+)['"]/g),
  (match) => match[1],
))
for (const code of serverErrorCodes) {
  const handledByFamily = code.startsWith('SMTP_') || code.startsWith('MAIL_FETCH_')
  if (!mappedErrorCodes.has(code) && !speciallyResolvedErrorCodes.has(code) && !handledByFamily) {
    errors.push(`server error code ${code} has no localized mapping in src/errorMessages.ts`)
  }
}

if (errors.length) {
  console.error(`UI i18n audit failed with ${errors.length} issue(s):`)
  errors.forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}

console.log('UI i18n audit passed: static keys, visible JSX literals, attributes, and error-message paths.')
