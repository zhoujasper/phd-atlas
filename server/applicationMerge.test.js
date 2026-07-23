import { describe, expect, it } from 'vitest'
import {
  auditClone,
  buildApplicationAutoMerge,
  buildApplicationMergePreview,
  compactChangeList,
  isMajorApplicationChange,
  resolveApplicationAutoMerge,
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

    expect(buildApplicationMergePreview(base, submitted, current)).toEqual([
      expect.objectContaining({ field: 'school.name', status: 'conflict' }),
      expect.objectContaining({ field: 'deadline', status: 'same' }),
      expect.objectContaining({ field: 'program', status: 'clean' }),
    ])
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
})
