import { describe, expect, it } from 'vitest'

import type { MicrosegRun } from '@/lib/microseg/types'

import { groupState, stepStates, stepsWithOutcome } from './planStepStates'
import { PLAN_STEPS, applyRun, g101, step } from './planTestKit'

const running = (progress?: { phase: string; done: number; total: number }): MicrosegRun => ({
  ...applyRun({}, 'running'), result: progress ? ({ progress } as MicrosegRun['result']) : null,
})
const statesOf = (run: MicrosegRun | null) => {
  const states = stepStates(PLAN_STEPS, run)
  return states ? PLAN_STEPS.map(s => states.get(s.index)).join(' ') : null
}

describe('stepStates', () => {
  it('makes every step wait until the engine writes: before its first answer, while it waits, while it reads the guests', () => {
    const waiting = 'waiting waiting waiting waiting waiting waiting'
    expect(statesOf(null)).toBe(waiting)
    expect(statesOf(running())).toBe(waiting)
    expect(statesOf(running({ phase: 'waiting', done: 0, total: 0 }))).toBe(waiting)
    expect(statesOf(running({ phase: 'reading', done: 3, total: 40 }))).toBe(waiting)
  })

  it('checks the steps written, marks the one being written, and leaves the others waiting', () => {
    expect(statesOf(running({ phase: 'writing', done: 0, total: 6 }))).toBe('running waiting waiting waiting waiting waiting')
    expect(statesOf(running({ phase: 'writing', done: 3, total: 6 }))).toBe('done done done running waiting waiting')
  })

  it('gives up the marks when the application writes another plan than the one shown', () => {
    expect(statesOf(running({ phase: 'writing', done: 3, total: 9 }))).toBeNull()
    expect(stepStates([], running({ phase: 'writing', done: 0, total: 0 }))).toBeNull()
  })

  it('takes the outcome of each step from the result once the application has ended', () => {
    const ended = applyRun({ done: PLAN_STEPS.slice(0, 4), failed: [{ ...PLAN_STEPS[4], error: 'guest is locked' }], not_run: [PLAN_STEPS[5]] })
    expect(statesOf(ended)).toBe('done done done done failed notRun')
  })

  it('gives up the marks when the result does not account for every step of the plan shown', () => {
    expect(statesOf(applyRun({ done: PLAN_STEPS.slice(0, 2) }))).toBeNull()
    expect(statesOf(applyRun({ done: [...PLAN_STEPS.slice(0, 5), step(9, 'guest.tags', 'Tag other', g101)] }))).toBeNull()
    expect(statesOf({ ...applyRun(), result: null })).toBeNull()
  })
})

describe('stepsWithOutcome', () => {
  it('gives a failed or skipped step the reason the application gave, and leaves the others as planned', () => {
    const ended = applyRun({ done: PLAN_STEPS.slice(0, 5), failed: [{ ...PLAN_STEPS[5], error: 'guest is locked' }] })
    const steps = stepsWithOutcome(PLAN_STEPS, ended)
    expect(steps[5].error).toBe('guest is locked')
    expect(steps.slice(0, 5)).toEqual(PLAN_STEPS.slice(0, 5))
  })
})

describe('groupState', () => {
  const states = stepStates(PLAN_STEPS, running({ phase: 'writing', done: 3, total: 6 }))!

  it('sums a group up: done when all its steps are, running when it is being written, waiting before', () => {
    expect(groupState(PLAN_STEPS.slice(0, 2), states)).toEqual({ done: 2, state: 'done' })
    expect(groupState(PLAN_STEPS.slice(2, 5), states)).toEqual({ done: 1, state: 'running' })
    expect(groupState(PLAN_STEPS.slice(5), states)).toEqual({ done: 0, state: 'waiting' })
  })

  it('says a group failed as soon as one of its steps did, and not run when the rest was skipped', () => {
    const ended = stepStates(PLAN_STEPS, applyRun({ done: PLAN_STEPS.slice(0, 3), failed: [PLAN_STEPS[3]], not_run: PLAN_STEPS.slice(4) }))!
    expect(groupState(PLAN_STEPS.slice(2, 5), ended)).toEqual({ done: 1, state: 'failed' })
    expect(groupState(PLAN_STEPS.slice(5), ended)).toEqual({ done: 0, state: 'notRun' })
  })
})
