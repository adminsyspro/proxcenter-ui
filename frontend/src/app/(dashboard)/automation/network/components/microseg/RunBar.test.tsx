/** The bar of a run in progress: what the engine says it is doing, and how far it is. */

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegRun, MicrosegRunProgress } from '@/lib/microseg/types'

import RunBar from './RunBar'
import { run } from './policyTestKit'

const at = (progress: MicrosegRunProgress): MicrosegRun => run('running', { progress } as MicrosegRun['result'])
const bar = () => screen.getByRole('progressbar', { name: 'web: change in progress' })
const show = (r: MicrosegRun | null) => renderWithProviders(<RunBar run={r} label='web: change in progress' />)

afterEach(() => {
  cleanup()
})

describe('run bar', () => {
  it('only shows the run is alive before the engine says where it stands', () => {
    show(null)
    expect(bar().getAttribute('aria-valuenow')).toBeNull()
  })

  it('only shows the run is alive on an engine that records no progress', () => {
    show(run('running', {} as MicrosegRun['result']))
    expect(bar().getAttribute('aria-valuenow')).toBeNull()
  })

  it('says the run waits behind another one, without a count', () => {
    show(at({ phase: 'waiting', done: 0, total: 0 }))
    expect(screen.getByText('waiting for the operation in progress')).toBeTruthy()
    expect(bar().getAttribute('aria-valuenow')).toBeNull()
  })

  it('says the run reads Proxmox before the guests to read are known', () => {
    show(at({ phase: 'reading', done: 0, total: 0 }))
    expect(screen.getByText('reading Proxmox')).toBeTruthy()
    expect(bar().getAttribute('aria-valuenow')).toBeNull()
  })

  it('counts the guests read', () => {
    show(at({ phase: 'reading', done: 12, total: 33 }))
    expect(screen.getByText('reading Proxmox, 12 / 33 guests')).toBeTruthy()
    expect(bar().getAttribute('aria-valuenow')).toBe('36')
  })

  it('counts the steps written', () => {
    show(at({ phase: 'writing', done: 42, total: 99 }))
    expect(screen.getByText('writing to Proxmox, 42 / 99')).toBeTruthy()
    expect(bar().getAttribute('aria-valuenow')).toBe('42')
  })

  it('shows no count of a phase it does not know', () => {
    show(at({ phase: 'later', done: 1, total: 2 }))
    expect(bar().getAttribute('aria-valuenow')).toBeNull()
  })

  it('ignores the progress left on a run that ended', () => {
    show(run('failed', { progress: { phase: 'writing', done: 1, total: 2 } } as MicrosegRun['result']))
    expect(screen.queryByText(/writing to Proxmox/)).toBeNull()
  })
})
