import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDesktopIntegrity } from './integrity.mjs'
import { desktopExternalUrlAllowed, desktopNavigationAllowed, desktopResponseHeaders } from './windowPolicy.mjs'
import { desktopContextMenuTemplate, desktopLanguages, desktopMenuTemplate, desktopTranslator, readDesktopLanguage, saveDesktopLanguage } from './localization.mjs'
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
let runtimeOrigin = null
let quitHandlerReady = false
let quitPrepared = false
let quitDiscardApproved = false
let quitRequestId = 0
let quitTimer = null
const languageFile = join(userDataRoot, 'desktop-language.json')
let desktopLanguage = readDesktopLanguage(languageFile, app.getPreferredSystemLanguages()[0])
let translate = desktopTranslator(desktopLanguage)

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
    const message = translate('portableFolderError')
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(desktopMenuTemplate(translate, { isDev })))
}

if (installPortableAppPaths()) {
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
      assertDesktopIntegrity(projectRoot, { dev: isDev })
      installNativeMacMenu()
      return startDesktop()
    }).catch((error) => {
      const message = translate(error?.code === 'DESKTOP_INTEGRITY_FAILED' ? 'integrityError' : 'startupError')
      dialog.showErrorBox('PhD Atlas', `${message}\n\n${error instanceof Error ? error.message : String(error)}`)
      app.quit()
    })
  }
}

function keepEditing() {
  if (quitTimer) clearTimeout(quitTimer)
  quitTimer = null
  quitPrepared = false
  isQuitting = false
  mainWindow?.show()
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning', title: 'PhD Atlas',
    message: translate('unsavedTitle'),
    detail: translate('unsavedDetail'),
    buttons: [translate('returnToEditing'), translate('discardAndQuit')],
    defaultId: 0, cancelId: 0,
  })
  if (choice === 1) {
    quitDiscardApproved = true
    quitPrepared = true
    app.quit()
  }
}

ipcMain.on('desktop:set-language', (event, language) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow?.webContents.mainFrame || !desktopLanguages.includes(language)) return
  if (desktopLanguage === language) { saveDesktopLanguage(languageFile, language); return }
  desktopLanguage = language
  translate = desktopTranslator(language)
  saveDesktopLanguage(languageFile, language)
  installNativeMacMenu()
})

ipcMain.on('desktop:quit-handler-ready', (event, ready) => {
  if (event.sender === mainWindow?.webContents) quitHandlerReady = ready !== false
})
ipcMain.on('desktop:quit-ready', (event, message) => {
  if (event.sender !== mainWindow?.webContents || !quitTimer || message?.requestId !== quitRequestId) return
  clearTimeout(quitTimer)
  quitTimer = null
  if (message.allowed !== true) { keepEditing(); return }
  quitPrepared = true
  app.quit()
})

app.on('before-quit', (event) => {
  if (!quitPrepared && quitHandlerReady && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault()
    if (!quitTimer) {
      quitTimer = setTimeout(keepEditing, 30_000)
      mainWindow.webContents.send('desktop:prepare-quit', ++quitRequestId)
    }
    return
  }
  isQuitting = true
})

// Let renderer beforeunload guards finish before stopping the local database.
app.on('will-quit', (event) => {
  if (!child) return
  event.preventDefault()
  void stopRuntime().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (!isMac) {
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
    runtimeOrigin = `http://127.0.0.1:${port}`
    await mainWindow.loadURL(runtimeOrigin)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('PhD Atlas', `${translate('startupError')}\n\n${detail}`)
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
      additionalArguments: [`--phd-atlas-language=${desktopLanguage}`],
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
    if (desktopExternalUrlAllowed(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = desktopNavigationAllowed(url, { runtimeOrigin, splashPath: join(desktopRoot, 'splash.html') })
    if (!allowed) event.preventDefault()
  })
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow?.webContents.send('desktop:locale', { language: desktopLanguage, loading: translate('loading') })
  })
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = desktopContextMenuTemplate(translate, params, {
      allowLink: desktopExternalUrlAllowed,
      openLink: (url) => { void shell.openExternal(url) },
      copyLink: (url) => clipboard.writeText(url),
    })
    if (template.length) Menu.buildFromTemplate(template).popup({ window: mainWindow })
  })
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (quitDiscardApproved) event.preventDefault()
    else keepEditing()
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
      responseHeaders: desktopResponseHeaders(details.responseHeaders),
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
    PHD_ATLAS_DESKTOP_PORT_FILE: join(userDataRoot, 'desktop-http.json'),
    NODE_ENV: isDev ? (process.env.NODE_ENV || 'development') : 'production',
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
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  child.once('exit', () => {
    if (runtimeOrigin && !isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('PhD Atlas', translate('runtimeStopped'))
      app.quit()
    }
  })
  return await waitForReady(child)
}

function waitForReady(processRef) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(translate('startupTimeout'))), 60_000)
    let buffer = ''
    const onData = (chunk) => {
      buffer = (buffer + chunk.toString('utf8')).slice(-16_384)
      const match = buffer.match(/desktop runtime ready on http:\/\/127\.0\.0\.1:(\d+)/u)
      if (match) {
        clearTimeout(timeout)
        processRef.stdout.off('data', onData)
        processRef.stdout.resume()
        resolve(Number(match[1]))
      }
    }
    processRef.stdout.on('data', onData)
    processRef.once('error', (error) => { clearTimeout(timeout); reject(error) })
    processRef.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
    })
    processRef.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(translate('startupExited', { code })))
    })
  })
}

function stopRuntime() {
  if (!child) return Promise.resolve()
  const current = child
  child = null
  if (current.exitCode !== null || current.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (current.exitCode === null && current.signalCode === null) current.kill('SIGKILL')
    }, 75_000)
    const finished = () => { clearTimeout(timeout); resolve() }
    current.once('exit', finished)
    current.once('error', finished)
    try {
      if (current.connected) {
        current.send({ type: 'phd-atlas-desktop-shutdown' }, (error) => {
          if (error && current.exitCode === null && current.signalCode === null) current.kill('SIGTERM')
        })
      } else current.kill('SIGTERM')
    } catch { finished() }
  })
}
