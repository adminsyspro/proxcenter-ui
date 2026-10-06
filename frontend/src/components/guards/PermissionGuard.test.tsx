import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PermissionGuard from './PermissionGuard'

const useRBACMock = vi.fn()
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => useRBACMock() }))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

const rbac = (perms: string[], loading = false) => ({ loading, hasPermission: (p: string) => perms.includes(p) })

describe('PermissionGuard', () => {
  beforeEach(() => useRBACMock.mockReset())
  afterEach(() => cleanup())

  it('renders the page when the permission is held', () => {
    useRBACMock.mockReturnValue(rbac(['storage.admin']))
    render(<PermissionGuard permission='storage.admin'><div data-testid='inner' /></PermissionGuard>)
    expect(screen.getByTestId('inner')).toBeInTheDocument()
  })

  it('renders the access denied state, not the page, when the permission is missing (#920)', () => {
    useRBACMock.mockReturnValue(rbac(['storage.view']))
    render(<PermissionGuard permission='storage.admin'><div data-testid='inner' /></PermissionGuard>)
    expect(screen.queryByTestId('inner')).not.toBeInTheDocument()
    expect(screen.getByText('403.title')).toBeInTheDocument()
    expect(screen.getByText('403.description')).toBeInTheDocument()
  })

  it('mounts neither the page nor the denial while permissions load', () => {
    useRBACMock.mockReturnValue(rbac([], true))
    render(<PermissionGuard permission='storage.admin'><div data-testid='inner' /></PermissionGuard>)
    expect(screen.queryByTestId('inner')).not.toBeInTheDocument()
    expect(screen.queryByText('403.title')).not.toBeInTheDocument()
  })
})
