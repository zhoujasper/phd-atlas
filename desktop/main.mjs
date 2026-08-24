import { app, BrowserWindow, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDesktopIntegrity } from './integrity.mjs'
import {
  desktopRuntimeChildEnv,
  resolveDesktopNodeBinary,
  resolveDesktopNodeWorkspace,
} from './resolve-runtime-node.mjs'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(desktopRoot)
const isDev = process.env.PHD_ATLAS_DESKTOP_DEV === '1' || !app.isPackaged

assertDesktopIntegrity(projectRoot, { dev: isDev })

const storageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
  || join(app.getPath('userData'), 'storage')

let child = null
let mainWindow = null

app.commandLine.appendSwitch('disable-remote-debugging-port')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(startDesktop)
}

app.on('window-all-closed', () => {
  stopRuntime()
  app.quit()
})

app.on('before-quit', stopRuntime)

async function startDesktop() {
  hardenSession(session.defaultSession)
  const port = await startRuntime()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(desktopRoot, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: isDev,
    },
  })
  if (!isDev) {
    mainWindow.removeMenu()
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(`http://127.0.0.1:${port}`)
    if (!allowed) event.preventDefault()
  })
  await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

function hardenSession(current) {
  current.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  current.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:",
        ],
      },
    })
  })
}

async function startRuntime() {
  const resolved = resolveDesktopNodeBinary({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
    platform: process.platform,
    electronVersion: process.versions.electron || '',
  })
  const env = desktopRuntimeChildEnv({
    ...process.env,
    PHD_ATLAS_DESKTOP: '1',
    PHD_ATLAS_STORAGE_ROOT: storageRoot,
    HOST: '127.0.0.1',
    PORT: process.env.PORT || '0',
  }, resolved)
  const workspace = resolveDesktopNodeWorkspace({
    packaged: app.isPackaged,
    projectRoot,
  })
  child = spawn(resolved.command, [...resolved.args, workspace.entry], {
    cwd: workspace.projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return await waitForReady(child)
}

function waitForReady(processRef) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Desktop runtime did not become ready.')), 60_000)
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const match = buffer.match(/desktop runtime ready on http:\/\/127\.0\.0\.1:(\d+)/u)
      if (match) {
        clearTimeout(timeout)
        processRef.stdout.off('data', onData)
        resolve(Number(match[1]))
      }
    }
    processRef.stdout.on('data', onData)
    processRef.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
    })
    processRef.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Desktop runtime exited before ready (${code}).`))
    })
  })
}

function stopRuntime() {
  if (!child || child.killed) return
  child.kill()
  child = null
}
