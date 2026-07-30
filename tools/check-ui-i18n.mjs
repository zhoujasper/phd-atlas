import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const sourceRoot = path.join(process.cwd(), 'src')
const englishRoot = path.join(sourceRoot, 'i18n', 'en')
const errors = []
const translationKeys = new Set()
const translationOwners = new Map()
const publicEdition = fs.readFileSync(path.join(sourceRoot, 'edition.ts'), 'utf8')
  .includes('PUBLIC_EDITION = true')

function collectTranslationKeys(value, namespace, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectTranslationKeys(child, namespace, prefix ? `${prefix}.${key}` : key)
    }
    return
  }
  translationKeys.add(prefix)
  const owners = translationOwners.get(prefix) ?? new Set()
  owners.add(namespace)
  translationOwners.set(prefix, owners)
}

for (const file of fs.readdirSync(englishRoot).filter((name) => name.endsWith('.json'))) {
  collectTranslationKeys(
    JSON.parse(fs.readFileSync(path.join(englishRoot, file), 'utf8')),
    path.basename(file, '.json'),
  )
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

function stringLiteralText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null
}

function isAllowedVisibleLiteral(value) {
  return value === '1 GB'
    || value === 'PhD Atlas v'
    || value === '&times;'
    || value === '{{name}}'
    || value.startsWith('/admin/')
}

function isAllowedAttributeLiteral(value) {
  return value === 'PhD Atlas'
    || value === 'SMTP'
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    || /^[a-z]+\.example\.com$/i.test(value)
}

const visibleStringAttributes = new Set([
  'aria-label',
  'title',
  'placeholder',
  'alt',
  'label',
  'ariaLabel',
  'message',
  'detail',
  'description',
  'subtitle',
  'heading',
  'eyebrow',
  'hint',
  'emptyMessage',
  'emptyTitle',
  'emptyDescription',
  'confirmLabel',
  'cancelLabel',
  'openLabel',
  'inputLabel',
  'inputPlaceholder',
  'sendLabel',
  'sendingLabel',
  'invalidEmailLabel',
  'successMessage',
  'errorMessage',
  'copyLabel',
  'downloadLabel',
])

const translationKeyProperties = new Set([
  'labelKey',
  'descriptionKey',
  'titleKey',
  'hintKey',
  'messageKey',
  'placeholderKey',
  'copyKey',
  'descKey',
  'emptyKey',
  'ariaLabelKey',
])

const staticKeyCache = new Map()

function collectStaticTranslationKeys(file) {
  const cached = staticKeyCache.get(file)
  if (cached) return cached
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const keys = new Set()

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const key = stringLiteralText(staticTranslationKey(node))
      if (key) keys.add(key)
    }
    if (ts.isPropertyAssignment(node)) {
      const propertyName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
        ? node.name.text
        : ''
      const key = translationKeyProperties.has(propertyName)
        ? stringLiteralText(node.initializer)
        : null
      if (key) keys.add(key)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  staticKeyCache.set(file, keys)
  return keys
}

function auditKeysAgainstNamespaces(keys, namespaces, description) {
  for (const key of keys) {
    if (publicEdition && key.startsWith('team.')) continue
    const owners = translationOwners.get(key)
    if (!owners || Array.from(owners).some((owner) => namespaces.has(owner))) continue
    errors.push(`${description}: i18n key ${key} belongs to unloaded namespace(s) ${Array.from(owners).sort().join(', ')}`)
  }
}

const overlayComponentFiles = new Map([
  ['NewApplicationDialog', path.join(sourceRoot, 'components', 'shared', 'NewApplicationDialog.tsx')],
  ['ShareDialog', path.join(sourceRoot, 'components', 'shared', 'ShareDialog.tsx')],
  ['DiscoverApplicationEnrichmentDialog', path.join(sourceRoot, 'components', 'shared', 'DiscoverApplicationEnrichmentDialog.tsx')],
  ['TeamWorkspaceChooser', path.join(sourceRoot, 'components', 'shared', 'TeamWorkspaceChooser.tsx')],
  ['NotificationCenter', path.join(sourceRoot, 'components', 'shared', 'NotificationCenter.tsx')],
  ['KeyboardShortcuts', path.join(sourceRoot, 'components', 'shared', 'KeyboardShortcuts.tsx')],
  ['CommandPalette', path.join(sourceRoot, 'components', 'shared', 'CommandPalette.tsx')],
  ['OnboardingTour', path.join(sourceRoot, 'components', 'shared', 'OnboardingTour.tsx')],
  ['SnippetEditorDialog', path.join(sourceRoot, 'components', 'shared', 'SnippetEditorDialog.tsx')],
  ['TeamSnippetEditorDialog', path.join(sourceRoot, 'components', 'shared', 'SnippetEditorDialog.tsx')],
  ['SnippetPhraseSettingsDialog', path.join(sourceRoot, 'components', 'shared', 'SnippetPhraseSettingsDialog.tsx')],
])

function jsxTagName(node) {
  return ts.isIdentifier(node) ? node.text : null
}

function jsxNamespaceArray(openingElement) {
  const attribute = openingElement.attributes.properties.find((item) => (
    ts.isJsxAttribute(item) && item.name.text === 'namespaces'
  ))
  const expression = attribute
    && ts.isJsxAttribute(attribute)
    && attribute.initializer
    && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : null
  if (!expression || !ts.isArrayLiteralExpression(expression)) return null
  const namespaces = expression.elements.map(stringLiteralText)
  return namespaces.every(Boolean) ? new Set(namespaces) : null
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
      const key = stringLiteralText(keyNode)
      const omittedPublicTeamKey = publicEdition
        && key
        && key.startsWith('team.')
      if (keyNode && key && !omittedPublicTeamKey && !translationKeys.has(key)) {
        errors.push(`${location(file, sourceFile, keyNode)}: missing English i18n key ${key}`)
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const propertyName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
        ? node.name.text
        : ''
      const key = translationKeyProperties.has(propertyName)
        ? stringLiteralText(node.initializer)
        : null
      if (key && !(publicEdition && key.startsWith('team.')) && !translationKeys.has(key)) {
        errors.push(`${location(file, sourceFile, node.initializer)}: missing English i18n key ${key}`)
      }
    }

    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, ' ').trim()
      if (/[A-Za-z\u3400-\u9fff]{2}/.test(value) && !isAllowedVisibleLiteral(value)) {
        errors.push(`${location(file, sourceFile, node)}: hardcoded JSX text ${JSON.stringify(value)}`)
      }
    }

    if (
      ts.isJsxExpression(node)
      && !ts.isJsxAttribute(node.parent)
      && node.expression
    ) {
      const literal = stringLiteralText(node.expression)
      const template = ts.isTemplateExpression(node.expression)
        ? [
            node.expression.head.text,
            ...node.expression.templateSpans.map((span) => span.literal.text),
          ].join('')
        : null
      const value = (literal ?? template)?.replace(/\s+/g, ' ').trim() ?? ''
      if (/[A-Za-z\u3400-\u9fff]{2}/.test(value) && !isAllowedVisibleLiteral(value)) {
        errors.push(`${location(file, sourceFile, node)}: hardcoded JSX expression ${JSON.stringify(value)}`)
      }
    }

    if (
      ts.isJsxAttribute(node)
      && node.initializer
      && visibleStringAttributes.has(node.name.text)
    ) {
      const value = ts.isStringLiteral(node.initializer)
        ? node.initializer.text
        : ts.isJsxExpression(node.initializer)
          ? stringLiteralText(node.initializer.expression)
          : null
      if (value && /[A-Za-z\u3400-\u9fff]{2}/.test(value) && !isAllowedAttributeLiteral(value)) {
        errors.push(`${location(file, sourceFile, node)}: hardcoded ${node.name.text} ${JSON.stringify(value)}`)
      }
    }

    if (
      ts.isJsxElement(node)
      && jsxTagName(node.openingElement.tagName) === 'LazyOverlayBoundary'
    ) {
      const namespaces = jsxNamespaceArray(node.openingElement)
      if (!namespaces) {
        errors.push(`${location(file, sourceFile, node.openingElement)}: LazyOverlayBoundary namespaces must be a static string array`)
      } else {
        const components = new Set()
        function collectOverlayComponents(child) {
          if (ts.isJsxElement(child)) {
            const name = jsxTagName(child.openingElement.tagName)
            if (name && overlayComponentFiles.has(name)) components.add(name)
          } else if (ts.isJsxSelfClosingElement(child)) {
            const name = jsxTagName(child.tagName)
            if (name && overlayComponentFiles.has(name)) components.add(name)
          }
          ts.forEachChild(child, collectOverlayComponents)
        }
        node.children.forEach(collectOverlayComponents)
        for (const component of components) {
          auditKeysAgainstNamespaces(
            collectStaticTranslationKeys(overlayComponentFiles.get(component)),
            namespaces,
            `${location(file, sourceFile, node.openingElement)} ${component}`,
          )
        }
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

function applicationScreenNamespaces() {
  const appFile = path.join(sourceRoot, 'App.tsx')
  const source = fs.readFileSync(appFile, 'utf8')
  const sourceFile = ts.createSourceFile(appFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let target = null

  function find(node) {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === 'languageNamespacesForScreen'
    ) {
      target = node
      return
    }
    if (!target) ts.forEachChild(node, find)
  }
  find(sourceFile)
  if (!target?.body) return null

  const base = new Set()
  let screenChain = null
  for (const statement of target.body.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.name.text === 'namespaces'
          && declaration.initializer
          && ts.isNewExpression(declaration.initializer)
          && declaration.initializer.arguments?.[0]
          && ts.isArrayLiteralExpression(declaration.initializer.arguments[0])
        ) {
          declaration.initializer.arguments[0].elements
            .map(stringLiteralText)
            .filter(Boolean)
            .forEach((namespace) => base.add(namespace))
        }
      }
    } else if (ts.isIfStatement(statement) && !screenChain) {
      screenChain = statement
    }
  }
  if (!screenChain) return null

  const result = new Map()
  let branch = screenChain
  while (branch) {
    const condition = branch.expression
    const screen = ts.isBinaryExpression(condition)
      && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && ts.isIdentifier(condition.left)
      && condition.left.text === 'screen'
      ? stringLiteralText(condition.right)
      : null
    if (!screen) break
    const namespaces = new Set(base)
    function collectNamespaceAdds(node) {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'namespaces'
        && node.expression.name.text === 'add'
      ) {
        const namespace = stringLiteralText(node.arguments[0])
        if (namespace) namespaces.add(namespace)
      }
      ts.forEachChild(node, collectNamespaceAdds)
    }
    collectNamespaceAdds(branch.thenStatement)
    result.set(screen, namespaces)
    branch = branch.elseStatement && ts.isIfStatement(branch.elseStatement)
      ? branch.elseStatement
      : null
  }
  return result
}

const screenSurfaceFiles = new Map([
  ['dashboard', [
    path.join(sourceRoot, 'components', 'screens', 'Dashboard.tsx'),
    path.join(sourceRoot, 'components', 'screens', 'Inspector.tsx'),
  ]],
  ['workspace', [
    path.join(sourceRoot, 'components', 'screens', 'ApplicationPane.tsx'),
    path.join(sourceRoot, 'components', 'screens', 'DossierView.tsx'),
    path.join(sourceRoot, 'components', 'screens', 'Inspector.tsx'),
    path.join(sourceRoot, 'components', 'screens', 'KanbanBoard.tsx'),
    path.join(sourceRoot, 'components', 'screens', 'ApplicationSmartTable.tsx'),
  ]],
  ['discover', [
    path.join(sourceRoot, 'components', 'screens', 'DiscoverScreen.tsx'),
    path.join(sourceRoot, 'components', 'shared', 'DiscoverWorkspace.tsx'),
    path.join(sourceRoot, 'components', 'shared', 'DiscoverAdvancedInsights.tsx'),
  ]],
  ['profile', [
    path.join(sourceRoot, 'components', 'screens', 'ProfileScreen.tsx'),
  ]],
  ['settings', [
    path.join(sourceRoot, 'components', 'screens', 'SettingsScreen.tsx'),
  ]],
  ['team', [
    path.join(sourceRoot, 'components', 'screens', 'TeamScreen.tsx'),
  ]],
])

const screenNamespaces = applicationScreenNamespaces()
if (!screenNamespaces) {
  errors.push('src/App.tsx: could not statically audit languageNamespacesForScreen')
} else {
  for (const [screen, files] of screenSurfaceFiles) {
    const namespaces = screenNamespaces.get(screen)
    if (!namespaces) {
      errors.push(`src/App.tsx: missing language namespace branch for ${screen}`)
      continue
    }
    for (const file of files) {
      if (!fs.existsSync(file)) continue
      auditKeysAgainstNamespaces(
        collectStaticTranslationKeys(file),
        namespaces,
        `${path.relative(process.cwd(), file)} on ${screen}`,
      )
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

console.log('UI i18n audit passed: static/dynamic key contracts, screen and overlay namespaces, visible copy, attributes, and error-message paths.')
