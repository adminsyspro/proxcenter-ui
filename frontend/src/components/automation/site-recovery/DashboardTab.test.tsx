import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { ReplicationHealthStatus } from '@/lib/orchestrator/site-recovery.types'

import DashboardTab from './DashboardTab'

afterEach(cleanup)

function health(overrides: Partial<ReplicationHealthStatus> = {}): ReplicationHealthStatus {
  return {
    sites: [{
      cluster_id: 'source-cluster',
      name: 'Source cluster',
      role: 'primary',
      status: 'online',
      node_count: 1,
      vm_count: 3,
    }],
    connectivity: 'connected',
    latency_ms: 2,
    kpis: {
      protected_vms: 3,
      unprotected_vms: 0,
      avg_rpo_seconds: 60,
      last_sync: '',
      replicated_bytes: 0,
      error_count: 0,
      total_jobs: 3,
      rpo_compliance: 100,
      concurrent_jobs: 0,
      max_concurrent_jobs: 2,
    },
    recent_activity: [],
    job_summary: {
      synced: 1,
      syncing: 0,
      pending: 0,
      error: 0,
      paused: 0,
      no_match: 0,
    },
    ...overrides,
  }
}

function renderDashboard(value: ReplicationHealthStatus | undefined) {
  renderWithProviders(
    <DashboardTab
      health={value}
      loading={false}
      jobs={[]}
      connections={[]}
      vmNamesByConn={{}}
      onSyncJob={vi.fn()}
    />,
  )
}

describe('DashboardTab job status distribution', () => {
  it('renders the no-match segment and count', () => {
    renderDashboard(health({
      job_summary: {
        synced: 1,
        syncing: 0,
        pending: 0,
        error: 0,
        paused: 0,
        no_match: 2,
      },
    }))

    const label = screen.getByText(/No matching VMs/)
    expect(label).toHaveTextContent('No matching VMs: 2')
  })

  it('treats a missing no_match count as zero', () => {
    renderDashboard(health({
      job_summary: {
        synced: 1,
        syncing: 0,
        pending: 0,
        error: 0,
        paused: 0,
      } as any,
    }))

    expect(screen.getByText(/Synced/)).toHaveTextContent('Synced: 1')
    expect(screen.queryByText(/No matching VMs/)).not.toBeInTheDocument()
  })

  it('renders the empty state when health is unavailable', () => {
    renderDashboard(undefined)

    expect(screen.getByText('No replication job configured')).toBeInTheDocument()
  })
})
