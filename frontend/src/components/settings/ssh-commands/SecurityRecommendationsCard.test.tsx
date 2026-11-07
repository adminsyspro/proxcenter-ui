/**
 * The sudoers recommendations of Settings > SSH Commands: the profiles picked
 * shape the generated file, and the card says which rules stay root
 * equivalent, which a stolen key could still misuse, and where the sFlow rule
 * is pinned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { FRONTEND_SUDO_RULES, pinSFlowCollector } from '@/lib/ssh/sudo'

const swr = vi.hoisted(() => ({ data: undefined as unknown }))

vi.mock('swr', async importOriginal => ({
  ...(await importOriginal<typeof import('swr')>()),
  default: () => ({ data: swr.data }),
}))

import SecurityRecommendationsCard from './SecurityRecommendationsCard'

afterEach(cleanup)

const ROOT_RULE = { id: 'sr-conf-tee', profile: 'site-recovery', path: '/usr/bin/tee', args: '^x$', usedBy: 'Replication', rootEquivalent: true, why: 'Writes a guest configuration as root.' }

describe('SecurityRecommendationsCard', () => {
  it('warns about the open sFlow rule and the root-equivalent ones while no collector is saved', () => {
    swr.data = { rules: [...FRONTEND_SUDO_RULES, ROOT_RULE], orchestratorAvailable: true, sflowCollector: null }
    renderWithProviders(<SecurityRecommendationsCard />)

    expect(screen.getByText(/stay equivalent to root/)).toBeTruthy()
    expect(screen.getByText(/Writes a guest configuration as root/)).toBeTruthy()
    expect(screen.getByText(/a stolen key could still misuse them/)).toBeTruthy()
    expect(screen.queryByText(/the sFlow rule only lets the nodes send to/)).toBeNull()
  })

  it('names the pinned collector and drops the sFlow warning once a collector is saved', () => {
    swr.data = { rules: pinSFlowCollector(FRONTEND_SUDO_RULES, '10.42.0.250:6343'), orchestratorAvailable: false, sflowCollector: '10.42.0.250:6343' }
    renderWithProviders(<SecurityRecommendationsCard />)

    expect(screen.getByText(/only lets the nodes send to 10\.42\.0\.250:6343/)).toBeTruthy()
    expect(screen.queryByText(/a stolen key could still misuse them/)).toBeNull()
    expect(screen.getByText(/proxcenter ALL=\(root\) NOPASSWD: PXC_NODE_OPS/)).toBeTruthy()
  })

  it('warns that the migrations profile grants everything when it is picked', () => {
    swr.data = { rules: FRONTEND_SUDO_RULES, orchestratorAvailable: true, sflowCollector: null }
    renderWithProviders(<SecurityRecommendationsCard />)
    fireEvent.click(screen.getByLabelText('Migrations'))

    expect(screen.getAllByText(/NOPASSWD: ALL/).length).toBeGreaterThan(0)
  })
})
