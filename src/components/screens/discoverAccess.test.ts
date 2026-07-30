import { describe, expect, it } from 'vitest'
import type { AuthSession, TeamRole } from '../../api/phdApi'
import { canAccessDiscover, discoverStudentMembers, hasPersonalDiscoverAccess, hasTeamDiscoverAccess } from './discoverAccess'

function session(input: {
  membershipPlan?: 'free' | 'pro' | 'team'
  personalMembershipPlan?: 'free' | 'pro'
  usagePlan?: 'free' | 'pro' | 'team' | 'admin'
}) {
  return {
    user: {
      settings: {
        membershipPlan: input.membershipPlan ?? 'free',
        personalMembershipPlan: input.personalMembershipPlan,
      },
    },
    usage: input.usagePlan ? { plan: input.usagePlan } : undefined,
  } as AuthSession
}

describe('Discover access policy', () => {
  it('allows a personal Pro account', () => {
    expect(hasPersonalDiscoverAccess(session({ membershipPlan: 'pro', usagePlan: 'pro' }))).toBe(true)
    expect(canAccessDiscover('personal', session({ personalMembershipPlan: 'pro', membershipPlan: 'team' }), null)).toBe(true)
  })

  it('does not treat a Team plan as personal Pro access', () => {
    const teamStudent = session({ membershipPlan: 'team', usagePlan: 'team' })
    expect(hasPersonalDiscoverAccess(teamStudent)).toBe(false)
    expect(canAccessDiscover('personal', teamStudent, 'member')).toBe(false)
  })

  it.each<[TeamRole, boolean]>([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ])('uses the default Team Discover policy for %s', (role, expected) => {
    expect(hasTeamDiscoverAccess(role)).toBe(expected)
    expect(canAccessDiscover('team', session({ membershipPlan: 'team' }), role)).toBe(expected)
  })

  it('honors per-member Team Discover permissions', () => {
    expect(hasTeamDiscoverAccess('member', {
      studentPermissions: { useDiscover: true },
    })).toBe(true)
    expect(hasTeamDiscoverAccess('admin', {
      teacherPermissions: { useDiscover: false },
    })).toBe(false)
  })

  it('inherits Team Discover defaults until a personal override wins', () => {
    const defaults = {
      student: {
        editApplications: true,
        createApplications: true,
        useDiscover: true,
        createShareLinks: true,
        requestTeamTransfers: true,
        activeApplicationLimit: null,
        lifetimeApplicationLimit: null,
        activeShareLimit: null,
        lifetimeShareLimit: null,
      },
      teacher: {
        inviteStudents: true,
        manageStudentPermissions: true,
        useDiscover: false,
        createStudentApplications: true,
        editStudentApplications: true,
        manageStudentShares: true,
      },
    }
    expect(hasTeamDiscoverAccess('member', undefined, defaults)).toBe(true)
    expect(hasTeamDiscoverAccess('member', {
      studentPermissions: { useDiscover: false },
    }, defaults)).toBe(false)
    expect(hasTeamDiscoverAccess('admin', undefined, defaults)).toBe(false)
  })

  it('limits a teacher target picker to assigned students while an owner sees the organization', () => {
    const members = [
      { id: 'student-a', userId: 'user-a', status: 'active', role: 'member', invitedBy: 'teacher-a' },
      { id: 'student-b', userId: 'user-b', status: 'active', role: 'member', invitedBy: 'teacher-b' },
      {
        id: 'student-joint',
        userId: 'user-joint',
        status: 'active',
        role: 'member',
        invitedBy: 'teacher-b',
        relationships: { teacherIds: ['teacher-a', 'teacher-b'] },
      },
      { id: 'pending', userId: null, status: 'pending', role: 'member', invitedBy: 'teacher-a' },
      { id: 'teacher-b', userId: 'teacher-b', status: 'active', role: 'admin', invitedBy: 'owner' },
    ] as const

    expect(discoverStudentMembers(members, 'admin', 'teacher-a').map((member) => member.id)).toEqual(['student-a', 'student-joint'])
    expect(discoverStudentMembers(members, 'owner', 'owner').map((member) => member.id)).toEqual(['student-a', 'student-b', 'student-joint'])
    expect(discoverStudentMembers(members, 'member', 'user-a').map((member) => member.id)).toEqual(['student-a'])
  })
})
