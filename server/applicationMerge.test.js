import { describe, expect, it } from 'vitest'
import {
  auditClone,
  buildApplicationAutoMerge,
  compactChangeList,
  isMajorApplicationChange,
  nextApplicationVersionStamp,
  resolveApplicationAutoMerge,
  resolveApplicationConcurrentWrite,
  setValueAtPath,
  summarizeApplicationChanges,
  valueAtPath,
} from './applicationMerge.js'

describe('application merge model', () => {
  it('tracks meaningful application changes while ignoring audit timestamps', () => {
    const before = {
      school: { name: 'Original University' },
      deadline: '2026-12-01',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    const after = {
      school: { name: 'Updated University' },
      deadline: '2026-12-15',
      createdAt: '2026-01-01',
      updatedAt: '2026-07-22',
    }

    expect(summarizeApplicationChanges(before, after)).toEqual(['school.name', 'deadline'])
    expect(isMajorApplicationChange(['reviewComments.0.body'])).toBe(false)
    expect(isMajorApplicationChange(['school.name'])).toBe(true)
    expect(compactChangeList(['school.name', 'school.country', 'tasks.0.title'])).toEqual(['school', 'tasks'])
  })

  it('classifies clean, already-applied, and conflicting merge fields exactly', () => {
    const base = {
      school: { name: 'Original University' },
      deadline: '2026-12-01',
      program: '',
    }
    const submitted = {
      school: { name: 'Submitted University' },
      deadline: '2026-12-15',
      program: 'Computer Science PhD',
    }
    const current = {
      school: { name: 'Current University' },
      deadline: '2026-12-15',
      program: '',
    }

    expect(buildApplicationAutoMerge(base, submitted, current)).toMatchObject({
      cleanFields: ['program'],
      sameFields: ['deadline'],
      conflicts: [expect.objectContaining({ field: 'school.name', status: 'conflict' })],
    })
  })

  it('reads and writes nested merge values without retaining mutable references', () => {
    const target = {}
    const incoming = { name: 'Updated University' }

    setValueAtPath(target, 'school.details', incoming)
    incoming.name = 'Mutated later'

    expect(valueAtPath(target, 'school.details')).toEqual({ name: 'Updated University' })
    expect(auditClone(undefined)).toBeNull()
  })

  it('automatically resolves same-field conflicts with teacher priority', () => {
    const base = {
      school: { name: 'Original University' },
      deadline: '2026-12-01',
      program: '',
    }
    const teacherSubmission = {
      school: { name: 'Teacher University' },
      deadline: '2026-12-20',
      program: 'Computer Science PhD',
    }
    const currentStudentCopy = {
      school: { name: 'Student University' },
      deadline: '2026-12-20',
      program: '',
    }

    const teacherWins = resolveApplicationAutoMerge(base, teacherSubmission, currentStudentCopy, {
      preferSubmittedConflicts: true,
    })
    expect(teacherWins.application).toEqual({
      school: { name: 'Teacher University' },
      deadline: '2026-12-20',
      program: 'Computer Science PhD',
    })
    expect(teacherWins.teacherPriorityFields).toEqual(['school.name'])
    expect(teacherWins.appliedFields).toEqual(['program', 'school.name'])

    const studentSubmission = {
      ...teacherSubmission,
      school: { name: 'Student University' },
    }
    const currentTeacherCopy = {
      ...currentStudentCopy,
      school: { name: 'Teacher University' },
    }
    const teacherRemains = resolveApplicationAutoMerge(base, studentSubmission, currentTeacherCopy)
    expect(teacherRemains.application.school.name).toBe('Teacher University')
    expect(teacherRemains.retainedFields).toEqual(['school.name'])
  })

  it('lets the latest editor win when the edit starts from the newest saved version', () => {
    const latestSavedTeacherVersion = {
      school: { name: 'Teacher University' },
      deadline: '2026-12-20',
      program: 'Computer Science PhD',
    }
    const laterStudentSubmission = {
      ...latestSavedTeacherVersion,
      school: { name: 'Student Latest University' },
    }

    const latestWins = resolveApplicationAutoMerge(
      latestSavedTeacherVersion,
      laterStudentSubmission,
      latestSavedTeacherVersion,
    )

    expect(latestWins.application.school.name).toBe('Student Latest University')
    expect(latestWins.cleanFields).toEqual(['school.name'])
    expect(latestWins.conflicts).toEqual([])
    expect(latestWins.teacherPriorityFields).toEqual([])
    expect(latestWins.retainedFields).toEqual([])
  })

  it('merges disjoint personal edits but refuses a same-field lost update', () => {
    const base = {
      program: 'Original program',
      tags: ['original'],
      updatedAt: '2026-08-02T12:00:00.000Z',
    }
    const current = {
      ...base,
      program: 'Server program',
      updatedAt: '2026-08-02T12:00:00.001Z',
    }
    const disjoint = resolveApplicationConcurrentWrite(
      base,
      { ...base, tags: ['original', 'client-tag'] },
      current,
    )
    expect(disjoint.conflicts).toEqual([])
    expect(disjoint.appliedFields).toEqual(['tags'])
    expect(disjoint.application).toMatchObject({
      program: 'Server program',
      tags: ['original', 'client-tag'],
    })

    const conflict = resolveApplicationConcurrentWrite(
      base,
      { ...base, program: 'Client program' },
      current,
    )
    expect(conflict.application).toBeNull()
    expect(conflict.appliedFields).toEqual([])
    expect(conflict.conflicts).toEqual([
      expect.objectContaining({ field: 'program', status: 'conflict' }),
    ])
  })

  it('advances application version stamps under same-millisecond writes and clock rollback', () => {
    expect(nextApplicationVersionStamp(
      '2026-08-02T12:00:00.000Z',
      Date.parse('2026-08-02T12:00:00.000Z'),
    )).toBe('2026-08-02T12:00:00.001Z')
    expect(nextApplicationVersionStamp(
      '2026-08-02T12:00:01.000Z',
      Date.parse('2026-08-02T11:59:59.000Z'),
    )).toBe('2026-08-02T12:00:01.001Z')
  })

  it('never truncates correctness-critical merge fields at the audit summary limit', () => {
    const base = Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`field${index}`, 'base']))
    const submitted = { ...base, field89: 'submitted' }
    const current = { ...base, field0: 'current' }

    expect(summarizeApplicationChanges(base, {
      ...base,
      ...Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`field${index}`, 'changed'])),
    })).toHaveLength(80)
    expect(resolveApplicationConcurrentWrite(base, submitted, current)).toMatchObject({
      conflicts: [],
      appliedFields: ['field89'],
      application: { field0: 'current', field89: 'submitted' },
    })
  })
})
