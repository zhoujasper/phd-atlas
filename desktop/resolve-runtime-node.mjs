import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function bundledDesktopNodeName(platform = process.platform) {
  return platform === 'win32' ? 'node.exe' : 'node'
}

export function bundledDesktopNodePath(resourcesPath, platform = process.platform) {
  if (!resourcesPath) return ''
  return join(resourcesPath, 'runtime', bundledDesktopNodeName(platform))
}

export function unpackAsarFilesystemPath(filePath) {
  return String(filePath ?? '').replace(/(^|[\\/])app\.asar(?!\.unpacked)(?=[\\/]|$)/g, '$1app.asar.unpacked')
}

export function resolveDesktopNodeWorkspace({
  packaged = false,
  projectRoot = '',
} = {}) {
  const root = String(projectRoot ?? '')
  const resolvedRoot = packaged ? unpackAsarFilesystemPath(root) : root
  return {
    projectRoot: resolvedRoot,
    entry: join(resolvedRoot, 'desktop', 'launch-runtime.mjs'),
  }
}

export function resolveDesktopNodeBinary({
  packaged = false,
  resourcesPath = '',
  execPath = process.execPath,
  platform = process.platform,
  electronVersion = '',
  exists = existsSync,
} = {}) {
  const bundled = bundledDesktopNodePath(resourcesPath, platform)
  if (packaged) {
    if (!bundled || !exists(bundled)) {
      const error = new Error('Packaged desktop runtime is missing its bundled Node.js binary.')
      error.code = 'DESKTOP_NODE_RUNTIME_MISSING'
      throw error
    }
    return {
      command: bundled,
      args: [],
      usesBundledNode: true,
    }
  }
  if (electronVersion) {
    return {
      command: execPath,
      args: [],
      usesBundledNode: false,
      useElectronAsNode: true,
    }
  }
  return {
    command: execPath,
    args: [],
    usesBundledNode: false,
    useElectronAsNode: false,
  }
}

export function desktopRuntimeChildEnv(baseEnv, resolved) {
  const childEnv = { ...baseEnv }
  if (resolved?.usesBundledNode) {
    delete childEnv.ELECTRON_RUN_AS_NODE
    delete childEnv.ELECTRON_NO_ASAR
    return childEnv
  }
  if (resolved?.useElectronAsNode) {
    childEnv.ELECTRON_RUN_AS_NODE = '1'
  }
  return childEnv
}
