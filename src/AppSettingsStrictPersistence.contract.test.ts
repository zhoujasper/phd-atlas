/// <reference types="node" />

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Markers below are written with \n. Git checks this file out with CRLF on
// Windows, so compare against a normalized copy: the contract is about the
// order of statements, not about which bytes end a line.
const appSource = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8').replace(/\r\n/gu, '\n')

function sourceBetween(startMarker: string, endMarker: string) {
  const start = appSource.indexOf(startMarker)
  const end = appSource.indexOf(endMarker, start + startMarker.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return appSource.slice(start, end)
}

describe('App strict settings persistence contract', () => {
  it('forwards the strict error option used by the resident SMTP and IMAP editors', () => {
    const strictSettingsBindings = appSource.match(
      /onUpdateSettings=\{\(patch,\s*message,\s*options\)\s*=>\s*updateUserSettings\(patch,\s*message,\s*options\)\}/g,
    ) ?? []

    // Profile and Settings are both strict resident editors. Keeping the count
    // at two prevents the Settings binding from silently dropping `options`
    // while the already-correct Profile binding masks that regression.
    expect(strictSettingsBindings).toHaveLength(2)
  })
})

describe('App offline persistence acknowledgement contract', () => {
  it('settles an overlapping offline edit rather than parking it for manual recovery', () => {
    // Reconnecting has to be the whole recovery flow. Dropping `autoResolve`
    // restores the state this replaced: an entry that re-blocks on every retry
    // behind a button that cannot clear it.
    const syncLoop = sourceBetween(
      'for (const operation of pendingQueue) {',
      '      if (!isCurrentRun()) return synced\n      removeOfflineQueueItems(',
    )
    expect(syncLoop).toContain('mergeOfflineApplicationUpdate(operation, current, { autoResolve: true })')
    expect(syncLoop).not.toContain('markOfflineQueueItemBlocked')
  })

  it('never counts a queued change as synced when it was only discarded or deferred', () => {
    const syncLoop = sourceBetween(
      'for (const operation of pendingQueue) {',
      '      if (!isCurrentRun()) return synced\n      removeOfflineQueueItems(',
    )
    const noTargetDiscard = syncLoop.indexOf('if (!current || (current.ownerId && current.ownerId !== activeSession.user.id))')
    const successCount = syncLoop.indexOf('syncedIds.push(operation.id)')

    // A record that can no longer accept the write leaves the queue, but it is
    // never reported as a save.
    expect(noTargetDiscard).toBeGreaterThanOrEqual(0)
    expect(successCount).toBeGreaterThan(noTargetDiscard)
    expect(syncLoop.slice(noTargetDiscard, successCount)).toContain('discard()')
    expect(syncLoop.slice(noTargetDiscard, successCount)).toContain('continue')

    // A rejected replay must leave the entry queued for the next reconnect
    // instead of abandoning the rest of the run or clearing the operation.
    const replayCatch = syncLoop.indexOf('} catch (error) {')
    expect(replayCatch).toBeGreaterThan(successCount)
    const failurePath = syncLoop.slice(replayCatch)
    expect(failurePath).toContain('deferred += 1')
    expect(failurePath).not.toContain('syncedIds.push')
  })

  it('keeps the draft resident until both the queue and snapshot acknowledge storage', () => {
    const queueForSync = sourceBetween(
      'const queueForSync = (queueOptions:',
      '    const commitOnce = async (',
    )
    const acknowledgementBoundary = queueForSync.indexOf('if (!saved) throw new Error(')
    const residentReplacement = queueForSync.indexOf('replaceApplication(applicationToSave')

    expect(queueForSync).toContain('nextQueue = enqueueApplicationUpdate(')
    expect(queueForSync).toContain("if (!saved) throw new Error(")
    expect(queueForSync).toContain("return { status: 'error', message: errorMessage }")
    expect(acknowledgementBoundary).toBeGreaterThanOrEqual(0)
    expect(residentReplacement).toBeGreaterThan(acknowledgementBoundary)
  })

  it('requires the user-editable application projection before reporting a server save', () => {
    const onlineSave = sourceBetween(
      'const commitOnce = async (',
      '    try {\n      return await commitOnce(applicationToSave, baseApplication)',
    )
    const acknowledgement = onlineSave.indexOf(
      'applicationPersistenceAcknowledged(target, mutation.application, base)',
    )
    const verifiedCanonical = onlineSave.indexOf('const saved = mutation.application')
    const residentReplacement = onlineSave.indexOf('replaceApplication(saved, draftMutationVersion)')

    expect(acknowledgement).toBeGreaterThanOrEqual(0)
    expect(onlineSave).toContain("status: 'error'")
    expect(verifiedCanonical).toBeGreaterThan(acknowledgement)
    expect(residentReplacement).toBeGreaterThan(acknowledgement)
  })

  it('rebases and replays a stale-baseline rejection a bounded number of times before reporting it', () => {
    const conflictPath = sourceBetween(
      'let rebaseError: unknown = retryableError',
      '      if (\n        (isNetworkLikeError(rebaseError)',
    )
    const rebase = conflictPath.indexOf('await rebaseApplicationForRetry(')
    const replay = conflictPath.indexOf('return await commitOnce(rebased.application, rebased.server)')

    expect(rebase).toBeGreaterThanOrEqual(0)
    expect(replay).toBeGreaterThan(rebase)
    // One replay was not enough: background writers (mail sync filing
    // correspondence, logo resolution) can move the record again inside the
    // rebase round-trip, and that second collision surfaced a conflict toast
    // for a save nobody was competing over. The loop must stay bounded, and a
    // rejection that is not a stale baseline must still report immediately.
    expect(conflictPath).toContain('attempt < APPLICATION_SAVE_REBASE_ATTEMPTS')
    expect(conflictPath).toContain('isRebaseableApplicationConflict(rebaseError)')
    expect(conflictPath).toContain('if (!isRebaseableApplicationConflict(retryError)) {')
    expect(conflictPath).toContain("return { status: 'error', message: retryMessage }")
    expect(appSource).toMatch(/const APPLICATION_SAVE_REBASE_ATTEMPTS = \d+/u)
  })
})
