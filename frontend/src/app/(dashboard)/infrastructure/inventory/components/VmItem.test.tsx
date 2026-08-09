import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { useTranslations } from 'next-intl'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { VmItem, type VmItemProps } from './VmItem'

// The jsdom lane has no RTL auto-cleanup; without this, the negative
// assertions below would match leftovers from the previous render.
afterEach(cleanup)

// VmItem takes `t` as a prop (typed as useTranslations' return), so a tiny
// harness sources it from the provider renderWithProviders already mounts.
function Harness(props: Omit<VmItemProps, 't'>) {
  const t = useTranslations()
  return <VmItem {...props} t={t} />
}

const baseProps: Omit<VmItemProps, 't' | 'variant'> = {
  vmKey: 'conn1:pve-2-2:qemu:100',
  connId: 'conn1',
  connName: 'Cluster1',
  node: 'pve-2-2',
  vmType: 'qemu',
  vmid: '100',
  name: 'web-01',
  status: 'running',
  isSelected: false,
  isMigrating: false,
  isPendingAction: false,
  isFavorite: false,
  onFavoriteToggle: vi.fn(),
  onClick: vi.fn(),
  onContextMenu: vi.fn(),
}

describe('VmItem node caption (issue #666)', () => {
  it.each(['flat', 'favorite', 'template'] as const)(
    'shows the node caption on the %s variant when showNode is set',
    variant => {
      renderWithProviders(<Harness {...baseProps} variant={variant} showNode />)
      expect(screen.getByText('· pve-2-2')).toBeInTheDocument()
    },
  )

  it('does not show the node caption without showNode', () => {
    renderWithProviders(<Harness {...baseProps} variant="flat" />)
    expect(screen.queryByText(/pve-2-2/)).not.toBeInTheDocument()
  })

  it('does not show the node caption on the grouped variant even with showNode', () => {
    renderWithProviders(<Harness {...baseProps} variant="grouped" showNode />)
    expect(screen.queryByText(/pve-2-2/)).not.toBeInTheDocument()
  })

  it('still renders the VM name alongside the caption', () => {
    renderWithProviders(<Harness {...baseProps} variant="flat" showNode />)
    expect(screen.getByText('web-01')).toBeInTheDocument()
  })

  it('reacts to showNode flipping on an already-mounted instance (exercises the memo comparator)', () => {
    const { rerender } = renderWithProviders(<Harness {...baseProps} variant="flat" />)
    expect(screen.queryByText(/pve-2-2/)).not.toBeInTheDocument()

    rerender(<Harness {...baseProps} variant="flat" showNode />)
    expect(screen.getByText('· pve-2-2')).toBeInTheDocument()

    rerender(<Harness {...baseProps} variant="flat" showNode={false} />)
    expect(screen.queryByText(/pve-2-2/)).not.toBeInTheDocument()
  })
})
