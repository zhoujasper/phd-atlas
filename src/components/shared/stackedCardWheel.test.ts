import { describe, expect, it } from 'vitest'
import {
  consumeStackedCardWheelDelta,
  createStackedCardWheelState,
  normalizeStackedCardWheelDelta,
  STACKED_CARD_WHEEL_IDLE_MS,
} from './stackedCardWheel'

describe('stackedCardWheel', () => {
  it('keeps the threshold remainder so sustained equal input can turn repeatedly', () => {
    const state = createStackedCardWheelState()
    const turns = [12, 12, 12, 12, 12, 12, 12, 12].map((delta, index) => (
      consumeStackedCardWheelDelta(state, delta, index * 12)
    ))

    expect(turns.filter(Boolean)).toEqual([1, 1])
    expect(state.delta).toBe(0)
  })

  it('filters a decaying momentum tail after the first intentional turn', () => {
    const state = createStackedCardWheelState()
    const turns = [48, 32, 24, 16, 10, 6, 4, 2].map((delta, index) => (
      consumeStackedCardWheelDelta(state, delta, index * 12)
    ))

    expect(turns.filter(Boolean)).toEqual([1])
  })

  it('lets a direction reversal immediately start a fresh accumulator', () => {
    const state = createStackedCardWheelState()

    expect(consumeStackedCardWheelDelta(state, 30, 0)).toBe(0)
    expect(consumeStackedCardWheelDelta(state, -20, 12)).toBe(0)
    expect(consumeStackedCardWheelDelta(state, -27, 24)).toBe(0)
    expect(consumeStackedCardWheelDelta(state, -1, 36)).toBe(-1)
  })

  it('starts a new burst after the idle boundary and normalizes wheel units', () => {
    const state = createStackedCardWheelState()

    expect(consumeStackedCardWheelDelta(state, 40, 0)).toBe(0)
    expect(consumeStackedCardWheelDelta(
      state,
      12,
      STACKED_CARD_WHEEL_IDLE_MS,
    )).toBe(0)
    expect(state.delta).toBe(12)
    expect(normalizeStackedCardWheelDelta(2, 1, 400)).toBe(32)
    expect(normalizeStackedCardWheelDelta(1, 2, 400)).toBe(400)
  })
})
