import { describe, expect, it } from 'vitest'
import {
  clampRelationshipZoom,
  relationshipScrollForZoom,
  relationshipDropMode,
  relationshipZoomFromPinch,
  teacherIdsAfterRelationshipDrop,
} from './teamRelationshipMapModel'

describe('team relationship-map interactions', () => {
  it('adds another teacher on Alt-drag without removing existing managers', () => {
    expect(relationshipDropMode(true)).toBe('add')
    expect(teacherIdsAfterRelationshipDrop(
      ['teacher-a', 'teacher-c'],
      'teacher-a',
      'teacher-b',
      'add',
    )).toEqual(['teacher-a', 'teacher-c', 'teacher-b'])
  })

  it('moves only the dragged teacher relationship and preserves the others', () => {
    expect(relationshipDropMode(false)).toBe('move')
    expect(teacherIdsAfterRelationshipDrop(
      ['teacher-a', 'teacher-c'],
      'teacher-a',
      'teacher-b',
      'move',
    )).toEqual(['teacher-b', 'teacher-c'])
  })

  it('removes the source relationship when the target teacher already manages the student', () => {
    expect(teacherIdsAfterRelationshipDrop(
      ['teacher-a', 'teacher-b', 'teacher-c'],
      'teacher-a',
      'teacher-b',
      'move',
    )).toEqual(['teacher-b', 'teacher-c'])
  })

  it('bounds relationship-map zoom while retaining smooth fractional wheel values', () => {
    expect(clampRelationshipZoom(0.2)).toBe(0.65)
    expect(clampRelationshipZoom(1.237)).toBe(1.24)
    expect(clampRelationshipZoom(4)).toBe(1.5)
  })

  it('scales a pinch from its starting distance and keeps the configured bounds', () => {
    expect(relationshipZoomFromPinch(1, 100, 125)).toBe(1.25)
    expect(relationshipZoomFromPinch(1.4, 100, 160)).toBe(1.5)
    expect(relationshipZoomFromPinch(0.8, 100, 50)).toBe(0.65)
  })

  it('keeps the map point beneath the gesture anchor while zooming and panning', () => {
    expect(relationshipScrollForZoom({
      startZoom: 1,
      nextZoom: 1.5,
      startScrollLeft: 100,
      startScrollTop: 40,
      startAnchor: { x: 80, y: 60 },
    })).toEqual({ left: 190, top: 90 })

    expect(relationshipScrollForZoom({
      startZoom: 1,
      nextZoom: 1.5,
      startScrollLeft: 100,
      startScrollTop: 40,
      startAnchor: { x: 80, y: 60 },
      nextAnchor: { x: 100, y: 75 },
    })).toEqual({ left: 170, top: 75 })
  })
})
