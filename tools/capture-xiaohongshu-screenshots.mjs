import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import WebSocket from 'ws'

const appOrigin = process.env.CAPTURE_APP_ORIGIN || 'http://127.0.0.1:5173'
const apiOrigin = process.env.CAPTURE_API_ORIGIN || 'http://127.0.0.1:4317'
const captureEmail = process.env.CAPTURE_EMAIL || 'jasper@example.com'
const capturePassword = process.env.CAPTURE_PASSWORD || 'demo123456'
const adminEmail = process.env.CAPTURE_ADMIN_EMAIL || 'admin@phd-atlas.local'
const adminPassword = process.env.CAPTURE_ADMIN_PASSWORD || 'admin123456'
const outputDirectory = path.resolve('docs/xiaohongshu/screenshots')

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

async function waitFor(send, predicate, message) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const ready = await evaluate(send, `(() => Boolean(${predicate}))()`)
    if (ready) {
      await evaluate(send, 'document.fonts.ready.then(() => true)')
      await new Promise((resolve) => setTimeout(resolve, 380))
      const stillReady = await evaluate(send, `(() => Boolean(${predicate}))()`)
      if (stillReady) return
    }
    await new Promise((resolve) => setTimeout(resolve, 160))
  }
  throw new Error(message)
}

async function setViewport(send) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 1600,
    screenHeight: 900,
  })
}

async function navigate(send, url, readyPredicate) {
  await send('Page.navigate', { url })
  await waitFor(
    send,
    `location.pathname === ${JSON.stringify(new URL(url).pathname)} && !document.querySelector('.launch-screen') && !document.querySelector('.app-recovery-screen') && (${readyPredicate})`,
    `Timed out waiting for ${url}.`,
  )
}

async function login(scope, email, password) {
  const response = await fetch(`${apiOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, scope }),
  })
  const payload = await response.json()
  if (!response.ok || !payload?.ok) throw new Error(`Capture login failed (${response.status}).`)
  const session = payload.data?.token ? payload.data : payload.data?.session
  if (!session?.token) throw new Error(`Capture ${scope} login did not return a session token.`)
  return session
}

async function ensureAppSession(send) {
  const session = await login('app', captureEmail, capturePassword)
  await evaluate(send, `localStorage.setItem('phd-atlas-session', ${JSON.stringify(JSON.stringify(session))})`)
}

async function preparePersonal(send) {
  await ensureAppSession(send)
  await evaluate(send, `(() => {
    localStorage.setItem('phd-atlas-language', 'zh')
    localStorage.setItem('phd-atlas-theme', 'light')
    localStorage.setItem('phd-atlas-interface-mode', 'personal')
    localStorage.setItem('phd-atlas-onboarding-done', '1')
    return true
  })()`)
  await navigate(send, `${appOrigin}/`, `document.querySelector('.atlas-shell')`)
}

async function firstApplicationId(send) {
  return evaluate(send, `(() => {
    const fromPath = location.pathname.match(/^\\/applications\\/([^/]+)/)?.[1]
    if (fromPath) return decodeURIComponent(fromPath)
    const stored = localStorage.getItem('phd-atlas-selectedId')
    if (stored) return stored
    const session = JSON.parse(localStorage.getItem('phd-atlas-session') || 'null')
    return fetch('/api/applications', { headers: { Authorization: 'Bearer ' + (session?.token || '') } })
      .then((response) => response.json())
      .then((payload) => {
        const rows = Array.isArray(payload) ? payload : payload?.data?.items ?? payload?.data ?? payload?.items ?? []
        return Array.isArray(rows) ? rows.find((row) => typeof row?.id === 'string')?.id ?? '' : ''
      })
  })()`)
}

async function clickText(send, selector, matcher) {
  const clicked = await evaluate(send, `(() => {
    const pattern = ${JSON.stringify(matcher)}
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => new RegExp(pattern, 'i').test([
        candidate.textContent || '',
        candidate.getAttribute('aria-label') || '',
        candidate.getAttribute('title') || '',
      ].join(' ')))
    if (!(element instanceof HTMLElement)) return false
    element.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click ${selector} matching ${matcher}.`)
}

async function openTeamDiscover(send) {
  await navigate(send, `${appOrigin}/`, `document.querySelector('.atlas-shell')`)
  await clickText(send, '[data-tour="nav-mode-switch"]', '切换到团队|switch to team')
  await waitFor(send, `document.querySelector('.team-screen')`, 'Timed out switching to Team.')
  const clicked = await evaluate(send, `(() => {
    const buttons = [...document.querySelectorAll('.atlas-rail nav button')]
    const target = buttons.find((button) => /发现|discover/i.test(button.textContent || '')) || buttons[4]
    if (!(target instanceof HTMLElement)) return false
    target.click()
    return true
  })()`)
  if (!clicked) throw new Error('Could not open Team Discover.')
  await waitFor(send, `document.querySelector('.team-discover-student-card')`, 'Timed out waiting for Team Discover.')
  await evaluate(send, `(() => {
    const cards = [...document.querySelectorAll('.team-discover-student-card')]
    const card = cards.find((candidate) => /Lina Zhao/.test(candidate.textContent || '')) || cards[0]
    if (!(card instanceof HTMLElement)) return false
    card.click()
    return true
  })()`)
  await waitFor(send, `document.querySelector('.discover-screen .discover-workspace')`, 'Timed out waiting for the Discover workspace.')
}

async function openAdmin(send) {
  await evaluate(send, `(() => {
    localStorage.removeItem('phd-atlas-admin-session')
    localStorage.setItem('phd-atlas-admin-language', 'zh')
    return true
  })()`)
  await send('Page.navigate', { url: `${appOrigin}/admin` })
  await waitFor(send, `document.querySelector('input[type="email"]') && document.querySelector('input[type="password"]')`, 'Timed out waiting for Admin login.')
  const filled = await evaluate(send, `(() => {
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const email = document.querySelector('input[type="email"]')
    const password = document.querySelector('input[type="password"]')
    const button = [...document.querySelectorAll('button')].find((candidate) => /登录管理员后台|sign in to admin/i.test(candidate.textContent || ''))
    if (!(email instanceof HTMLInputElement) || !(password instanceof HTMLInputElement) || !(button instanceof HTMLElement)) return false
    setValue(email, ${JSON.stringify(adminEmail)})
    setValue(password, ${JSON.stringify(adminPassword)})
    button.click()
    return true
  })()`)
  if (!filled) throw new Error('Could not fill the Admin login form.')
  await waitFor(send, `document.querySelector('.admin-shell')`, 'Timed out waiting for the Admin panel.')
}

async function capture(send, name) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 94,
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const fileName = `${name}.jpg`
  await writeFile(path.join(outputDirectory, fileName), Buffer.from(screenshot.data, 'base64'))
  console.log(fileName)
}

await mkdir(outputDirectory, { recursive: true })
const { socket, send } = await connect()

try {
  await send('Page.enable')
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await setViewport(send)

  await preparePersonal(send)
  await capture(send, '01-dashboard')

  await navigate(send, `${appOrigin}/applications`, `document.querySelector('.application-pane') && document.querySelectorAll('.application-line').length > 0`)
  await capture(send, '02-application-list')

  const applicationId = await firstApplicationId(send)
  if (!applicationId) throw new Error('Could not resolve an application id for the screenshot set.')
  const applicationBase = `${appOrigin}/applications/${encodeURIComponent(applicationId)}`

  await navigate(send, `${applicationBase}/dossier`, `document.querySelector('.dossier-pane')`)
  await capture(send, '03-application-dossier')
  await navigate(send, `${applicationBase}/materials`, `document.querySelector('.checklist-page')`)
  await capture(send, '05-checklist')
  await navigate(send, `${applicationBase}/timeline`, `document.querySelector('.timeline-page')`)
  await capture(send, '06-timeline')
  await navigate(send, `${applicationBase}/mail`, `document.querySelector('.correspondence-page')`)
  await capture(send, '07-correspondence')
  await navigate(send, `${appOrigin}/profile`, `document.querySelector('.simple-screen .profile-hero')`)
  await capture(send, '04-profile')

  await openTeamDiscover(send)
  await capture(send, '08-discover-ai-in-development')

  await navigate(send, `${appOrigin}/team`, `document.querySelector('.team-screen')`)
  await capture(send, '09-team')

  await openAdmin(send)
  await capture(send, '10-admin')
} finally {
  socket.close()
}
