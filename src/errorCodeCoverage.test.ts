import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeErrorMessage } from './errorMessages'
import { ApiError } from './api/phdApi'

/**
 * An error code the browser has no message for is shown to the person as
 * "请求失败（错误码：SOME_CODE），请稍后重试" — a string that tells them nothing
 * about what happened or what to do. It is not a crash, so nothing catches it;
 * it just makes the product feel broken at the exact moment something has gone
 * wrong.
 *
 * Every code the server can return therefore needs a message, and this walks
 * the server to check rather than trusting that whoever added a `fail()` also
 * remembered the twelve translations.
 */

/** Codes that by construction never reach a person, with the reason. */
const NEVER_SURFACED = new Map([
  // A developer error: the route did not declare a hydration policy. 500.
  ['HYDRATION_POLICY_UNDECLARED_MUTATION', 'server misconfiguration, not user-facing'],
  // The browser retries these itself rather than reporting them.
  ['PROFILE_RECOMMENDER_ROUTE_REQUIRED', 'client re-routes to the atomic endpoint'],
  ['RECOMMENDER_RESOLUTION_REQUIRED', 'client rebases and replays; see offline.ts'],
])

/** Codes resolved by a branch rather than the code→key table. */
const BRANCH_RESOLVED = new Set(['PRO_REQUIRED', 'STORAGE_QUOTA_EXCEEDED', 'VALIDATION_ERROR'])

function serverFailureCodes() {
  const source = readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8')
  const codes = new Set<string>()
  for (const match of source.matchAll(/fail\(\s*response,\s*\d+,\s*'([A-Z][A-Z0-9_]+)'/gu)) {
    codes.add(match[1])
  }
  return [...codes].sort()
}

describe('every server error code has something to say to the person', () => {
  it('resolves a localized message for each code the server can return', () => {
    const unresolved = serverFailureCodes().filter((code) => {
      if (NEVER_SURFACED.has(code) || BRANCH_RESOLVED.has(code)) return false
      const message = normalizeErrorMessage(new ApiError('Server said so.', code, 400), 'zh')
      // The generic fallback embeds the raw code; that is the failure mode.
      return message.includes(code)
    })

    // If this fails: add the code to `ERROR_KEY_BY_CODE` with an `apiErrors.*`
    // key and translate it, or record here why a person can never see it.
    expect(unresolved).toEqual([])
  })

  it('says what happened rather than printing a code', () => {
    for (const code of ['DISCOVER_RESEARCH_SOURCE_REQUIRED', 'MAIL_CLASSIFICATION_PROVIDER_FAILED']) {
      const message = normalizeErrorMessage(new ApiError('Server said so.', code, 400), 'zh')
      expect(message).not.toContain(code)
      expect(message.length).toBeGreaterThan(8)
    }
  })
})
