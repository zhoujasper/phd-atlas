import { SCHOOL_ADAPTERS_BATCH_01 } from './batch-01.js'
import { SCHOOL_ADAPTERS_BATCH_02 } from './batch-02.js'
import { SCHOOL_ADAPTERS_BATCH_03 } from './batch-03.js'
import { SCHOOL_ADAPTERS_BATCH_04 } from './batch-04.js'
import { SCHOOL_ADAPTERS_BATCH_05 } from './batch-05.js'
import { SCHOOL_ADAPTERS_BATCH_06 } from './batch-06.js'
import { SCHOOL_ADAPTERS_BATCH_07 } from './batch-07.js'
import { SCHOOL_ADAPTERS_BATCH_08 } from './batch-08.js'
import { SCHOOL_ADAPTERS_BATCH_09 } from './batch-09.js'
import { SCHOOL_ADAPTERS_BATCH_10 } from './batch-10.js'
import { mergeSchoolAdapterBatches } from './adapter-validator.js'

export const DISCOVER_SCHOOL_ADAPTER_BATCHES = Object.freeze([
  SCHOOL_ADAPTERS_BATCH_01,
  SCHOOL_ADAPTERS_BATCH_02,
  SCHOOL_ADAPTERS_BATCH_03,
  SCHOOL_ADAPTERS_BATCH_04,
  SCHOOL_ADAPTERS_BATCH_05,
  SCHOOL_ADAPTERS_BATCH_06,
  SCHOOL_ADAPTERS_BATCH_07,
  SCHOOL_ADAPTERS_BATCH_08,
  SCHOOL_ADAPTERS_BATCH_09,
  SCHOOL_ADAPTERS_BATCH_10,
])

function freezeAdapter(adapter) {
  return Object.freeze({
    ...adapter,
    allowedHosts: Object.freeze([...(adapter.allowedHosts || [])]),
    seeds: Object.freeze((adapter.seeds || []).map((seed) => Object.freeze({ ...seed }))),
    pathHints: Object.freeze(Object.fromEntries(
      Object.entries(adapter.pathHints || {}).map(([key, values]) => [key, Object.freeze([...(values || [])])]),
    )),
  })
}

/** One merged adapter per university; overlapping independently checked batches
 * contribute additional official hosts/seeds instead of creating duplicate
 * crawler jobs. */
export const DISCOVER_SCHOOL_ADAPTERS = Object.freeze(
  mergeSchoolAdapterBatches(DISCOVER_SCHOOL_ADAPTER_BATCHES).map(freezeAdapter),
)

const ADAPTER_BY_SCHOOL = new Map(DISCOVER_SCHOOL_ADAPTERS.map((adapter) => [adapter.school, adapter]))

export function discoverSchoolAdapterFor(school) {
  return ADAPTER_BY_SCHOOL.get(String(school || '').trim()) || null
}
