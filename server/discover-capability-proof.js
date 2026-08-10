const CAPABILITY_MARKER = 'discover_research_v1'

function normalizedBaseUrl(value) {
  try {
    return new URL(String(value || '')).toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/**
 * Validates a short-lived, credential-free observation produced by a separate
 * live Responses capability call. This is benchmark orchestration only: saved
 * keys and production research routes still run the provider-owned probe.
 */
export function validateDiscoverCapabilityProof(proof, {
  provider,
  baseUrl,
  model,
  now = Date.now(),
  maxAgeMs = 6 * 60 * 60 * 1_000,
} = {}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return null
  const observedAtMs = Date.parse(String(proof.observedAt || ''))
  const ageMs = Number(now) - observedAtMs
  const matchesTarget = proof.schemaVersion === 1
    && proof.provider === provider
    && normalizedBaseUrl(proof.baseUrl) === normalizedBaseUrl(baseUrl)
    && proof.model === model
  const completed = proof.httpStatus === 200
    && proof.responseStatus === 'completed'
    && proof.webSearchCallStatus === 'completed'
    && proof.outputMarker === CAPABILITY_MARKER
  if (
    !matchesTarget
    || !completed
    || !Number.isFinite(observedAtMs)
    || !Number.isFinite(ageMs)
    || ageMs < 0
    || ageMs > maxAgeMs
  ) return null
  return {
    model,
    capabilities: {
      responses: true,
      webSearch: true,
      structuredOutput: true,
      reasoning: true,
    },
    cached: true,
    proofObservedAt: new Date(observedAtMs).toISOString(),
  }
}
