import {
  applicationSyncKey,
  evaluateDesktopWebApplicationQuota,
  findMissingLocalApplications,
  normalizeDesktopOrigin,
} from './desktopRuntime.js'

const CONNECT_TIMEOUT_MS = 20_000

export function createDesktopRemoteClient({ fetchImpl = fetch, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return {
    async login(origin, email, password) {
      const payload = await desktopRemoteJson(fetchImpl, origin, '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, scope: 'app' }),
        timeoutMs,
      })
      const token = String(payload?.data?.token ?? '').trim()
      if (!token) {
        throw desktopRemoteError('DESKTOP_CONNECT_FAILED', 'The web account did not return a session.')
      }
      return {
        token,
        user: payload.data.user ?? null,
        usage: payload.data.usage ?? null,
      }
    },

    async readSession(origin, token) {
      const payload = await desktopRemoteJson(fetchImpl, origin, '/api/auth/me', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        timeoutMs,
      })
      return {
        user: payload?.data?.user ?? payload?.data ?? null,
        usage: payload?.data?.usage ?? null,
        applications: Array.isArray(payload?.data?.applications) ? payload.data.applications : null,
      }
    },

    async listApplications(origin, token) {
      const payload = await desktopRemoteJson(fetchImpl, origin, '/api/applications', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        timeoutMs,
      })
      if (Array.isArray(payload?.data)) return payload.data
      if (Array.isArray(payload?.data?.applications)) return payload.data.applications
      return []
    },

    async createApplication(origin, token, application) {
      const payload = await desktopRemoteJson(fetchImpl, origin, '/api/applications', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(createApplicationBody(application)),
        timeoutMs,
      })
      return payload?.data ?? null
    },

    async replaceApplication(origin, token, remoteId, application) {
      const payload = await desktopRemoteJson(fetchImpl, origin, `/api/applications/${encodeURIComponent(remoteId)}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-phd-application-projection-version': '2',
        },
        body: JSON.stringify(replaceApplicationBody(application, remoteId)),
        timeoutMs,
      })
      return payload?.data ?? null
    },

    async createShare(origin, token, remoteApplicationId, body) {
      const payload = await desktopRemoteJson(
        fetchImpl,
        origin,
        `/api/applications/${encodeURIComponent(remoteApplicationId)}/share`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body ?? {}),
          timeoutMs,
        },
      )
      return payload?.data ?? null
    },
  }
}

export function planDesktopRemotePush(localApplications, remoteApplications, remoteUsage) {
  const local = Array.isArray(localApplications) ? localApplications.filter((application) => !application?.teamId) : []
  const remote = Array.isArray(remoteApplications) ? remoteApplications : []
  const missing = findMissingLocalApplications(local, remote)
  const quota = evaluateDesktopWebApplicationQuota({
    localCount: local.length,
    remoteCount: remote.length,
    remoteQuota: remoteUsage?.applicationQuota,
    missingCount: missing.length,
  })
  return { local, remote, missing, quota }
}

export async function pushMissingDesktopApplications({
  client,
  origin,
  token,
  missing,
} = {}) {
  const mappings = []
  for (const application of missing) {
    const created = await client.createApplication(origin, token, application)
    const remoteId = String(created?.id ?? created?.application?.id ?? '').trim()
    if (!remoteId) {
      throw desktopRemoteError('DESKTOP_CONNECT_FAILED', 'The web account accepted login but did not create a pushed application.')
    }
    try {
      await client.replaceApplication(origin, token, remoteId, {
        ...application,
        id: remoteId,
      })
    } catch {
      // Create succeeded. A later replace can fail on optional nested fields;
      // the identity row is still present on the web account.
    }
    mappings.push({
      localId: String(application.id),
      remoteId,
      key: applicationSyncKey(application),
    })
  }
  return mappings
}

function createApplicationBody(application) {
  return {
    professor: String(application?.professor?.english || application?.professor?.name || 'Advisor').trim() || 'Advisor',
    professorChinese: String(application?.professor?.chinese ?? ''),
    professorEmail: String(application?.professor?.email || 'advisor@example.com'),
    professorHomepage: String(application?.professor?.homepage ?? ''),
    university: String(application?.school?.name || 'University').trim() || 'University',
    country: String(application?.school?.country ?? ''),
    website: String(application?.school?.website ?? ''),
    program: String(application?.program || 'PhD').trim() || 'PhD',
    deadline: String(application?.deadline ?? ''),
    notes: String(application?.notes ?? ''),
  }
}

function replaceApplicationBody(application, remoteId) {
  return {
    ...application,
    id: remoteId,
    teamId: null,
    visibleToTeam: false,
    shares: [],
  }
}

async function desktopRemoteJson(fetchImpl, origin, pathname, { timeoutMs, ...init } = {}) {
  const base = normalizeDesktopOrigin(origin)
  if (!base) {
    throw desktopRemoteError('DESKTOP_CONNECT_FAILED', 'Enter a valid web system URL.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || CONNECT_TIMEOUT_MS))
  try {
    const response = await fetchImpl(`${base}${pathname}`, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.ok === false) {
      const error = payload?.error ?? {}
      throw desktopRemoteError(
        error.code || 'DESKTOP_CONNECT_FAILED',
        error.message || `The web system returned HTTP ${response.status}.`,
        response.status,
      )
    }
    return payload
  } catch (error) {
    if (error?.code) throw error
    if (error?.name === 'AbortError') {
      throw desktopRemoteError('DESKTOP_CONNECT_FAILED', 'The web system did not respond in time.')
    }
    throw desktopRemoteError('DESKTOP_CONNECT_FAILED', error?.message || 'Could not reach the web system.')
  } finally {
    clearTimeout(timer)
  }
}

export function desktopRemoteError(code, message, status = 409) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}
