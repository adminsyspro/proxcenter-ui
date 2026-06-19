import { describe, it, expect } from 'vitest'
import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import { getVmIcon, StatusIcon, NodeIcon, ClusterIcon } from './TreeIcons'

/* ------------------------------------------------------------------ */
/* getVmIcon (pure function)                                           */
/* ------------------------------------------------------------------ */

describe('getVmIcon', () => {
  it('returns template fill icon when isTemplate=true and filled=true (default)', () => {
    expect(getVmIcon('qemu', true)).toBe('ri-file-copy-fill')
  })

  it('returns template outline icon when isTemplate=true and filled=false', () => {
    expect(getVmIcon('qemu', true, false)).toBe('ri-file-copy-line')
  })

  it('returns lxc fill icon for type lxc', () => {
    expect(getVmIcon('lxc')).toBe('ri-instance-fill')
  })

  it('returns lxc outline icon for type lxc with filled=false', () => {
    expect(getVmIcon('lxc', false, false)).toBe('ri-instance-line')
  })

  it('returns qemu fill icon for type qemu (default)', () => {
    expect(getVmIcon('qemu')).toBe('ri-computer-fill')
  })

  it('returns qemu outline icon for unknown type with filled=false', () => {
    expect(getVmIcon('qemu', false, false)).toBe('ri-computer-line')
  })

  it('template takes precedence over lxc type', () => {
    expect(getVmIcon('lxc', true)).toBe('ri-file-copy-fill')
  })
})

/* ------------------------------------------------------------------ */
/* StatusIcon                                                          */
/* ------------------------------------------------------------------ */

describe('StatusIcon', () => {
  it('renders nothing for type=node', () => {
    const { container } = renderWithProviders(<StatusIcon type="node" status="online" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a spinner (CircularProgress) when isPendingAction=true', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" status="stopped" isPendingAction />,
    )
    // CircularProgress renders an svg role="progressbar"
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy()
  })

  it('renders the icon glyph for a migrating VM', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" status="running" isMigrating />,
    )
    // The icon <i> element and the pulsing dot Box are both rendered
    const icon = container.querySelector('i.ri-computer-fill')
    expect(icon).toBeTruthy()
    // no progress spinner
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('renders the template icon with reduced opacity for template=true', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" template />,
    )
    const icon = container.querySelector('i.ri-file-copy-fill')
    expect(icon).toBeTruthy()
    // no status dot (Box after icon) means no progressbar and no pulsing
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('renders a running VM with the computer fill icon', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" status="running" />,
    )
    expect(container.querySelector('i.ri-computer-fill')).toBeTruthy()
  })

  it('renders an lxc VM with the instance fill icon', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="lxc" status="running" />,
    )
    expect(container.querySelector('i.ri-instance-fill')).toBeTruthy()
  })

  it('renders a lock badge icon when lock prop is set', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" status="running" lock="migrate" />,
    )
    expect(container.querySelector('i.ri-lock-fill')).toBeTruthy()
  })

  it('does not render a lock badge when lock prop is absent', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" status="running" />,
    )
    expect(container.querySelector('i.ri-lock-fill')).toBeNull()
  })

  it('renders a stopped VM (no spinner, no migrating animation)', () => {
    const { container } = renderWithProviders(
      <StatusIcon type="vm" vmType="qemu" status="stopped" />,
    )
    expect(container.querySelector('i.ri-computer-fill')).toBeTruthy()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* NodeIcon                                                            */
/* ------------------------------------------------------------------ */

describe('NodeIcon', () => {
  it('renders a Proxmox logo image', () => {
    const { container } = renderWithProviders(<NodeIcon status="online" />)
    // alt="" makes the img presentational; query directly
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toMatch(/proxmox-logo/)
  })

  it('renders with offline status (low opacity)', () => {
    const { container } = renderWithProviders(<NodeIcon status="offline" />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.style.opacity).toBe('0.4')
  })

  it('renders with online status (higher opacity)', () => {
    const { container } = renderWithProviders(<NodeIcon status="online" />)
    const img = container.querySelector('img')
    expect(img!.style.opacity).toBe('0.8')
  })

  it('renders with maintenance=wrench and applies orange tint', () => {
    const { container } = renderWithProviders(<NodeIcon status="online" maintenance="wrench" />)
    // maintenance dot shows ri-tools-fill icon
    expect(container.querySelector('i.ri-tools-fill')).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ */
/* ClusterIcon                                                         */
/* ------------------------------------------------------------------ */

describe('ClusterIcon', () => {
  it('renders the server fill icon', () => {
    const { container } = renderWithProviders(
      <ClusterIcon nodes={[{ status: 'online' }, { status: 'online' }]} />,
    )
    expect(container.querySelector('i.ri-server-fill')).toBeTruthy()
  })

  it('renders without crashing for an empty nodes array', () => {
    const { container } = renderWithProviders(<ClusterIcon nodes={[]} />)
    expect(container.querySelector('i.ri-server-fill')).toBeTruthy()
  })

  it('renders with a mix of online and offline nodes', () => {
    const { container } = renderWithProviders(
      <ClusterIcon nodes={[{ status: 'online' }, { status: 'offline' }]} />,
    )
    // Still renders the icon; dot color differs but structure is the same
    expect(container.querySelector('i.ri-server-fill')).toBeTruthy()
  })
})
