import { describe, expect, it } from 'vitest'
import {
  ApplicationSchema,
  CreateApplicationSchema,
  parseOrThrow,
} from './validation.js'

function applicationWithCountry(country) {
  return {
    id: 'app_optional_country',
    professor: {
      english: 'Professor Lee',
      chinese: '',
      email: 'lee@example.edu',
      phone: '',
      social: '',
      homepage: '',
      research: 'Human-computer interaction',
      lab: '',
    },
    school: {
      name: 'Example University',
      country,
      website: '',
    },
    program: 'Computer Science PhD',
    deadline: '',
    status: 'Draft',
    progress: 15,
    priority: 50,
    tags: [],
    nextReminder: '',
    result: '',
    materials: [],
    communications: [],
    scholarships: [],
    tasks: [],
    timeline: [],
  }
}

describe('optional application country validation', () => {
  it('accepts an empty country on a complete application update', () => {
    expect(parseOrThrow(ApplicationSchema, applicationWithCountry('')).school.country).toBe('')
  })

  it('defaults an omitted country to empty when creating an application', () => {
    const parsed = parseOrThrow(CreateApplicationSchema, {
      professor: 'Professor Lee',
      professorEmail: 'lee@example.edu',
      university: 'Example University',
      program: 'Computer Science PhD',
      deadline: '',
    })

    expect(parsed.country).toBe('')
  })
})
