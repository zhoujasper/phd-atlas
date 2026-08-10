# Phase 12 Source Adapter Framework

Phase 12 is a personal, source-available, non-commercial research-data framework. It
normalizes records from independent upstream sources and keeps provenance on
every value: `sourceId`, `sourceUrl`, `fetchedAt`, and `confidence`.

## Config Contract

Every adapter is validated by `SourceConfigSchema`:

```js
{
  id: 'source-id',
  name: 'Human readable name',
  kind: 'api' | 'html',
  baseUrl: 'https://...',
  enabled: true,
  rateLimitPerMin: 30,
  concurrency: 1,
  cacheTtlMs: 3600000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research)',
  robotsPolicy: 'respect' | 'override',
  timeoutMs: 20000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 10000,
    retryableStatuses: [429, 502, 503, 504],
    retryNetworkErrors: true
  }
}
```

The HTTP layer owns cache-first reads, per-source rate limiting, global
concurrency, timeout, exponential backoff, and 429/503/502/504 retry. HTML
adapters parse through `rehype-parse` and throw `SourceStructureChangedError`
when their required structure disappears instead of returning a silent empty
result.

## Registered Adapters

| id | kind | source |
| --- | --- | --- |
| `nsf-awards` | api | NSF Award Search API, no key |
| `nih-reporter` | api | NIH RePORTER v2 projects search, no key |
| `openalex-works` | api | OpenAlex Works API |
| `gradcafe-results` | html | GradCafe public survey pages, reference use only |
| `reddit-submissions` | api | Official Reddit OAuth API; official Atom search fallback when OAuth is not configured |

Fixtures under `server/sources/fixtures/` are labelled `synthetic-documented`.
They validate parsing and degradation deterministically in the sandbox but are
not claimed to be live captures.

## Provenance

Each normalized record has this shape:

```js
{
  kind: 'source:record-kind',
  value: { ... },
  sourceId: 'source-id',
  sourceUrl: 'https://original-or-api-url',
  fetchedAt: '2026-08-03T12:00:00.000Z',
  confidence: 1
}
```

No adapter record may enter the framework without these fields. Cross-source
comparison records disagreements rather than silently choosing a value.

## Verification

Run the deterministic fixture and structure validation without network:

```sh
node tools/verify-phase12-sources.mjs
```

Run live connectivity checks only in an environment with approved outbound
network access:

```sh
node tools/verify-phase12-sources.mjs --live
```

The sandbox itself has no outbound network, so the default report marks live
verification as `notRun: true` with reason `沙箱无外网`.
