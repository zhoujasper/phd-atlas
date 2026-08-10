import { describe, expect, it } from 'vitest'
import {
  tenantKeyForApplication,
  tenantKeyForEntity,
  tenantKeyForProfileAsset,
  tenantKeyForSettings,
  tenantKeyForTeam,
  tenantKeyForUser,
} from './storage.js'

describe('tenant revision keys', () => {
  it('maps users, teams, settings, applications, and profile assets to durable tenants', () => {
    expect(tenantKeyForUser({ id: 'u-1' })).toBe('user:u-1')
    expect(tenantKeyForTeam({ id: 'team-1' })).toBe('team:team-1')
    expect(tenantKeyForSettings()).toBe('system')
    expect(tenantKeyForApplication({
      id: 'app-1',
      ownerId: 'u-1',
      teamId: null,
    })).toBe('user:u-1')
    expect(tenantKeyForApplication({
      id: 'app-2',
      ownerId: 'u-2',
      teamId: 'team-2',
    })).toBe('team:team-2')
    expect(tenantKeyForProfileAsset({
      id: 'asset-1',
      ownerId: 'u-3',
      teamId: null,
    })).toBe('user:u-3')
    expect(tenantKeyForProfileAsset({
      id: 'asset-2',
      ownerId: 'u-4',
      teamId: 'team-4',
    })).toBe('team:team-4')
  })

  it('infers entity ownership through the generic pure helper', () => {
    expect(tenantKeyForEntity({ id: 'u-1', email: 'a@example.test' }, 'user')).toBe('user:u-1')
    expect(tenantKeyForEntity({ id: 'app-1', ownerId: 'u-1' }, 'application')).toBe('user:u-1')
    expect(tenantKeyForEntity({ id: 'app-2', ownerId: 'u-2', teamId: 'team-2' }, 'application'))
      .toBe('team:team-2')
    expect(tenantKeyForEntity(null)).toBeNull()
    expect(tenantKeyForEntity({ id: 'u-1', email: 'a@example.test' })).toBe('user:u-1')
  })
})
