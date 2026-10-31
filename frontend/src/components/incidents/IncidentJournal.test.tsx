import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { IncidentComment } from '@/lib/incidents/types'

import IncidentJournal from './IncidentJournal'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const comment = (over: Partial<IncidentComment> = {}): IncidentComment => ({
  id: 'c1',
  incident_id: 'i1',
  body: 'restarted the node',
  internal: false,
  author_id: 'u1',
  author_name: 'Alice',
  created_at: '2026-10-27T10:00:00.000Z',
  ...over,
})

const run = vi.fn(async (fn: () => Promise<unknown>) => { await fn(); return null })

const renderJournal = (comments: IncidentComment[], extra: Partial<{ currentUserId: string; isAdmin: boolean; canManage: boolean }> = {}) =>
  renderWithProviders(
    <IncidentJournal incidentId='i1' comments={comments} canManage currentUserId='u1' isAdmin={false} run={run} {...extra} />,
  )

describe('IncidentJournal', () => {
  it('shows a body with markup literally, as text', () => {
    renderJournal([comment({ body: '<b>x</b> <script>alert(1)</script>' })])

    expect(screen.getByText('<b>x</b> <script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('marks an internal note and an edited comment', () => {
    renderJournal([comment({ internal: true, edited_at: '2026-10-27T10:05:00.000Z' })])

    expect(screen.getByText('Internal')).toBeInTheDocument()
    expect(screen.getByText('edited')).toBeInTheDocument()
  })

  it('posts a note with internal true when the box is ticked', async () => {
    const user = userEvent.setup()

    renderJournal([])
    await user.type(screen.getByLabelText('Add a comment'), 'secret')
    await user.click(screen.getByLabelText('Internal note'))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('/api/v1/incidents/i1/comments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ body: 'secret', internal: true })
  })

  it('posts a public comment by default', async () => {
    const user = userEvent.setup()

    renderJournal([])
    await user.type(screen.getByLabelText('Add a comment'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ body: 'hello', internal: false })
  })

  it('offers edit and delete to the author', () => {
    renderJournal([comment()])

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('hides edit and delete on the comment of another author', () => {
    renderJournal([comment({ author_id: 'u2' })])

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('lets an admin delete but not edit the comment of another author', () => {
    renderJournal([comment({ author_id: 'u2' })], { isAdmin: true })

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('deletes after a confirmation in a modal', async () => {
    const user = userEvent.setup()

    renderJournal([comment()])
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/incidents/i1/comments/c1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('hides every writing control without alerts.manage', () => {
    renderJournal([comment()], { canManage: false })

    expect(screen.queryByLabelText('Add a comment')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
