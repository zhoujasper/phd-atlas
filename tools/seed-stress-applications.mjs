import { ApplicationSchema } from '../server/validation.js'
import { createId, readStore, writeStore, nowStamp } from '../server/storage.js'
import { STRESS_APPLICATION_ID_PREFIX, createStressApplications } from './stress-fixtures.mjs'

function parseArgs(argv) {
  const options = {
    count: 120,
    owner: 'jasper@example.com',
    keepExisting: false,
  }
  for (const arg of argv) {
    if (arg.startsWith('--count=')) {
      options.count = Math.max(1, Math.min(500, Number(arg.slice('--count='.length)) || options.count))
    } else if (arg.startsWith('--owner=')) {
      options.owner = arg.slice('--owner='.length).trim().toLowerCase() || options.owner
    } else if (arg === '--keep-existing') {
      options.keepExisting = true
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const store = await readStore()
const owner = store.users.find((user) => user.email.toLowerCase() === options.owner)

if (!owner) {
  throw new Error(`Owner account not found: ${options.owner}`)
}

const beforeCount = store.applications.filter((application) => application.ownerId === owner.id).length
if (!options.keepExisting) {
  store.applications = store.applications.filter((application) => (
    application.ownerId !== owner.id || !String(application.id).startsWith(STRESS_APPLICATION_ID_PREFIX)
  ))
}

const applications = createStressApplications({ ownerId: owner.id, count: options.count })
for (const application of applications) {
  ApplicationSchema.parse(application)
}

store.applications.push(...applications)
owner.settings = {
  ...(owner.settings ?? {}),
  planQuotaVersion: 2,
  membershipPlan: 'pro',
  applicationQuota: Math.max(Number(owner.settings?.applicationQuota ?? 0), options.count + beforeCount, 300),
  applicationCreateQuota: Math.max(Number(owner.settings?.applicationCreateQuota ?? 0), options.count + beforeCount, 300),
  storageQuotaMb: Math.max(Number(owner.settings?.storageQuotaMb ?? 0), 100),
  shareQuota: Math.max(Number(owner.settings?.shareQuota ?? 0), 1000),
  shareCreateQuota: Math.max(Number(owner.settings?.shareCreateQuota ?? 0), 5000),
  maxBackupsPerApp: Math.max(Number(owner.settings?.maxBackupsPerApp ?? 0), 20),
}

store.systemEvents.unshift({
  id: createId('event'),
  time: nowStamp(),
  scope: 'Stress data',
  actorId: owner.id,
  message: `Seeded ${applications.length} stress applications for ${owner.email}`,
  metadata: {
    count: applications.length,
    owner: owner.email,
    prefix: STRESS_APPLICATION_ID_PREFIX,
    resetExisting: !options.keepExisting,
  },
})
store.systemEvents = store.systemEvents.slice(0, 500)

await writeStore(store)

const afterCount = store.applications.filter((application) => application.ownerId === owner.id).length
console.log(JSON.stringify({
  ok: true,
  owner: owner.email,
  inserted: applications.length,
  beforeCount,
  afterCount,
  resetExisting: !options.keepExisting,
}, null, 2))
