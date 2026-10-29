/**
 * The author of a journal row: the badge of how sure the attribution is, the
 * evidence on hover, and the evidence section of a row's details with the
 * linked Proxmox task's log.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import type { JournalChange } from '@/lib/changes/journal'

vi.mock('@/components/tasks/TaskLogButton', () => ({
  default: ({ upid, node }: { upid: string; node?: string }) => <span data-testid='task-log'>{`${upid}@${node}`}</span>
}))

import { AuthorCell, AuthorEvidence } from './AuthorCell'

const at = '2026-10-29T08:00:00Z'

const change = (over: Partial<JournalChange>): JournalChange => ({
  id: 1,
  timestamp: at,
  connectionId: 'c1',
  resourceType: 'vm',
  resourceId: '101',
  action: 'config_changed',
  ...over
})

const VERIFIED = change({
  user: 'ops@example.com',
  attribution: 'verified',
  actors: [
    { name: 'ops@example.com', source: 'audit', at, ref: 'a1' },
    { name: 'root@pam!px', source: 'journal', at, node: 'pve1', token: true }
  ]
})

const INFERRED = change({
  id: 2,
  user: 'bob@pve',
  attribution: 'inferred',
  actors: [{ name: 'bob@pve', source: 'task', at, node: 'pve2', ref: 'UPID:pve2:1:qmigrate:101:bob@pve:', taskType: 'qmigrate' }]
})

describe('AuthorCell', () => {
  afterEach(cleanup)

  it('shows the authors after the badge of the least certain attribution', () => {
    renderWithProviders(<AuthorCell changes={[VERIFIED, INFERRED]} />)

    expect(screen.getByText('ops@example.com, bob@pve')).toBeInTheDocument()
    expect(screen.getByLabelText('Inferred')).toBeInTheDocument()
  })

  it('lists the evidence on hover, the token named as such', async () => {
    renderWithProviders(<AuthorCell changes={[VERIFIED]} />)

    fireEvent.mouseOver(screen.getByText('ops@example.com'))

    expect(await screen.findByText("Recorded by ProxCenter's audit log")).toBeInTheDocument()
    expect(screen.getByText('ops@example.com · ProxCenter audit log')).toBeInTheDocument()
    expect(screen.getByText("root@pam!px · Journal of node pve1 · ProxCenter's API token")).toBeInTheDocument()
  })

  it('says unknown when nothing names the author', () => {
    renderWithProviders(<AuthorCell changes={[change({ user: '', attribution: 'unknown' })]} />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByLabelText('Unknown')).toBeInTheDocument()
  })

  it('counts a change nothing names among the authors of a burst', () => {
    renderWithProviders(<AuthorCell changes={[VERIFIED, change({ id: 3, user: '', attribution: 'unknown' })]} />)

    expect(screen.getByText('ops@example.com, Unknown')).toBeInTheDocument()
  })

  it('keeps the bare user of a row from before attribution', () => {
    renderWithProviders(<AuthorCell changes={[change({ user: 'system' })]} />)

    expect(screen.getByText('system')).toBeInTheDocument()
    expect(screen.queryByLabelText('Verified')).toBeNull()
  })
})

describe('AuthorEvidence', () => {
  afterEach(cleanup)

  it('lists each piece of evidence, a task with its log', () => {
    renderWithProviders(<AuthorEvidence change={INFERRED} />)

    expect(screen.getByText('Author · Inferred')).toBeInTheDocument()
    expect(screen.getByText('bob@pve')).toBeInTheDocument()
    expect(screen.getByText('Proxmox task qmigrate on pve2')).toBeInTheDocument()
    expect(screen.getByTestId('task-log')).toHaveTextContent('UPID:pve2:1:qmigrate:101:bob@pve:@pve2')
  })

  it('shows an account of another tenant as masked, without a log', () => {
    renderWithProviders(
      <AuthorEvidence change={change({ user: 'ProxCenter', attribution: 'verified', actors: [{ name: 'ProxCenter', source: 'audit', at, masked: true }] })} />
    )

    expect(screen.getByText('Account outside your tenant')).toBeInTheDocument()
    expect(screen.queryByTestId('task-log')).toBeNull()
  })

  it('explains an unknown author', () => {
    renderWithProviders(<AuthorEvidence change={change({ user: '', attribution: 'unknown' })} />)

    expect(screen.getByText('Author · Unknown')).toBeInTheDocument()
    expect(screen.getByText(/No task, journal line or audit entry/)).toBeInTheDocument()
  })

  it('renders nothing for a row from before attribution', () => {
    const { container } = renderWithProviders(<AuthorEvidence change={change({ user: 'system' })} />)

    expect(container).toBeEmptyDOMElement()
  })
})
