import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import { CephScopedFlagChips, OsdFlagChips } from './CephFlagChips'

/*
   ui#1164: the text that makes a per-host or per-OSD flag visible, in the
   Status cell of an OSD table and in the flag list of the cluster views.
   Plain text grouped by scope ("pve3 : noout, noin"), no rounded chips.
*/

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OsdFlagChips', () => {
  it('lists the flags that apply to the OSD in the banner order, naming each source in the tooltip', () => {
    renderWithProviders(
      <OsdFlagChips osdId={4} host='pve3' osdFlags={{ 'osd.4': ['nodown'] }} hostFlags={{ pve3: ['noup', 'noout'] }} />,
    )
    const text = screen.getByTestId('osd-flags')
    expect(text).toHaveTextContent('noout · noup · nodown')
    expect(text).toHaveAttribute('aria-label', 'noout set on host pve3 · noup set on host pve3 · nodown set on osd.4')
    expect(document.querySelector('.MuiChip-root')).toBeNull()
  })

  it('reaches the host flags through the FQDN of the CRUSH host', () => {
    renderWithProviders(<OsdFlagChips osdId='osd.2' host='pve1' osdFlags={{}} hostFlags={{ 'pve1.lab.local': ['noout'] }} />)
    expect(screen.getByTestId('osd-flags')).toHaveAttribute('aria-label', 'noout set on host pve1.lab.local')
  })

  it('renders nothing for an OSD none of the flags applies to', () => {
    renderWithProviders(<OsdFlagChips osdId={1} host='pve2' osdFlags={{ 'osd.4': ['nodown'] }} hostFlags={{ pve3: ['noout'] }} />)
    expect(screen.queryByTestId('osd-flags')).toBeNull()
  })
})

describe('CephScopedFlagChips', () => {
  it('groups the flags by scope: cluster-wide, hosts, then OSDs read-only', () => {
    renderWithProviders(
      <CephScopedFlagChips
        globalFlags={['noscrub']}
        hostFlags={{ pve3: ['nodown', 'noout', 'noin'] }}
        osdFlags={{ 'osd.4': ['nodown'] }}
        onRemoveGlobal={vi.fn()}
        onRemoveHost={vi.fn()}
      />,
    )
    const groups = [...screen.getByTestId('ceph-scoped-flags').querySelectorAll('[data-testid^="ceph-flag-group-"]')]
    expect(groups.map(g => g.textContent)).toEqual(['Cluster-widenoscrub', 'pve3noout · noin · nodown', 'osd.4nodown'])
    expect(screen.getByLabelText('noout, noin, nodown are set on CRUSH host pve3 (ceph osd set-group)')).toBeInTheDocument()
    expect(screen.getByLabelText('nodown set on osd.4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /osd\.4/ })).toBeNull()
    expect(document.querySelector('.MuiChip-root')).toBeNull()
  })

  it('removes every flag of a host, one after the other, and the cluster-wide ones', async () => {
    const onRemoveHost = vi.fn().mockResolvedValue(undefined)
    const onRemoveGlobal = vi.fn()
    renderWithProviders(
      <CephScopedFlagChips globalFlags={['noscrub']} hostFlags={{ pve3: ['noup', 'noout'] }} osdFlags={{}} onRemoveHost={onRemoveHost} onRemoveGlobal={onRemoveGlobal} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove noout, noup from pve3' }))
    await waitFor(() => expect(onRemoveHost).toHaveBeenCalledTimes(2))
    expect(onRemoveHost.mock.calls).toEqual([['pve3', 'noout'], ['pve3', 'noup']])

    fireEvent.click(screen.getByRole('button', { name: 'Remove noscrub from Cluster-wide' }))
    await waitFor(() => expect(onRemoveGlobal).toHaveBeenCalledWith('noscrub'))
  })

  it('stacks one group per line without separators for a narrow card', () => {
    const { unmount } = renderWithProviders(<CephScopedFlagChips globalFlags={['noscrub']} hostFlags={{ pve3: ['noout'] }} osdFlags={{}} />)
    expect(screen.getByTestId('ceph-scoped-flags').querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
    unmount()

    renderWithProviders(<CephScopedFlagChips globalFlags={['noscrub']} hostFlags={{ pve3: ['noout'] }} osdFlags={{}} stacked />)
    const box = screen.getByTestId('ceph-scoped-flags')
    expect(box.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
    expect(box).toHaveStyle({ flexDirection: 'column' })
  })

  it('offers no removal without a handler, and renders nothing without a flag', () => {
    const { unmount } = renderWithProviders(<CephScopedFlagChips hostFlags={{ pve3: ['noout'] }} osdFlags={{}} />)
    expect(screen.getByTestId('ceph-flag-group-pve3')).toHaveTextContent('pve3noout')
    expect(screen.queryByRole('button')).toBeNull()
    unmount()

    renderWithProviders(<CephScopedFlagChips hostFlags={{}} osdFlags={{}} />)
    expect(screen.queryByTestId('ceph-scoped-flags')).toBeNull()
  })

  it('disables and spins the group being written', () => {
    renderWithProviders(<CephScopedFlagChips hostFlags={{ pve3: ['noout'] }} osdFlags={{}} toggling='pve3:noout' onRemoveHost={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Remove noout from pve3' })
    expect(button).toBeDisabled()
    expect(button.querySelector('.MuiCircularProgress-root')).not.toBeNull()
  })
})
