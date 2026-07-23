import { describe, expect, it } from 'vitest'
import {
  isValidPublicSetupPendingWorkspace,
  markPublicSetupComplete,
  shouldRefuseEmptyWorkspaceSeed,
} from './storage.js'

describe('workspace storage recovery policy', () => {
  it('allows a genuinely new workspace to receive the initial seed', () => {
    expect(shouldRefuseEmptyWorkspaceSeed({ nodeEnv: 'development' })).toBe(false)
  })

  it('refuses to overwrite an empty existing database or orphan recovery artifacts', () => {
    expect(shouldRefuseEmptyWorkspaceSeed({
      hadPlainDatabase: true,
      nodeEnv: 'development',
    })).toBe(true)
    expect(shouldRefuseEmptyWorkspaceSeed({
      hasRecoveryArtifacts: true,
      nodeEnv: 'development',
    })).toBe(true)
  })

  it('keeps isolated route tests deterministic', () => {
    expect(shouldRefuseEmptyWorkspaceSeed({
      hadSealedDatabase: true,
      hasRecoveryArtifacts: true,
      nodeEnv: 'test',
    })).toBe(false)
  })

  it('allows a marked public setup workspace to restart until setup completes', () => {
    expect(shouldRefuseEmptyWorkspaceSeed({ nodeEnv: 'development' })).toBe(false)

    const pendingMeta = { version: 1, publicSetupState: 'pending-v1' }
    const validPublicSetupPending = isValidPublicSetupPendingWorkspace({
      publicEdition: true,
      meta: pendingMeta,
      userCount: 0,
      applicationCount: 0,
      profileAssetCount: 0,
      teamCount: 0,
      hasSystemSettings: true,
    })
    expect(validPublicSetupPending).toBe(true)
    expect(shouldRefuseEmptyWorkspaceSeed({
      hadPlainDatabase: true,
      validPublicSetupPending,
      nodeEnv: 'development',
    })).toBe(false)

    const completedStore = markPublicSetupComplete({ meta: pendingMeta })
    expect(completedStore.meta.publicSetupState).toBe('complete-v1')
    expect(isValidPublicSetupPendingWorkspace({
      publicEdition: true,
      meta: completedStore.meta,
      userCount: 1,
      hasSystemSettings: true,
    })).toBe(false)
  })

  it('does not let a marker bypass recovery protection when business data or artifacts exist', () => {
    const base = {
      publicEdition: true,
      meta: { publicSetupState: 'pending-v1' },
      userCount: 0,
      applicationCount: 0,
      profileAssetCount: 0,
      teamCount: 0,
      hasSystemSettings: true,
    }
    expect(isValidPublicSetupPendingWorkspace({ ...base, applicationCount: 1 })).toBe(false)
    expect(isValidPublicSetupPendingWorkspace({ ...base, hasRecoveryArtifacts: true })).toBe(false)
    expect(isValidPublicSetupPendingWorkspace({ ...base, hadSealedDatabase: true })).toBe(false)
    expect(shouldRefuseEmptyWorkspaceSeed({
      hadPlainDatabase: true,
      validPublicSetupPending: false,
      nodeEnv: 'development',
    })).toBe(true)
  })
})
