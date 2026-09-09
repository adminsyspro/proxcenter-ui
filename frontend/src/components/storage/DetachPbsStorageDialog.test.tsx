import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import DetachPbsStorageDialog from './DetachPbsStorageDialog'

const DELETE_URL = '*/api/v1/connections/cluster-1/storage/pbs-s3manu'

function makeProps() {
  return {
    target: { connId: 'cluster-1', connName: 'Production', storage: 'pbs-s3manu' },
    onClose: vi.fn(),
    onDetached: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DetachPbsStorageDialog', () => {
  it('renders the storage and cluster names with Cancel and Detach actions', () => {
    renderWithProviders(<DetachPbsStorageDialog {...makeProps()} />)
    const dialog = screen.getByRole('dialog', { name: 'Detach pbs-s3manu?' })

    expect(within(dialog).getByText('Cluster: Production')).toBeInTheDocument()
    expect(within(dialog).getByText(/The backups already on the datastore are kept/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Detach' })).toBeEnabled()
    expect(within(dialog).getAllByRole('button')).toHaveLength(2)
  })

  it('cancels without issuing a request or refreshing the storage list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const props = makeProps()
    renderWithProviders(<DetachPbsStorageDialog {...props} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })

    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onDetached).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      token: 'revoked', severity: 'Success', usedBy: [],
      message: 'Storage detached, and the token created for it was revoked on the backup server.',
    },
    {
      token: 'kept-in-use', severity: 'Info', usedBy: ['Staging', 'Disaster recovery'],
      message: 'Storage detached. Its token was kept, another cluster still uses it: Staging, Disaster recovery.',
    },
    {
      token: 'kept-unmanaged', severity: 'Info', usedBy: [],
      message: 'Storage detached. Its credentials were not created by ProxCenter, so they were left untouched.',
    },
    {
      token: 'kept-unknown-pbs', severity: 'Info', usedBy: [],
      message: 'Storage detached. Its backup server is not registered here, so its token could not be revoked.',
    },
    {
      token: 'revoke-failed', severity: 'Warning', usedBy: [],
      message: 'Storage detached, but revoking its token failed. Remove it on the backup server.',
    },
  ])('shows the $token verdict with $severity severity and only a Close action', async ({ token, severity, usedBy, message }) => {
    const remove = vi.fn()
    server.use(http.delete(DELETE_URL, () => {
      remove()
      return HttpResponse.json({ data: { token, usedBy } })
    }))
    const props = makeProps()
    renderWithProviders(<DetachPbsStorageDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detach' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(alert).toHaveClass(`MuiAlert-standard${severity}`)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(props.onDetached).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detach' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onDetached.mock.invocationCallOrder[0]).toBeLessThan(props.onClose.mock.invocationCallOrder[0])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('shows a failed DELETE error and keeps Cancel and Detach available', async () => {
    const remove = vi.fn()
    server.use(http.delete(DELETE_URL, () => {
      remove()
      return HttpResponse.json({ error: 'The cluster is unreachable.', code: 'PVE_UNAVAILABLE' }, { status: 502 })
    }))
    const props = makeProps()
    renderWithProviders(<DetachPbsStorageDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detach' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The cluster is unreachable.')
    expect(alert).toHaveClass('MuiAlert-standardError')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detach' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Detach pbs-s3manu?' })).toBeVisible()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(props.onDetached).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
