import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import en from '@/messages/en.json'
import AuditActorCell, { auditActorText } from './AuditActorCell'

// A display prefix, not a secret (the first characters of a token).
const PREFIX = 'pxc_Ab12Cd34'
const LABELS = { deletedToken: (en as any).settings.apiTokens.deletedToken, system: (en as any).audit.categories.system }

afterEach(() => cleanup())

describe('AuditActorCell', () => {
  it('shows a key icon and "<name> (<prefix>)" in place of the email for a token row', () => {
    const { container } = renderWithProviders(
      <AuditActorCell row={{ user_email: null, api_token_id: 'tok-1', api_token_name: 'terraform', api_token_prefix: PREFIX }} />,
    )
    expect(screen.getByText('terraform (pxc_Ab12Cd34)')).toBeInTheDocument()
    expect(container.querySelector('i.ri-key-2-line')).not.toBeNull()
  })

  it('labels a token that no longer exists as deleted, still with the key icon', () => {
    const { container } = renderWithProviders(
      <AuditActorCell row={{ user_email: null, api_token_id: 'tok-gone', api_token_name: null, api_token_prefix: null }} />,
    )
    expect(screen.getByText(LABELS.deletedToken)).toBeInTheDocument()
    expect(container.querySelector('i.ri-key-2-line')).not.toBeNull()
  })

  it('keeps showing the email for a user row, and the system label when there is none', () => {
    renderWithProviders(<AuditActorCell row={{ user_email: 'admin@example.com', api_token_id: null }} />)
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    cleanup()
    const { container } = renderWithProviders(<AuditActorCell row={{ user_email: null }} />)
    expect(screen.getByText(LABELS.system)).toBeInTheDocument()
    expect(container.querySelector('i.ri-key-2-line')).toBeNull()
  })
})

describe('auditActorText', () => {
  it('gives the CSV the same actor the grid shows', () => {
    expect(auditActorText({ api_token_id: 't', api_token_name: 'terraform', api_token_prefix: PREFIX }, LABELS)).toBe('terraform (pxc_Ab12Cd34)')
    expect(auditActorText({ api_token_id: 't', api_token_name: null, api_token_prefix: null }, LABELS)).toBe(LABELS.deletedToken)
    expect(auditActorText({ user_email: 'admin@example.com' }, LABELS)).toBe('admin@example.com')
    expect(auditActorText({ user_email: null }, LABELS)).toBe(LABELS.system)
  })
})
