import { app, BrowserWindow, Menu, dialog, nativeTheme, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDesktopIntegrity } from './integrity.mjs'
import {
  assertDirectoryWritable,
  installPortableLayout,
  resolvePortableAppDirectory,
  resolvePortableStorageRoot,
  resolvePortableUserDataRoot,
} from './portablePaths.mjs'
import {
  desktopRuntimeChildEnv,
  resolveDesktopNodeBinary,
  resolveDesktopNodeWorkspace,
} from './resolve-runtime-node.mjs'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(desktopRoot)
const isMac = process.platform === 'darwin'
const isDev = process.env.PHD_ATLAS_DESKTOP_DEV === '1' || !app.isPackaged
const portableOptions = {
  packaged: app.isPackaged,
  platform: process.platform,
  execPath: process.execPath,
  projectRoot,
  envStorageRoot: process.env.PHD_ATLAS_STORAGE_ROOT,
}
const portableRoot = resolvePortableAppDirectory(portableOptions)
const storageRoot = resolvePortableStorageRoot(portableOptions)
const userDataRoot = resolvePortableUserDataRoot(portableOptions)

let child = null
let mainWindow = null
let isQuitting = false

app.setName('PhD Atlas')
app.commandLine.appendSwitch('disable-remote-debugging-port')
nativeTheme.themeSource = 'system'

function installPortableAppPaths() {
  try {
    if (app.isPackaged) installPortableLayout(portableRoot)
    assertDirectoryWritable(portableRoot)
    assertDirectoryWritable(storageRoot)
    assertDirectoryWritable(userDataRoot)
  } catch {
    const message = [
      '这是便携版：请把应用程序复制到一个可写文件夹后再打开。申请数据保存在同一文件夹的 User Data/ 里。',
      'This portable app needs a writable folder. Copy the app there and open it; your work stays in that folder’s User Data/ directory.',
    ].join('\n\n')
    const showAndQuit = () => {
      dialog.showErrorBox('PhD Atlas', message)
      app.quit()
    }
    if (app.isReady()) showAndQuit()
    else void app.whenReady().then(showAndQuit)
    return false
  }
  app.setPath('appData', portableRoot)
  app.setPath('userData', userDataRoot)
  app.setPath('sessionData', userDataRoot)
  app.setPath('crashDumps', join(userDataRoot, 'Crashpad'))
  if (typeof app.setAppLogsPath === 'function') {
    app.setAppLogsPath(join(userDataRoot, 'logs'))
  }
  return true
}

function installNativeMacMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
}

if (installPortableAppPaths()) {
  assertDesktopIntegrity(projectRoot, { dev: isDev })
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    })
    app.whenReady().then(() => {
      installNativeMacMenu()
      return startDesktop()
    }).catch((error) => {
      dialog.showErrorBox('PhD Atlas', error instanceof Error ? error.message : String(error))
      app.quit()
    })
  }
}

app.on('before-quit', () => {
  isQuitting = true
  stopRuntime()
})

app.on('window-all-closed', () => {
  if (!isMac) {
    stopRuntime()
    app.quit()
  }
})

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void startDesktop()
    return
  }
  mainWindow.show()
  mainWindow.focus()
})

async function startDesktop() {
  hardenSession(session.defaultSession)
  const windowReady = createMainWindow()
  const runtimeReady = startRuntime()
  await windowReady
  try {
    const port = await runtimeReady
    if (!mainWindow || mainWindow.isDestroyed()) return
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('PhD Atlas', `桌面运行时未能启动。\n\n${detail}`)
    app.quit()
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    return Promise.resolve()
  }
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#111114' : '#f5f5f7'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor,
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 16 } : undefined,
    roundedCorners: true,
    webPreferences: {
      preload: join(desktopRoot, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: isDev,
      backgroundThrottling: false,
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
    const allowed = url.startsWith('http://127.0.0.1') || url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })
  mainWindow.on('close', (event) => {
    if (isMac && !isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  const shown = new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show()
      }
      resolve()
    }
    mainWindow.once('ready-to-show', finish)
    setTimeout(finish, 280)
  })
  void mainWindow.loadFile(join(desktopRoot, 'splash.html')).catch(() => {
    mainWindow.show()
  })
  return shown
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
  const current = child
  child = null
  current.kill('SIGTERM')
  setTimeout(() => {
    if (!current.killed) current.kill('SIGKILL')
  }, 1200).unref?.()
}
