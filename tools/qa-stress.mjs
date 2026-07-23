import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createApp } from '../server/index.js'
import { createStressApplicationInput } from './stress-fixtures.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function nowStamp() {
  return new Date().toISOString()
}

function parseArgs(argv) {
  return {
    skipMail: argv.includes('--skip-mail'),
    ownerEmail: 'jasper@example.com',
    ownerPassword: 'demo123456',
    adminEmail: 'admin@phd-atlas.local',
    adminPassword: 'admin123456',
  }
}

const options = parseArgs(process.argv.slice(2))
const steps = []
const runStartedAt = nowStamp()

function record(name, status, details = {}) {
  steps.push({ name, status, ...details })
  const mark = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL'
  console.log(`[${mark}] ${name}${details.message ? ` - ${details.message}` : ''}`)
}

async function runStep(name, fn) {
  const startedAt = Date.now()
  try {
    const { skip = false, ...details } = (await fn()) ?? {}
    record(name, skip ? 'skip' : 'pass', { durationMs: Date.now() - startedAt, ...details })
  } catch (error) {
    const details = {
      durationMs: Date.now() - startedAt,
      message: error?.message ?? String(error),
      code: error?.code,
    }
    if (error?.status != null) details.httpStatus = error.status
    record(name, 'fail', details)
  }
}

async function request(baseUrl, pathName, { token, method = 'GET', body, headers } = {}) {
  const requestHeaders = new Headers(headers)
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`)
  let requestBody = body
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    requestHeaders.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json()
    const isEnvelope = payload && typeof payload === 'object' && 'ok' in payload
    if (!response.ok || (isEnvelope && payload.ok === false)) {
      const error = new Error(payload.error?.message ?? `HTTP ${response.status}`)
      error.status = response.status
      error.code = payload.error?.code
      error.field = payload.error?.field
      throw error
    }
    return isEnvelope ? payload.data : payload
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return {
    contentType,
    text: await response.text(),
    status: response.status,
  }
}

async function expectFailure(name, fn, expectedCode) {
  try {
    await fn()
  } catch (error) {
    if (!expectedCode || error.code === expectedCode) {
      return { message: `${name} rejected with ${error.code ?? error.status}` }
    }
    throw new Error(`${name} rejected with ${error.code}, expected ${expectedCode}`)
  }
  throw new Error(`${name} unexpectedly succeeded`)
}

function mailAccountsFromEnv() {
  const accounts = []
  if (process.env.PHD_ATLAS_MAIL_USER && process.env.PHD_ATLAS_MAIL_PASS) {
    accounts.push({
      label: 'primary',
      user: process.env.PHD_ATLAS_MAIL_USER,
      pass: process.env.PHD_ATLAS_MAIL_PASS,
      canReceive: process.env.PHD_ATLAS_MAIL_CAN_RECEIVE !== 'false',
    })
  }
  if (process.env.PHD_ATLAS_MAIL2_USER && process.env.PHD_ATLAS_MAIL2_PASS) {
    accounts.push({
      label: 'secondary',
      user: process.env.PHD_ATLAS_MAIL2_USER,
      pass: process.env.PHD_ATLAS_MAIL2_PASS,
      canReceive: process.env.PHD_ATLAS_MAIL2_CAN_RECEIVE === 'true',
    })
  }
  return accounts
}

async function smtpSendTest(account, recipient, options = {}) {
  const subject = options.subject ?? `PhD Atlas QA mail-test ${Date.now()} ${account.label}`
  const transporter = nodemailer.createTransport({
    host: process.env.PHD_ATLAS_SMTP_HOST || 'smtp.qiye.aliyun.com',
    port: Number(process.env.PHD_ATLAS_SMTP_PORT || 465),
    secure: Number(process.env.PHD_ATLAS_SMTP_PORT || 465) === 465,
    auth: { user: account.user, pass: account.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  try {
    await transporter.verify()
    const info = await transporter.sendMail({
      from: account.user,
      to: recipient,
      subject,
      text: options.text ?? `Self-test generated at ${nowStamp()}.`,
      html: options.html,
      attachments: options.attachments,
    })
    return { subject, messageId: info.messageId }
  } finally {
    transporter.close()
  }
}

function createImapClient(account) {
  return new ImapFlow({
    host: process.env.PHD_ATLAS_IMAP_HOST || 'imap.qiye.aliyun.com',
    port: Number(process.env.PHD_ATLAS_IMAP_PORT || 993),
    secure: Number(process.env.PHD_ATLAS_IMAP_PORT || 993) === 993,
    auth: { user: account.user, pass: account.pass },
    logger: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 90_000,
  })
}

async function imapSearchOpenMailbox(client, subject, options = {}) {
  const since = new Date(Date.now() - 30 * 60 * 1000)
  const matches = await client.search({ since, subject })
  if (matches.length > 0) {
    if (!options.includeSource) return { matched: true, matches: matches.length }
  }

  const mailboxPath = client.mailbox?.path || 'INBOX'
  const status = await client.status(mailboxPath, { uidNext: true }).catch(() => null)
  const uidNext = status?.uidNext || client.mailbox?.uidNext || 1
  const fromUid = Math.max(1, uidNext - 120)
  let scanned = 0
  for await (const message of client.fetch(`${fromUid}:*`, { envelope: true, source: Boolean(options.includeSource) }, { uid: true })) {
    scanned += 1
    if (message.envelope?.subject?.includes(subject)) {
      return { matched: true, matches: 1, scanned, source: message.source, uid: message.uid }
    }
  }
  return { matched: false, matches: 0, scanned }
}

async function imapWaitForSubject(account, subject, options = {}) {
  const client = createImapClient(account)
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      let lastResult = { matched: false, matches: 0, scanned: 0 }
      for (let attempt = 0; attempt < 12; attempt += 1) {
        lastResult = await imapSearchOpenMailbox(client, subject, options)
        if (lastResult.matched) return lastResult
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
      return lastResult
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

function communicationSendPayload(subject, from, to, attachments = []) {
  return {
    subject,
    summary: `QA email body for ${subject}`,
    date: '2026-07-09',
    time: '09:00',
    channel: 'Email',
    direction: 'outgoing',
    messageType: 'outgoing-email',
    from,
    to,
    attachments,
  }
}

function appendMailPayload(form, payload) {
  form.set('payload', JSON.stringify(payload))
  return form
}

async function sendApplicationEmail(baseUrl, token, applicationId, payload, file) {
  const form = new FormData()
  if (file) {
    form.set('files', file.blob, file.name)
  }
  return request(baseUrl, `/api/applications/${applicationId}/communications/send`, {
    token,
    method: 'POST',
    body: appendMailPayload(form, payload),
  })
}

async function runMailSuite(baseUrl, adminToken) {
  if (options.skipMail) {
    record('mail suite', 'skip', { message: 'Skipped by --skip-mail' })
    return
  }
  const accounts = mailAccountsFromEnv()
  if (accounts.length === 0) {
    record('mail suite', 'skip', { message: 'No PHD_ATLAS_MAIL*_USER/PASS environment variables were provided' })
    return
  }

  const receivingAccount = accounts.find((account) => account.canReceive)
  for (const account of accounts) {
    const recipient = receivingAccount ?? account
    const stepName = `mail ${account.label} SMTP send capability`
    await runStep(stepName, async () => {
      const result = await smtpSendTest(account, recipient.user)
      return { message: `sent from ${account.user} to ${recipient.user}`, subject: result.subject, messageId: result.messageId }
    })
  }

  const receiveSender = accounts.find((account) => account !== receivingAccount) ?? receivingAccount
  if (receivingAccount && receiveSender) {
    const receiveStepName = `mail ${receiveSender.label} to ${receivingAccount.label} delivery`
    await runStep(receiveStepName, async () => {
      const result = await smtpSendTest(receiveSender, receivingAccount.user)
      return { message: `sent from ${receiveSender.user} to ${receivingAccount.user}`, subject: result.subject, messageId: result.messageId }
    })
    const sentStep = [...steps].reverse().find((step) => step.name === receiveStepName && step.status === 'pass')
    if (sentStep?.subject) {
      await runStep(`mail ${receivingAccount.label} IMAP receive from ${receiveSender.label}`, async () => {
        const result = await imapWaitForSubject(receivingAccount, sentStep.subject)
        if (result.matched) return { message: `found ${result.matches} matching message(s)` }
        throw new Error('Sent test message was not visible in INBOX within 60 seconds')
      })
    }
  } else {
    record('mail IMAP receive', 'skip', { message: 'No receiving mailbox was marked as receivable' })
  }

  const adminAccount = accounts.find((account) => account.label === 'secondary') ?? accounts[0]
  const notificationMailbox = receivingAccount?.user ?? adminAccount.user
  await runStep('app email send attachment and IMAP receive attachment', async () => {
    if (!receivingAccount || !createdApplicationId) return { message: 'No receiving mailbox or QA application available' }
    await request(baseUrl, '/api/settings', {
      token: adminToken,
      method: 'PATCH',
      body: {
        sendFrom: adminAccount.user,
        smtpHost: process.env.PHD_ATLAS_SMTP_HOST || 'smtp.qiye.aliyun.com',
        smtpPort: Number(process.env.PHD_ATLAS_SMTP_PORT || 465),
        smtpUser: adminAccount.user,
        smtpPass: adminAccount.pass,
        smtpTls: true,
      },
    })
    const subject = `PhD Atlas QA app attachment ${Date.now()}`
    const attachmentText = `PhD Atlas attachment roundtrip ${Date.now()}`
    const payload = communicationSendPayload(subject, adminAccount.user, receivingAccount.user, [{
      fileName: 'qa-mail-safe.txt',
      mimeType: 'text/plain',
      uploadIndex: 0,
    }])
    const sent = await sendApplicationEmail(baseUrl, adminToken, createdApplicationId, payload, {
      name: 'qa-mail-safe.txt',
      blob: new Blob([attachmentText], { type: 'text/plain' }),
    })
    if (!sent.delivery?.sent) throw new Error('Application email was not marked sent')
    const received = await imapWaitForSubject(receivingAccount, subject, { includeSource: true })
    if (!received.matched || !received.source) throw new Error('Sent attachment email was not received with source')
    const parsed = await simpleParser(received.source)
    const attachment = parsed.attachments.find((item) => item.filename === 'qa-mail-safe.txt')
    if (!attachment) throw new Error('Received email did not include qa-mail-safe.txt')
    if (!attachment.content.toString('utf8').includes(attachmentText)) throw new Error('Received attachment content did not match')
    return { message: `sent and received ${attachment.filename} (${attachment.size} bytes)` }
  })

  await runStep('app email rejects unsafe attachments', async () => {
    if (!createdApplicationId) return { message: 'No QA application available' }
    const unsafeSubject = `PhD Atlas QA unsafe attachment ${Date.now()}`
    const unsafePayload = communicationSendPayload(unsafeSubject, adminAccount.user, notificationMailbox, [{
      fileName: 'invoice.pdf.exe',
      mimeType: 'application/octet-stream',
      uploadIndex: 0,
    }])
    await expectFailure('blocked executable mail attachment', () => sendApplicationEmail(
      baseUrl,
      adminToken,
      createdApplicationId,
      unsafePayload,
      { name: 'invoice.pdf.exe', blob: new Blob(['blocked executable'], { type: 'application/octet-stream' }) },
    ), 'UNSUPPORTED_FILE_TYPE')

    const eicarPayload = communicationSendPayload(`${unsafeSubject} eicar`, adminAccount.user, notificationMailbox, [{
      fileName: 'scan-note.txt',
      mimeType: 'text/plain',
      uploadIndex: 0,
    }])
    await expectFailure('virus marker mail attachment', () => sendApplicationEmail(
      baseUrl,
      adminToken,
      createdApplicationId,
      eicarPayload,
      { name: 'scan-note.txt', blob: new Blob(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'], { type: 'text/plain' }) },
    ), 'UNSAFE_ATTACHMENT')
    return { message: 'blocked executable extension and EICAR test marker' }
  })

  await runStep('incoming mail imports attachment metadata and phishing warning', async () => {
    if (!receivingAccount || !createdApplicationId) return { message: 'No receiving mailbox or QA application available' }
    const application = await request(baseUrl, `/api/applications/${createdApplicationId}`, { token: adminToken })
    application.professor.email = adminAccount.user
    await request(baseUrl, `/api/applications/${createdApplicationId}`, {
      token: adminToken,
      method: 'PUT',
      body: application,
    })
    await request(baseUrl, '/api/settings', {
      token: adminToken,
      method: 'PATCH',
      body: {
        incomingProtocol: 'imap',
        incomingHost: process.env.PHD_ATLAS_IMAP_HOST || 'imap.qiye.aliyun.com',
        incomingPort: Number(process.env.PHD_ATLAS_IMAP_PORT || 993),
        incomingUser: receivingAccount.user,
        incomingPass: receivingAccount.pass,
        incomingTls: true,
      },
    })
    const subject = `PhD Atlas QA inbound attachment phishing ${Date.now()}`
    await smtpSendTest(adminAccount, receivingAccount.user, {
      subject,
      text: 'Please review the attached funding note. https://example.edu/login',
      html: '<p>Please review <a href="https://evil.example/phish">https://example.edu/login</a>.</p>',
      attachments: [{
        filename: 'inbound-funding-note.txt',
        content: `Inbound attachment ${subject}`,
        contentType: 'text/plain',
      }],
    })
    const fetchResult = await request(baseUrl, '/api/settings/fetch-mail-now', {
      token: adminToken,
      method: 'POST',
    })
    const updated = await request(baseUrl, `/api/applications/${createdApplicationId}`, { token: adminToken })
    const imported = updated.communications.find((item) => item.subject === subject)
    if (!imported) throw new Error(`Fetched mail was not filed; result=${JSON.stringify(fetchResult)}`)
    if (!imported.attachments?.some((item) => item.fileName === 'inbound-funding-note.txt' && item.source === 'mail')) {
      throw new Error('Imported email did not keep safe attachment metadata')
    }
    if (!/Security warning|安全提醒/.test(imported.summary)) {
      throw new Error('Imported phishing-like email did not include a security warning')
    }
    return { message: `filed=${fetchResult.filed}, attachments=${imported.attachments.length}` }
  })

  await runStep('app admin SMTP test email', async () => {
    await request(baseUrl, '/api/admin/settings', {
      token: adminToken,
      method: 'PATCH',
      body: {
        notificationMailbox,
        smtpHost: process.env.PHD_ATLAS_SMTP_HOST || 'smtp.qiye.aliyun.com',
        smtpPort: Number(process.env.PHD_ATLAS_SMTP_PORT || 465),
        smtpUser: adminAccount.user,
        smtpPass: adminAccount.pass,
        smtpTls: true,
      },
    })
    const result = await request(baseUrl, '/api/admin/settings/test-email', {
      token: adminToken,
      method: 'POST',
    })
    return { message: `sent to ${result.delivery}` }
  })
}

const app = createApp()
const server = await new Promise((resolve) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
})
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`
let adminToken = ''
let userToken = ''
let createdApplicationId = ''
let createdMaterialId = ''
let createdTaskId = ''
let createdShareId = ''
let createdBackupFileName = ''
let createdProfileAssetId = ''
let createdProfileShareId = ''
let createdNotificationId = ''
let createdGroupId = ''
let createdTeamGroupId = ''

try {
  await runStep('auth login user', async () => {
    const session = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: options.ownerEmail, password: options.ownerPassword, scope: 'app' },
    })
    userToken = session.token
    return { message: session.user.email }
  })

  await runStep('auth login admin', async () => {
    const session = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: options.adminEmail, password: options.adminPassword, scope: 'admin' },
    })
    adminToken = session.token
    return { message: session.user.email }
  })

  await runStep('list and analytics with stress data', async () => {
    const applications = await request(baseUrl, '/api/applications', { token: userToken })
    const analytics = await request(baseUrl, '/api/analytics', { token: userToken })
    if (!Array.isArray(applications) || applications.length === 0) throw new Error('No applications returned')
    return { message: `${applications.length} applications, ${analytics.statusCounts?.length ?? 0} status buckets` }
  })

  await runStep('application create', async () => {
    const application = await request(baseUrl, '/api/applications', {
      token: adminToken,
      method: 'POST',
      body: createStressApplicationInput(1),
    })
    createdApplicationId = application.id
    return { message: application.id }
  })

  await runStep('application validation rejects bad email', async () => (
    expectFailure('bad application email', () => request(baseUrl, '/api/applications', {
      token: adminToken,
      method: 'POST',
      body: { ...createStressApplicationInput(2), professorEmail: 'not-an-email' },
    }), 'VALIDATION_ERROR')
  ))

  await runStep('application update boundary fields', async () => {
    const application = await request(baseUrl, `/api/applications/${createdApplicationId}`, { token: adminToken })
    application.progress = 100
    application.priority = 0
    application.tags = ['qa', 'boundary', 'long-value-with-wrapping-check']
    application.professor.research = `${application.professor.research} ${'Long boundary note. '.repeat(80)}`
    const updated = await request(baseUrl, `/api/applications/${createdApplicationId}`, {
      token: adminToken,
      method: 'PUT',
      body: application,
    })
    return { message: `${updated.progress}% progress, ${updated.professor.research.length} chars` }
  })

  await runStep('material create and upload', async () => {
    const form = new FormData()
    form.set('name', 'QA stress PDF')
    form.set('type', 'File')
    form.set('status', 'Draft')
    form.set('group', 'Custom')
    form.set('details', 'Created by QA stress runner')
    form.set('reminderEnabled', 'true')
    form.set('reminderDate', '2026-08-01')
    const material = await request(baseUrl, `/api/applications/${createdApplicationId}/materials`, {
      token: adminToken,
      method: 'POST',
      body: form,
    })
    createdMaterialId = material.id
    const uploadForm = new FormData()
    uploadForm.set('file', new Blob(['%PDF-1.4\n% QA file\n'], { type: 'application/pdf' }), 'qa.pdf')
    const uploaded = await request(baseUrl, `/api/applications/${createdApplicationId}/materials/${createdMaterialId}/file`, {
      token: adminToken,
      method: 'POST',
      body: uploadForm,
    })
    return { message: `${uploaded.name} ${uploaded.version}` }
  })

  await runStep('upload rejects blocked extension', async () => {
    const uploadForm = new FormData()
    uploadForm.set('file', new Blob(['echo blocked'], { type: 'text/plain' }), 'blocked.ps1')
    return expectFailure('blocked material upload', () => request(baseUrl, `/api/applications/${createdApplicationId}/materials/${createdMaterialId}/file`, {
      token: adminToken,
      method: 'POST',
      body: uploadForm,
    }), 'UNSUPPORTED_FILE_TYPE')
  })

  await runStep('task create patch and upload', async () => {
    const task = await request(baseUrl, `/api/applications/${createdApplicationId}/tasks`, {
      token: adminToken,
      method: 'POST',
      body: {
        title: 'QA task with attachment',
        due: '2026-08-15',
        done: false,
        details: 'Boundary task',
        reminderEnabled: true,
        reminderOffsets: ['7d', '1d'],
        reminderTime: '09:00',
        attachmentRequired: true,
        allowedFileTypes: ['.txt'],
      },
    })
    createdTaskId = task.id
    await request(baseUrl, `/api/applications/${createdApplicationId}/tasks/${createdTaskId}`, {
      token: adminToken,
      method: 'PATCH',
      body: { done: true, details: 'Patched by QA' },
    })
    const uploadForm = new FormData()
    uploadForm.set('file', new Blob(['QA task attachment'], { type: 'text/plain' }), 'qa-task.txt')
    const uploaded = await request(baseUrl, `/api/applications/${createdApplicationId}/tasks/${createdTaskId}/file`, {
      token: adminToken,
      method: 'POST',
      body: uploadForm,
    })
    return { message: `${uploaded.title} ${uploaded.fileName}` }
  })

  await runStep('communication log and patch', async () => {
    const communication = await request(baseUrl, `/api/applications/${createdApplicationId}/communications`, {
      token: adminToken,
      method: 'POST',
      body: {
        subject: 'QA correspondence',
        channel: 'Email',
        date: '2026-08-02',
        time: '10:10',
        summary: 'Logged by QA stress runner.',
        direction: 'outgoing',
        messageType: 'outgoing-email',
        from: 'admin@phd-atlas.local',
        to: 'qa@example.test',
      },
    })
    await request(baseUrl, `/api/applications/${createdApplicationId}/communications/${communication.id}`, {
      token: adminToken,
      method: 'PATCH',
      body: { summary: 'Patched QA correspondence.' },
    })
    return { message: communication.id }
  })

  await runStep('scholarship and fee create', async () => {
    const scholarship = await request(baseUrl, `/api/applications/${createdApplicationId}/scholarships`, {
      token: adminToken,
      method: 'POST',
      body: {
        name: 'QA Fellowship',
        amount: '$42,000',
        startDate: '2026-08-01',
        endDate: '2026-09-01',
        school: 'QA School',
        issuer: 'QA Office',
        status: 'Preparing',
        notes: 'Created by stress runner.',
        materials: [{ id: 'qa-sch-mat', name: 'Budget', status: 'Draft', due: '2026-08-10', details: '' }],
        tasks: [{ id: 'qa-sch-task', title: 'Submit budget', due: '2026-08-12', done: false, details: '' }],
        timeline: [{ id: 'qa-sch-time', title: 'Decision', date: '2026-09-01', note: '' }],
      },
    })
    const fee = await request(baseUrl, `/api/applications/${createdApplicationId}/fees`, {
      token: adminToken,
      method: 'POST',
      body: { amount: 95, currency: 'USD', paidDate: '2026-08-03', waived: false, notes: 'QA fee' },
    })
    await request(baseUrl, `/api/applications/${createdApplicationId}/fees/${fee.id}`, {
      token: adminToken,
      method: 'PATCH',
      body: { waived: true, notes: 'QA waived' },
    })
    return { message: `${scholarship.id}, ${fee.id}` }
  })

  await runStep('share create access and revoke', async () => {
    const share = await request(baseUrl, `/api/applications/${createdApplicationId}/share`, {
      token: adminToken,
      method: 'POST',
      body: { expiresAt: null, permission: 'upload', sections: ['overview', 'materials', 'tasks'] },
    })
    createdShareId = share.id
    const shared = await request(baseUrl, `/api/share/${share.token}`)
    await request(baseUrl, `/api/applications/${createdApplicationId}/share/${createdShareId}`, {
      token: adminToken,
      method: 'DELETE',
    })
    return { message: `shared ${shared.application?.school?.name ?? 'application'}` }
  })

  await runStep('exports json csv excel pdf', async () => {
    const formats = ['json', 'csv', 'excel', 'pdf']
    const sizes = []
    for (const format of formats) {
      const result = await request(baseUrl, `/api/exports?format=${format}`, { token: adminToken })
      const size = result?.text?.length ?? JSON.stringify(result ?? '').length
      sizes.push(`${format}:${size}`)
      if (size === 0) throw new Error(`${format} export was empty`)
    }
    return { message: sizes.join(', ') }
  })

  await runStep('backup create and delete', async () => {
    const backup = await request(baseUrl, '/api/backups', {
      token: adminToken,
      method: 'POST',
      body: { applicationId: createdApplicationId },
    })
    createdBackupFileName = backup.fileName
    await request(baseUrl, `/api/backups/${encodeURIComponent(createdBackupFileName)}`, {
      token: adminToken,
      method: 'DELETE',
    })
    createdBackupFileName = ''
    return { message: backup.fileName }
  })

  await runStep('profile asset create share upload revoke delete', async () => {
    const asset = await request(baseUrl, '/api/profile-assets', {
      token: adminToken,
      method: 'POST',
      body: { name: 'QA Asset', kind: 'CV', description: 'QA', notes: 'QA notes' },
    })
    createdProfileAssetId = asset.id
    const form = new FormData()
    form.set('file', new Blob(['QA profile asset'], { type: 'text/plain' }), 'qa-asset.txt')
    await request(baseUrl, `/api/profile-assets/${createdProfileAssetId}/files`, {
      token: adminToken,
      method: 'POST',
      body: form,
    })
    const share = await request(baseUrl, `/api/profile-assets/${createdProfileAssetId}/share`, {
      token: adminToken,
      method: 'POST',
      body: { expiresAt: null, note: 'QA upload share' },
    })
    createdProfileShareId = share.id
    await request(baseUrl, `/api/profile-assets/${createdProfileAssetId}/share/${createdProfileShareId}`, {
      token: adminToken,
      method: 'DELETE',
    })
    createdProfileShareId = ''
    await request(baseUrl, `/api/profile-assets/${createdProfileAssetId}`, { token: adminToken, method: 'DELETE' })
    createdProfileAssetId = ''
    return { message: asset.id }
  })

  await runStep('notifications admin publish and state changes', async () => {
    const publish = await request(baseUrl, '/api/admin/notifications/publish', {
      token: adminToken,
      method: 'POST',
      body: {
        title: 'QA notification',
        body: 'QA notification body',
        channels: ['in_app'],
        audiences: ['all'],
        userIds: [],
        memberIds: [],
        groupIds: [],
      },
    })
    const notifications = await request(baseUrl, '/api/notifications', { token: adminToken })
    createdNotificationId = notifications[0]?.id
    if (createdNotificationId) {
      await request(baseUrl, `/api/notifications/${createdNotificationId}/read`, { token: adminToken, method: 'POST' })
      await request(baseUrl, `/api/notifications/${createdNotificationId}/unread`, { token: adminToken, method: 'POST' })
      await request(baseUrl, `/api/notifications/${createdNotificationId}/archive`, { token: adminToken, method: 'POST' })
    }
    return { message: `created ${publish.created}, emailed ${publish.emailed}` }
  })

  await runStep('settings patch and incoming socket check', async () => {
    const [mailAccount] = mailAccountsFromEnv()
    if (options.skipMail || !mailAccount) {
      return {
        skip: true,
        message: options.skipMail
          ? 'Skipped by --skip-mail'
          : 'No PHD_ATLAS_MAIL*_USER/PASS environment variables were provided',
      }
    }
    await request(baseUrl, '/api/settings', {
      token: adminToken,
      method: 'PATCH',
      body: {
        highContrast: false,
        themeAccent: '#0071e3',
        incomingProtocol: 'imap',
        incomingHost: process.env.PHD_ATLAS_IMAP_HOST || 'imap.qiye.aliyun.com',
        incomingPort: Number(process.env.PHD_ATLAS_IMAP_PORT || 993),
        incomingTls: true,
      },
    })
    const incoming = await request(baseUrl, '/api/settings/test-incoming-mail', { token: adminToken, method: 'POST' })
    return { message: `${incoming.protocol} ${incoming.host}:${incoming.port}` }
  })

  await runStep('admin users logs system info', async () => {
    const users = await request(baseUrl, '/api/admin/users', { token: adminToken })
    const logs = await request(baseUrl, '/api/admin/logs', { token: adminToken })
    const csv = await request(baseUrl, '/api/admin/logs/export', { token: adminToken })
    const info = await request(baseUrl, '/api/admin/system-info', { token: adminToken })
    if (!Array.isArray(users) || users.length === 0) throw new Error('No admin users returned')
    return { message: `${users.length} users, ${logs.length} logs, ${csv.text.length} csv chars, node ${info.nodeVersion}` }
  })

  await runStep('admin notification group CRUD', async () => {
    const users = await request(baseUrl, '/api/admin/users', { token: adminToken })
    const group = await request(baseUrl, '/api/admin/notification-groups', {
      token: adminToken,
      method: 'POST',
      body: { name: `QA group ${Date.now()}`, memberIds: [users[0].id] },
    })
    createdGroupId = group.id
    await request(baseUrl, `/api/admin/notification-groups/${createdGroupId}`, {
      token: adminToken,
      method: 'PATCH',
      body: { name: `${group.name} patched`, memberIds: [users[0].id] },
    })
    await request(baseUrl, `/api/admin/notification-groups/${createdGroupId}`, { token: adminToken, method: 'DELETE' })
    createdGroupId = ''
    return { message: group.id }
  })

  await runStep('team list and notification group smoke', async () => {
    const workspacesPayload = await request(baseUrl, '/api/teams/mine/workspaces', { token: adminToken })
    const teamsPayload = await request(baseUrl, '/api/teams/mine', { token: adminToken })
    const workspaces = Array.isArray(workspacesPayload) ? workspacesPayload : []
    const teams = Array.isArray(teamsPayload) ? teamsPayload : []
    const team = teams[0] ?? workspaces[0]?.team
    if (!team?.id) return { message: 'No team workspace available' }
    const members = await request(baseUrl, `/api/teams/${team.id}/members`, { token: adminToken })
    const group = await request(baseUrl, `/api/teams/${team.id}/notification-groups`, {
      token: adminToken,
      method: 'POST',
      body: { name: `QA team group ${Date.now()}`, memberIds: members.slice(0, 1).map((member) => member.id) },
    })
    createdTeamGroupId = group.id
    await request(baseUrl, `/api/teams/${team.id}/notification-groups/${createdTeamGroupId}`, {
      token: adminToken,
      method: 'DELETE',
    })
    createdTeamGroupId = ''
    return { message: `${members.length} members` }
  })

  await runMailSuite(baseUrl, adminToken)
} finally {
  await runStep('cleanup QA application', async () => {
    if (!createdApplicationId) return { message: 'No QA app to clean' }
    await request(baseUrl, `/api/applications/${createdApplicationId}`, { token: adminToken, method: 'DELETE' })
    createdApplicationId = ''
    return { message: 'Deleted QA app' }
  })
  if (createdBackupFileName) {
    await request(baseUrl, `/api/backups/${encodeURIComponent(createdBackupFileName)}`, {
      token: adminToken,
      method: 'DELETE',
    }).catch(() => {})
  }
  if (createdProfileAssetId) {
    await request(baseUrl, `/api/profile-assets/${createdProfileAssetId}`, {
      token: adminToken,
      method: 'DELETE',
    }).catch(() => {})
  }
  if (createdGroupId) {
    await request(baseUrl, `/api/admin/notification-groups/${createdGroupId}`, {
      token: adminToken,
      method: 'DELETE',
    }).catch(() => {})
  }
  if (createdTeamGroupId) {
    const teams = adminToken ? await request(baseUrl, '/api/teams/mine', { token: adminToken }).catch(() => []) : []
    const team = teams[0]
    if (team?.id) {
      await request(baseUrl, `/api/teams/${team.id}/notification-groups/${createdTeamGroupId}`, {
        token: adminToken,
        method: 'DELETE',
      }).catch(() => {})
    }
  }
  await new Promise((resolve) => server.close(resolve))
}

const failed = steps.filter((step) => step.status === 'fail')
const skipped = steps.filter((step) => step.status === 'skip')
const passed = steps.filter((step) => step.status === 'pass')
const report = {
  ok: failed.length === 0,
  startedAt: runStartedAt,
  completedAt: nowStamp(),
  summary: {
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
  },
  steps,
}

const outputDir = path.join(projectRoot, 'logs', 'tmp')
await fs.mkdir(outputDir, { recursive: true })
const reportPath = path.join(outputDir, `qa-stress-report-${Date.now()}.json`)
await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
console.log(`Report: ${reportPath}`)

if (failed.length > 0) {
  process.exit(1)
}
