import {
  applyDesktopAccountSettings,
  applyDesktopLockState,
  createDesktopLockState,
  decryptDesktopSecret,
  desktopPublicRuntime,
  desktopUnlockPolicy,
  desktopWebQuotaMessage,
  encryptDesktopSecret,
  isDesktopLocalUnlinked,
  isDesktopShareEnabled,
  mergeDesktopApplicationMappings,
  normalizeDesktopOrigin,
  readDesktopRuntimeState,
  writeDesktopRuntimeState,
  writeDesktopUnlockPassword,
} from './desktopRuntime.js'
import {
  collectProfileAssetStorageNames,
  collectSnapshotFiles,
  collectUploadStorageNames,
  createCompleteWorkspaceSnapshot,
  decodeSnapshotFileBytes,
  parseCompleteWorkspaceSnapshot,
  restoreImportedUserSettings,
} from './desktopCompleteExport.js'
import {
  createDesktopRemoteClient,
  planDesktopRemotePush,
  pushMissingDesktopApplications,
} from './desktopRemoteSync.js'

export function installDesktopPublicRoutes(app, options = {}) {
  const wrap = options.asyncHandler ?? ((handler) => handler)
  const send = options.ok ?? defaultOk
  const fail = options.fail ?? defaultFail
  const storageRootFor = options.storageRootFor ?? (() => options.storageRoot)
  const issueLocalSession = options.issueLocalSession
  const verifyUnlockPassword = options.verifyUnlockPassword

  app.get('/desktop-shell.js', (_request, response) => {
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (app.locals.desktopEnabled) {
      response.send('window.phdAtlasDesktop=Object.assign({enabled:true},window.phdAtlasDesktop||{});')
      return
    }
    response.send('window.phdAtlasDesktop=window.phdAtlasDesktop||{enabled:false};')
  })

  app.get('/api/desktop/runtime', wrap(async (request, response) => {
    if (!app.locals.desktopEnabled) {
      fail(response, 404, 'NOT_FOUND', `API route not found: ${request.method} ${request.originalUrl}`)
      return
    }
    const lock = await ensureDesktopLock(app, storageRootFor(request))
    const state = await readDesktopRuntimeState(storageRootFor(request))
    send(response, desktopPublicRuntime(state, { enabled: true, unlocked: lock.unlocked }))
  }))

  app.post('/api/desktop/session', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    const lock = await ensureDesktopLock(app, storageRootFor(request))
    if (lock.required && !lock.unlocked) {
      fail(response, 401, 'DESKTOP_UNLOCK_REQUIRED', 'This desktop app is locked. Enter the opening password.')
      return
    }
    const session = await issueLocalSession(request)
    const state = await readDesktopRuntimeState(storageRootFor(request))
    send(response, {
      ...session,
      runtime: desktopPublicRuntime(state, { enabled: true, unlocked: lock.unlocked }),
    })
  }))

  app.post('/api/desktop/unlock', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    const lock = await ensureDesktopLock(app, storageRootFor(request))
    if (!lock.required) {
      lock.unlocked = true
      const session = await issueLocalSession(request)
      const state = await readDesktopRuntimeState(storageRootFor(request))
      send(response, {
        ...session,
        runtime: desktopPublicRuntime(state, { enabled: true, unlocked: true }),
      })
      return
    }
    const password = String(request.body?.password ?? '')
    if (!password) {
      fail(response, 400, 'DESKTOP_UNLOCK_PASSWORD_REQUIRED', 'Enter the opening password.', 'password')
      return
    }
    const verification = await verifyUnlockPassword(password, lock.passwordHash)
    if (!verification?.valid) {
      fail(response, 401, 'DESKTOP_UNLOCK_INVALID', 'The opening password is incorrect.', 'password')
      return
    }
    lock.unlocked = true
    const session = await issueLocalSession(request)
    const state = await readDesktopRuntimeState(storageRootFor(request))
    send(response, {
      ...session,
      runtime: desktopPublicRuntime(state, { enabled: true, unlocked: true }),
    })
  }))
}

export function installDesktopApiRoutes(app, options = {}) {
  const wrap = options.asyncHandler ?? ((handler) => handler)
  const send = options.ok ?? defaultOk
  const fail = options.fail ?? defaultFail
  const storageRootFor = options.storageRootFor ?? (() => options.storageRoot)
  const secretFor = options.secretFor ?? (() => options.secret || process.env.JWT_SECRET || 'phd-atlas-desktop')
  const lockedWriteStore = options.lockedWriteStore
  const normalizeApplication = options.normalizeApplication
  const createId = options.createId
  const nowStamp = options.nowStamp ?? (() => new Date().toISOString())
  const vault = options.vault
  const getInterviewPrepWorkspaceRecord = options.getInterviewPrepWorkspaceRecord
  const saveInterviewPrepWorkspaceRecord = options.saveInterviewPrepWorkspaceRecord
  const fetchImpl = options.fetchImpl ?? fetch
  const remoteClient = options.remoteClient ?? createDesktopRemoteClient({ fetchImpl })
  const hashUnlockPassword = options.hashUnlockPassword
  const verifyUnlockPassword = options.verifyUnlockPassword

  app.get('/api/desktop/export', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    send(response, await buildCompleteExport(request, {
      vault,
      getInterviewPrepWorkspaceRecord,
    }))
  }))

  app.get('/api/workspace/complete-export', wrap(async (request, response) => {
    send(response, await buildCompleteExport(request, {
      vault,
      getInterviewPrepWorkspaceRecord,
    }))
  }))

  app.post('/api/desktop/import', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    const state = await readDesktopRuntimeState(storageRootFor(request))
    if (!isDesktopLocalUnlinked(state)) {
      fail(response, 409, 'DESKTOP_IMPORT_LOCAL_ONLY', 'Import complete archives while using local storage.')
      return
    }
    let snapshot
    try {
      snapshot = parseCompleteWorkspaceSnapshot(request.body?.snapshot ?? request.body)
    } catch (error) {
      fail(response, error.status || 400, error.code || 'DESKTOP_IMPORT_INVALID', error.message)
      return
    }
    const imported = await importCompleteSnapshot(request, snapshot, {
      vault,
      lockedWriteStore,
      normalizeApplication,
      createId,
      nowStamp,
      getInterviewPrepWorkspaceRecord,
      saveInterviewPrepWorkspaceRecord,
    })
    send(response, imported)
  }))

  app.post('/api/desktop/connect', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    const origin = normalizeDesktopOrigin(request.body?.origin ?? request.body?.remoteOrigin)
    const email = String(request.body?.email ?? request.body?.username ?? '').trim()
    const password = String(request.body?.password ?? '')
    if (!origin) {
      fail(response, 400, 'VALIDATION_ERROR', 'Enter the HTTPS URL of your deployed PhD Atlas system.', 'origin')
      return
    }
    if (!email || !password) {
      fail(response, 400, 'VALIDATION_ERROR', 'Enter the web account email and password.')
      return
    }
    let session
    try {
      session = await remoteClient.login(origin, email, password)
    } catch (error) {
      fail(response, error.status || 409, error.code || 'DESKTOP_CONNECT_FAILED', error.message)
      return
    }
    const remoteApplications = await remoteClient.listApplications(origin, session.token)
    const localApplications = (request.store.applications ?? []).filter((application) => (
      application.ownerId === request.user.id && !application.teamId
    ))
    const plan = planDesktopRemotePush(localApplications, remoteApplications, session.usage)
    if (!plan.quota.ok) {
      fail(response, 409, 'APPLICATION_LIMIT_REACHED', desktopWebQuotaMessage(plan.quota))
      return
    }
    const pushedMappings = await pushMissingDesktopApplications({
      client: remoteClient,
      origin,
      token: session.token,
      missing: plan.missing,
    })
    const mappings = mergeDesktopApplicationMappings(localApplications, plan.remote, pushedMappings)
    const nextState = await writeDesktopRuntimeState(storageRootFor(request), {
      mode: 'remote',
      remoteOrigin: origin,
      remoteEmail: email,
      remoteToken: encryptDesktopSecret(session.token, secretFor(request)),
      remoteUsage: session.usage,
      applicationMappings: mappings,
      linkedAt: nowStamp(),
    })
    request.user.settings = applyDesktopAccountSettings(request.user.settings, nextState)
    const lock = await ensureDesktopLock(app, storageRootFor(request))
    send(response, {
      runtime: desktopPublicRuntime(nextState, { enabled: true, unlocked: lock.unlocked }),
      pushed: pushedMappings.length,
      remoteApplicationCount: plan.remote.length + pushedMappings.length,
    })
  }))

  app.post('/api/desktop/disconnect', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    const nextState = await writeDesktopRuntimeState(storageRootFor(request), {
      mode: 'local',
      remoteOrigin: null,
      remoteEmail: null,
      remoteToken: null,
      remoteUsage: null,
      applicationMappings: [],
      linkedAt: null,
    })
    request.user.settings = applyDesktopAccountSettings(request.user.settings, nextState)
    const lock = await ensureDesktopLock(app, storageRootFor(request))
    send(response, desktopPublicRuntime(nextState, { enabled: true, unlocked: lock.unlocked }))
  }))

  app.post('/api/desktop/unlock-password', wrap(async (request, response) => {
    if (!requireDesktop(app, request, response, fail)) return
    const storageRoot = storageRootFor(request)
    const lock = await ensureDesktopLock(app, storageRoot)
    const enabled = request.body?.enabled !== false
    const password = String(request.body?.password ?? request.body?.newPassword ?? '')
    const confirmPassword = String(request.body?.confirmPassword ?? '')
    const currentPassword = String(request.body?.currentPassword ?? '')

    if (lock.required) {
      if (!currentPassword) {
        fail(response, 400, 'DESKTOP_UNLOCK_PASSWORD_REQUIRED', 'Enter the current opening password.', 'currentPassword')
        return
      }
      const current = await verifyUnlockPassword(currentPassword, lock.passwordHash)
      if (!current?.valid) {
        fail(response, 401, 'DESKTOP_UNLOCK_INVALID', 'The opening password is incorrect.', 'currentPassword')
        return
      }
    }

    if (!enabled) {
      const nextState = await writeDesktopUnlockPassword(storageRoot, null)
      applyDesktopLockState(lock, nextState)
      lock.unlocked = true
      request.user.settings = applyDesktopAccountSettings(request.user.settings, nextState)
      send(response, desktopPublicRuntime(nextState, { enabled: true, unlocked: true }))
      return
    }

    const policy = desktopUnlockPolicy(password)
    if (!policy.ok) {
      fail(response, 400, policy.code, 'Use at least 4 characters for the opening password.', 'password')
      return
    }
    if (password !== confirmPassword) {
      fail(response, 400, 'DESKTOP_UNLOCK_MISMATCH', 'The two passwords do not match.', 'confirmPassword')
      return
    }
    const nextHash = await hashUnlockPassword(password)
    const nextState = await writeDesktopUnlockPassword(storageRoot, nextHash)
    applyDesktopLockState(lock, nextState)
    lock.unlocked = true
    request.user.settings = applyDesktopAccountSettings(request.user.settings, nextState)
    send(response, desktopPublicRuntime(nextState, { enabled: true, unlocked: true }))
  }))

  return {
    remoteClient,
    shareEnabledFor(request) {
      return desktopShareAllowed(app, request)
    },
    async runtimeFor(request) {
      if (!app.locals.desktopEnabled) return desktopPublicRuntime(undefined, { enabled: false, unlocked: true })
      const state = await readDesktopRuntimeState(storageRootFor(request))
      const lock = await ensureDesktopLock(app, storageRootFor(request))
      return desktopPublicRuntime(state, { enabled: true, unlocked: lock.unlocked })
    },
    async forwardShareCreate(request, body) {
      const state = request.desktopRuntimeState ?? await readDesktopRuntimeState(storageRootFor(request))
      if (!isDesktopShareEnabled(state)) return null
      const token = decryptDesktopSecret(state.remoteToken, secretFor(request))
      const mapping = (state.applicationMappings ?? []).find((entry) => entry.localId === request.params.id)
      if (!token || !state.remoteOrigin || !mapping?.remoteId) return null
      const share = await remoteClient.createShare(state.remoteOrigin, token, mapping.remoteId, body)
      if (!share) return null
      return {
        ...share,
        url: absoluteRemoteShareUrl(state.remoteOrigin, share),
      }
    },
    mappingFor(request, localId) {
      const state = request.desktopRuntimeState
      return (state?.applicationMappings ?? []).find((entry) => entry.localId === localId) ?? null
    },
  }
}

export function desktopShareAllowed(app, request) {
  if (!app?.locals?.desktopEnabled) return true
  const cached = request?.desktopRuntimeState
  if (cached) return isDesktopShareEnabled(cached)
  return false
}

export async function attachDesktopRuntime(request, storageRoot) {
  if (!request.app?.locals?.desktopEnabled) return null
  const state = await readDesktopRuntimeState(storageRoot)
  request.desktopRuntimeState = state
  if (request.user) {
    request.user = {
      ...request.user,
      settings: applyDesktopAccountSettings({ ...request.user.settings }, state),
    }
  }
  return state
}

export function installDesktopUnlockGate(app, options = {}) {
  const wrap = options.asyncHandler ?? ((handler) => handler)
  const fail = options.fail ?? defaultFail
  const storageRootFor = options.storageRootFor ?? (() => options.storageRoot)
  app.use('/api', wrap(async (request, response, next) => {
    if (!app.locals.desktopEnabled) {
      next()
      return
    }
    const lock = await ensureDesktopLock(app, storageRootFor(request))
    if (!lock.required || lock.unlocked) {
      next()
      return
    }
    fail(response, 401, 'DESKTOP_UNLOCK_REQUIRED', 'This desktop app is locked. Enter the opening password.')
  }))
}

export async function ensureDesktopLock(app, storageRoot) {
  if (!app.locals.desktopLock) app.locals.desktopLock = createDesktopLockState()
  const lock = app.locals.desktopLock
  if (lock.hydrated) return lock
  if (!lock.hydration) {
    lock.hydration = readDesktopRuntimeState(storageRoot)
      .then((state) => applyDesktopLockState(lock, state))
      .finally(() => {
        lock.hydration = null
      })
  }
  await lock.hydration
  return lock
}

function requireDesktop(app, request, response, fail) {
  if (app.locals.desktopEnabled) return true
  fail(response, 404, 'NOT_FOUND', `API route not found: ${request.method} ${request.originalUrl}`)
  return false
}

async function buildCompleteExport(request, { vault, getInterviewPrepWorkspaceRecord }) {
  const applications = (request.store.applications ?? []).filter((application) => (
    application.ownerId === request.user.id && !application.teamId
  ))
  const profileAssets = (request.store.profileAssets ?? []).filter((asset) => (
    asset.ownerId === request.user.id && !asset.teamId
  ))
  const storageNames = [
    ...applications.flatMap(collectUploadStorageNames),
    ...profileAssets.flatMap(collectProfileAssetStorageNames),
  ]
  const files = vault?.readBuffer
    ? await collectSnapshotFiles(storageNames, (storageName, options) => vault.readBuffer(storageName, options))
    : []
  let interviewPrep = null
  if (typeof getInterviewPrepWorkspaceRecord === 'function') {
    try {
      interviewPrep = await getInterviewPrepWorkspaceRecord({
        subjectUserId: request.user.id,
        teamId: null,
      })
    } catch {
      interviewPrep = null
    }
  }
  return createCompleteWorkspaceSnapshot({
    user: request.user,
    applications,
    profileAssets,
    interviewPrep,
    files,
  })
}

async function importCompleteSnapshot(request, snapshot, {
  vault,
  lockedWriteStore,
  normalizeApplication,
  createId,
  nowStamp,
  getInterviewPrepWorkspaceRecord,
  saveInterviewPrepWorkspaceRecord,
}) {
  const owner = request.user
  const store = request.store
  const now = nowStamp()
  let applicationsImported = 0
  let assetsImported = 0
  let filesImported = 0
  let settingsImported = false
  let interviewImported = false

  for (const entry of snapshot.files) {
    const storageName = String(entry?.storageName ?? '').trim()
    const bytes = decodeSnapshotFileBytes(entry)
    if (!storageName || !bytes || !vault?.writeBuffer) continue
    await vault.writeBuffer(storageName, bytes)
    filesImported += 1
  }

  for (const record of snapshot.applications) {
    const id = record.id || createId('app')
    const normalized = normalizeApplication({
      ...record,
      id,
      ownerId: owner.id,
      teamId: null,
      visibleToTeam: false,
      shares: [],
      status: record.status || 'Draft',
      progress: Number.isFinite(Number(record.progress)) ? Number(record.progress) : 0,
      priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : 50,
      updatedAt: now,
    }, owner.settings, store.settings, owner)
    const existingIndex = store.applications.findIndex((candidate) => candidate.id === id)
    if (existingIndex >= 0) store.applications[existingIndex] = normalized
    else store.applications.unshift(normalized)
    applicationsImported += 1
  }

  for (const record of snapshot.profileAssets) {
    const id = record.id || createId('asset')
    const asset = {
      ...record,
      id,
      ownerId: owner.id,
      teamId: null,
      shares: [],
      updatedAt: now,
    }
    const existingIndex = store.profileAssets.findIndex((candidate) => candidate.id === id)
    if (existingIndex >= 0) store.profileAssets[existingIndex] = asset
    else store.profileAssets.unshift(asset)
    assetsImported += 1
  }

  const storedUser = store.users.find((candidate) => candidate.id === owner.id)
  if (storedUser && snapshot.user?.settings) {
    storedUser.settings = restoreImportedUserSettings(storedUser.settings, snapshot.user.settings)
    request.user = {
      ...storedUser,
      settings: applyDesktopAccountSettings({ ...storedUser.settings }, request.desktopRuntimeState),
    }
    settingsImported = true
  }

  if (snapshot.interviewPrep && typeof saveInterviewPrepWorkspaceRecord === 'function') {
    const current = typeof getInterviewPrepWorkspaceRecord === 'function'
      ? await getInterviewPrepWorkspaceRecord({ subjectUserId: owner.id, teamId: null })
      : null
    await saveInterviewPrepWorkspaceRecord({
      subjectUserId: owner.id,
      teamId: null,
      workspace: {
        ...snapshot.interviewPrep,
        subjectUserId: owner.id,
        teamId: null,
      },
      expectedRevision: Number(current?.revision ?? 0),
      actorId: owner.id,
      requestId: createId('desktop-import'),
    })
    interviewImported = true
  }

  await lockedWriteStore(store)
  return {
    applicationsImported,
    assetsImported,
    filesImported,
    settingsImported,
    interviewImported,
  }
}

export function absoluteRemoteShareUrl(origin, share) {
  const pathOrUrl = String(share?.url || (share?.token ? `/share/${share.token}` : '')).trim()
  if (!pathOrUrl) return origin
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = String(origin ?? '').replace(/\/+$/u, '')
  return `${base}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`
}

function defaultOk(response, data, status = 200) {
  response.status(status).json({ ok: true, data })
}

function defaultFail(response, status, code, message, field) {
  response.status(status).json({ ok: false, error: { code, message, field } })
}
