import { createHash } from 'node:crypto'

const PRODUCTION_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]
const PORTABLE_PACKAGE_FIELDS = [
  'engines',
  'os',
  'cpu',
  'libc',
  'packageManager',
  'overrides',
]

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
    .map(([name, version]) => [String(name).trim(), String(version).trim()])
    .filter(([name, version]) => name && version)
    .sort(([left], [right]) => compareText(left, right))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function productionDependencyNames(runtimePackage) {
  const optionalPeerNames = new Set(
    Object.entries(runtimePackage.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional)
      .map(([name]) => name),
  )
  return [...new Set([
    ...Object.keys(runtimePackage.dependencies ?? {}),
    ...Object.keys(runtimePackage.optionalDependencies ?? {}),
    ...Object.keys(runtimePackage.peerDependencies ?? {})
      .filter((name) => !optionalPeerNames.has(name)),
  ])].sort(compareText)
}

function resolveLockedDependency(packages, fromPackagePath, dependencyName) {
  let current = fromPackagePath
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`
    if (packages[candidate]) return candidate
    const nestedIndex = current.lastIndexOf('/node_modules/')
    if (nestedIndex >= 0) {
      current = current.slice(0, nestedIndex)
      continue
    }
    if (current) {
      current = ''
      continue
    }
    return null
  }
}

function dependencyNamesForLockedPackage(record) {
  const optionalPeers = new Set(
    Object.entries(record.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional)
      .map(([name]) => name),
  )
  return [
    ...Object.keys(record.dependencies ?? {}),
    ...Object.keys(record.optionalDependencies ?? {}),
    ...Object.keys(record.peerDependencies ?? {}).filter((name) => !optionalPeers.has(name)),
  ]
}

export function createRuntimePackageJson(packageJson) {
  const runtimePackage = {
    name: packageJson.name,
    private: packageJson.private !== false,
    version: packageJson.version,
    type: packageJson.type ?? 'module',
    scripts: {
      start: packageJson.scripts?.start ?? 'node tools/start-server.mjs',
    },
  }
  for (const field of PORTABLE_PACKAGE_FIELDS) {
    if (packageJson[field] !== undefined) runtimePackage[field] = packageJson[field]
  }
  for (const field of PRODUCTION_DEPENDENCY_FIELDS) {
    const dependencies = sortedRecord(packageJson[field])
    if (dependencies) runtimePackage[field] = dependencies
  }
  if (runtimePackage.peerDependencies && packageJson.peerDependenciesMeta) {
    runtimePackage.peerDependenciesMeta = packageJson.peerDependenciesMeta
  }
  if (productionDependencyNames(runtimePackage).length === 0) {
    throw new Error('package.json must declare at least one production dependency.')
  }
  return runtimePackage
}

export function createRuntimePackageLock(packageJson, packageLock) {
  if (packageLock?.lockfileVersion !== 3 || !packageLock.packages?.['']) {
    throw new Error('The release update builder requires an npm package-lock.json with lockfileVersion 3.')
  }
  const runtimePackage = createRuntimePackageJson(packageJson)
  const sourcePackages = packageLock.packages
  const retainedPaths = new Set([''])
  const pending = []

  for (const dependencyName of productionDependencyNames(runtimePackage)) {
    const dependencyPath = resolveLockedDependency(sourcePackages, '', dependencyName)
    if (!dependencyPath) {
      throw new Error(`Production dependency "${dependencyName}" is missing from package-lock.json.`)
    }
    pending.push(dependencyPath)
  }

  while (pending.length > 0) {
    const packagePath = pending.pop()
    if (retainedPaths.has(packagePath)) continue
    const record = sourcePackages[packagePath]
    if (!record) throw new Error(`Locked production package "${packagePath}" is missing.`)
    retainedPaths.add(packagePath)
    for (const dependencyName of dependencyNamesForLockedPackage(record)) {
      const dependencyPath = resolveLockedDependency(sourcePackages, packagePath, dependencyName)
      if (dependencyPath) {
        pending.push(dependencyPath)
        continue
      }
      if (Object.hasOwn(record.optionalDependencies ?? {}, dependencyName)) continue
      throw new Error(
        `Locked production package "${packagePath}" cannot resolve dependency "${dependencyName}".`,
      )
    }
  }

  const rootRecord = {
    ...sourcePackages[''],
    name: runtimePackage.name,
    version: runtimePackage.version,
  }
  delete rootRecord.devDependencies
  for (const field of PRODUCTION_DEPENDENCY_FIELDS) {
    if (runtimePackage[field]) rootRecord[field] = runtimePackage[field]
    else delete rootRecord[field]
  }
  if (runtimePackage.peerDependenciesMeta) {
    rootRecord.peerDependenciesMeta = runtimePackage.peerDependenciesMeta
  } else {
    delete rootRecord.peerDependenciesMeta
  }

  const packages = { '': rootRecord }
  for (const packagePath of [...retainedPaths].filter(Boolean).sort(compareText)) {
    const record = { ...sourcePackages[packagePath] }
    delete record.dev
    delete record.devOptional
    packages[packagePath] = record
  }

  return {
    name: runtimePackage.name,
    version: runtimePackage.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  }
}

function vendoredFileName(record) {
  return `${createHash('sha256')
    .update(`${record.resolved}\0${record.integrity}`)
    .digest('hex')}.tgz`
}

export function createVendoredRuntimePackageLock(runtimePackageLock) {
  const packageLock = structuredClone(runtimePackageLock)
  const artifacts = []
  for (const [packagePath, record] of Object.entries(packageLock.packages ?? {})) {
    if (!packagePath) continue
    if (typeof record.resolved !== 'string' || !record.resolved.startsWith('https://')) {
      throw new Error(
        `Production package "${packagePath}" must resolve to an integrity-pinned HTTPS tarball.`,
      )
    }
    if (typeof record.integrity !== 'string' || !record.integrity.trim()) {
      throw new Error(`Production package "${packagePath}" is missing its lockfile integrity.`)
    }
    const fileName = vendoredFileName(record)
    artifacts.push({
      packagePath,
      source: record.resolved,
      integrity: record.integrity,
      fileName,
    })
    record.resolved = `file:tools/runtime-packages/${fileName}`
  }
  artifacts.sort((left, right) => compareText(left.packagePath, right.packagePath))
  return { packageLock, artifacts }
}
