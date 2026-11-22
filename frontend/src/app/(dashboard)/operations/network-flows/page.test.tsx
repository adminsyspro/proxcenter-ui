import { describe, expect, it, vi } from 'vitest'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect }))

import NetworkFlowsPage from './page'

describe('the old network flows page', () => {
  it('sends an old link or bookmark to the Dashboard of Network Security, where the volumes are', () => {
    NetworkFlowsPage()
    expect(redirect).toHaveBeenCalledWith('/automation/network?tab=dashboard')
  })
})
