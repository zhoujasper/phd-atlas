import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import WebSocket from 'ws'

const languages = process.env.CAPTURE_LANG
  ? [process.env.CAPTURE_LANG]
  : ['en', 'zh', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'th', 'vi']
const themes = process.env.CAPTURE_THEME ? [process.env.CAPTURE_THEME] : ['light', 'dark']
const surfaceDefinitions = {
  workspace: { type: 'tab', tab: 'materials', tabIndex: 1, selector: '.checklist-page' },
  correspondence: { type: 'tab', tab: 'mail', tabIndex: 2, selector: '.correspondence-page' },
  funding: { type: 'tab', tab: 'funding', tabIndex: 3, selector: '.funding-page' },
  timeline: { type: 'tab', tab: 'timeline', tabIndex: 4, selector: '.timeline-page' },
  discover: { type: 'team-discover', selector: '.discover-screen .discover-workspace' },
  profile: { type: 'nav', nav: 'profile', selector: '.simple-screen .profile-hero' },
}
const surfaces = process.env.CAPTURE_SURFACE
  ? [process.env.CAPTURE_SURFACE]
  : Object.keys(surfaceDefinitions)
const outputDirectory = path.resolve('public/assets/product-tour')
const appOrigin = process.env.CAPTURE_APP_ORIGIN || 'http://127.0.0.1:5173'
const apiOrigin = process.env.CAPTURE_API_ORIGIN || 'http://127.0.0.1:4317'
const captureEmail = process.env.CAPTURE_EMAIL || 'jasper@example.com'
const capturePassword = process.env.CAPTURE_PASSWORD || 'demo123456'
const captureWebpQuality = 82
const viewports = {
  desktop: { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
}

for (const surface of surfaces) {
  if (!surfaceDefinitions[surface]) throw new Error(`Unknown capture surface: ${surface}`)
}

function readJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

async function connect() {
  const targets = await readJson('http://127.0.0.1:9222/json')
  const target = targets.find((candidate) => candidate.type === 'page')
  if (!target) throw new Error('No Chrome page target is available on port 9222.')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  let nextId = 0
  const pending = new Map()
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

  return { socket, send }
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}

async function login() {
  const response = await fetch(`${apiOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: captureEmail, password: capturePassword, scope: 'app' }),
  })
  const payload = await response.json()
  if (!response.ok || !payload?.ok) {
    throw new Error(`Capture login failed (${response.status}).`)
  }
  const session = payload.data?.token ? payload.data : payload.data?.session
  if (!session?.token) throw new Error('Capture login did not return a session token.')
  return session
}

async function waitFor(send, predicate, message) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const ready = await evaluate(send, `(() => Boolean(${predicate}))()`)
    if (ready) {
      await evaluate(send, 'document.fonts.ready.then(() => true)')
      await new Promise((resolve) => setTimeout(resolve, 320))
      const stillReady = await evaluate(send, `(() => Boolean(${predicate}))()`)
      if (stillReady) return
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(message)
}

function readyPredicate(selector) {
  return `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector('.launch-screen') && !document.querySelector('.app-recovery-screen') && !document.querySelector('[aria-busy="true"]')`
}

async function waitForWorkspace(send, selector) {
  await waitFor(
    send,
    `document.querySelector('.atlas-shell.workspace-layout') && document.querySelector(${JSON.stringify(selector)}) && (window.innerWidth <= 820 || document.querySelector('.inspector-pane')) && document.querySelector('.application-line.selected') && document.querySelectorAll('.application-line').length === 4 && !document.querySelector('[aria-busy="true"]')`,
    `Timed out waiting for the real application workspace (${selector}).`,
  )
}

async function click(send, selector, index = 0) {
  const clicked = await evaluate(send, `(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!(element instanceof HTMLElement)) return false
    element.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click ${selector} at index ${index}.`)
}

async function setViewport(send, viewport) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  })
}

async function openWorkspace(send, session, language, theme) {
  const initialDefinition = surfaceDefinitions.workspace
  const applicationUrl = `${appOrigin}/applications/eth-data-wang/${initialDefinition.tab}`
  await evaluate(send, `(() => {
    localStorage.setItem('phd-atlas-session', ${JSON.stringify(JSON.stringify(session))})
    localStorage.setItem('phd-atlas-language', ${JSON.stringify(language)})
    localStorage.setItem('phd-atlas-theme', ${JSON.stringify(theme)})
    localStorage.setItem('phd-atlas-screen', 'workspace')
    localStorage.setItem('phd-atlas-interface-mode', 'personal')
    localStorage.setItem('phd-atlas-team-section', 'overview')
    localStorage.setItem('phd-atlas-selectedId', 'eth-data-wang')
    localStorage.setItem('phd-atlas-tab', ${JSON.stringify(initialDefinition.tab)})
    localStorage.setItem('phd-atlas-view-mode', 'list')
    localStorage.setItem('phd-atlas-onboarding-done', '1')
    location.assign(${JSON.stringify(applicationUrl)})
    return true
  })()`)
  await waitForWorkspace(send, initialDefinition.selector)
}

async function openSurface(send, surface) {
  const definition = surfaceDefinitions[surface]
  if (definition.type === 'tab') {
    await click(send, '[data-tour="dossier-tabs"] [role="tab"]', definition.tabIndex)
    await waitForWorkspace(send, definition.selector)
    return
  }
  if (definition.type === 'nav') {
    await click(send, `[data-tour="nav-${definition.nav}"]`)
    await waitFor(send, readyPredicate(definition.selector), `Timed out waiting for ${surface}.`)
    return
  }

  await click(send, '[data-tour="nav-mode-switch"]')
  await waitFor(send, readyPredicate('.team-screen'), 'Timed out switching to the Team workspace.')
  await click(send, '.atlas-rail nav button', 4)
  await waitFor(send, readyPredicate('.team-discover-student-card'), 'Timed out waiting for the Team Discover student picker.')
  const openedStudent = await evaluate(send, `(() => {
    const cards = [...document.querySelectorAll('.team-discover-student-card')]
    const card = cards.find((candidate) => candidate.textContent?.includes('Lina Zhao')) || cards[0]
    if (!(card instanceof HTMLElement)) return false
    card.click()
    return true
  })()`)
  if (!openedStudent) throw new Error('Could not open a Team Discover student.')
  await waitFor(send, readyPredicate(definition.selector), 'Timed out waiting for the real Discover workspace.')
}

async function capture(send, surface, language, theme, viewportName) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'webp',
    quality: captureWebpQuality,
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const mobileSuffix = viewportName === 'mobile' ? '-mobile' : ''
  const fileName = `${surface}-${language}-${theme}${mobileSuffix}.webp`
  await writeFile(path.join(outputDirectory, fileName), Buffer.from(screenshot.data, 'base64'))
  console.log(fileName)
}

await mkdir(outputDirectory, { recursive: true })
const session = await login()
const { socket, send } = await connect()

try {
  await send('Page.enable')
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })

  for (const language of languages) {
    for (const theme of themes) {
      for (const [viewportName, viewport] of Object.entries(viewports)) {
        await setViewport(send, viewport)
        await openWorkspace(send, session, language, theme)

        const requestedTabs = surfaces.filter((surface) => surfaceDefinitions[surface].type === 'tab')
        for (const surface of requestedTabs) {
          if (surface !== 'workspace') await openSurface(send, surface)
          await capture(send, surface, language, theme, viewportName)
        }

        if (surfaces.includes('profile')) {
          await openSurface(send, 'profile')
          await capture(send, 'profile', language, theme, viewportName)
        }
        if (surfaces.includes('discover')) {
          await openSurface(send, 'discover')
          await capture(send, 'discover', language, theme, viewportName)
        }
      }
    }
  }
} finally {
  socket.close()
}
