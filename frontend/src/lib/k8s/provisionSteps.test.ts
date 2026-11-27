import { describe, it, expect } from 'vitest'
import { deriveProvisionSteps, PROVISION_STEP_KEYS } from './provisionSteps'

function state(steps: { key: string; state: string }[], key: string) {
  return steps.find(s => s.key === key)!.state
}

describe('deriveProvisionSteps', () => {
  it('marks every step pending while queued', () => {
    const steps = deriveProvisionSteps({ status: 'pending', phase: 'init' })
    expect(steps.map(s => s.key)).toEqual([...PROVISION_STEP_KEYS])
    expect(steps.every(s => s.state === 'pending')).toBe(true)
  })

  it('running/apply: init done, apply active, later steps pending', () => {
    const steps = deriveProvisionSteps({ status: 'running', phase: 'apply' })
    expect(state(steps, 'init')).toBe('done')
    expect(state(steps, 'apply')).toBe('active')
    expect(state(steps, 'bootstrap')).toBe('pending')
    expect(state(steps, 'register')).toBe('pending')
    expect(state(steps, 'ready')).toBe('pending')
  })

  it('running/bootstrap: init+apply done, bootstrap active', () => {
    const steps = deriveProvisionSteps({ status: 'running', phase: 'bootstrap' })
    expect(state(steps, 'init')).toBe('done')
    expect(state(steps, 'apply')).toBe('done')
    expect(state(steps, 'bootstrap')).toBe('active')
  })

  it('running with an unknown phase treats init as active', () => {
    const steps = deriveProvisionSteps({ status: 'running', phase: 'plan' })
    expect(state(steps, 'init')).toBe('active')
    expect(state(steps, 'apply')).toBe('pending')
  })

  it('failed during bootstrap: init+apply done, bootstrap failed, tail pending', () => {
    const steps = deriveProvisionSteps({ status: 'failed', phase: 'bootstrap' })
    expect(state(steps, 'init')).toBe('done')
    expect(state(steps, 'apply')).toBe('done')
    expect(state(steps, 'bootstrap')).toBe('failed')
    expect(state(steps, 'register')).toBe('pending')
    expect(state(steps, 'ready')).toBe('pending')
  })

  it('failed with an unknown phase marks the first step failed', () => {
    const steps = deriveProvisionSteps({ status: 'failed', phase: '' })
    expect(state(steps, 'init')).toBe('failed')
  })

  it('completed + registering: run phases done, register active, ready pending', () => {
    const steps = deriveProvisionSteps({ status: 'completed', phase: 'bootstrap', registering: true })
    expect(state(steps, 'init')).toBe('done')
    expect(state(steps, 'bootstrap')).toBe('done')
    expect(state(steps, 'register')).toBe('active')
    expect(state(steps, 'ready')).toBe('pending')
  })

  it('completed + registered: everything done', () => {
    const steps = deriveProvisionSteps({ status: 'completed', phase: 'bootstrap', registered: true })
    expect(steps.every(s => s.state === 'done')).toBe(true)
  })

  it('completed + register error: register failed, ready pending', () => {
    const steps = deriveProvisionSteps({ status: 'completed', phase: 'bootstrap', registerError: true })
    expect(state(steps, 'register')).toBe('failed')
    expect(state(steps, 'ready')).toBe('pending')
  })
})
