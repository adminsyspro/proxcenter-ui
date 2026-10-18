/**
 * roadmap#38: the LDAP settings must say what the connection test did not
 * check, and the user lookup must name why a user is refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import { LdapTestChecks, LdapUserLookupDiagnostic } from './LdapDiagnostics'

const ADMINS = 'cn=dcvCenter Admins,ou=groups,dc=r38,dc=lab'
const NESTED = 'cn=vc-ops-nested,ou=groups,dc=r38,dc=lab'
const CONFIG = { url: 'ldap://bench', base_dn: 'dc=r38,dc=lab', group_attribute: 'memberOf' }

let lastBody: any = null

function diagnoseAnswers(body: unknown, status = 200) {
  lastBody = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      lastBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify(body), { status })
    }),
  )
}

function renderLookup(over: Partial<React.ComponentProps<typeof LdapUserLookupDiagnostic>> = {}) {
  return renderWithProviders(
    <LdapUserLookupDiagnostic
      config={CONFIG}
      groupMappings={[{ group: ' dcvCenter Admins ', role: 'role_operator' }, { group: '', role: 'role_viewer' }]}
      roleLabel={id => ({ role_operator: 'Operator', role_viewer: 'Viewer' } as Record<string, string>)[id] ?? id}
      {...over}
    />,
  )
}

async function lookUp(username: string) {
  fireEvent.change(screen.getByTestId('ldap-diag-username'), { target: { value: username } })
  fireEvent.click(screen.getByRole('button', { name: 'Look up user' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LdapTestChecks', () => {
  it('lists the checks and warns that a green test is not a sign-in', () => {
    renderWithProviders(
      <LdapTestChecks
        checks={[
          { id: 'connect', status: 'passed' },
          { id: 'user_filter', status: 'failed', detail: 'ldap: unexpected end of filter' },
          { id: 'user_lookup', status: 'not_checked' },
          { id: 'future_check', status: 'skipped' },
        ]}
      />,
    )
    expect(screen.getByText('Connection to the server')).toBeInTheDocument()
    expect(screen.getByText(/failed \(ldap: unexpected end of filter\)/)).toBeInTheDocument()
    expect(screen.getByText('Finding a user with the user filter')).toBeInTheDocument()
    expect(screen.getByText('future_check')).toBeInTheDocument()
    expect(screen.getByText(/A green test does not mean that a user can sign in/)).toBeInTheDocument()
  })

  it('renders nothing for an orchestrator that sends no checks', () => {
    const { container } = renderWithProviders(<LdapTestChecks checks={[]} />)
    expect(container.textContent).toBe('')
  })
})

describe('LdapUserLookupDiagnostic', () => {
  it('names a nested member excluded by the filter, with the role if admitted', async () => {
    diagnoseAnswers({
      success: true,
      data: {
        lookup: {
          status: 'not_found', filter: '(&(sAMAccountName=carol)(memberOf=CN=dcvCenter Admins,OU=Groups,DC=r38,DC=lab))',
          base_dn: 'dc=r38,dc=lab', username_placeholder: true, match_count: 0, password_checked: false,
          identity: { filter: '(sAMAccountName=carol)', match_count: 1, user: { dn: 'uid=carol', email: 'carol@r38.lab', name: 'Carol', groups: [NESTED] } },
          filter_groups: [{ group: 'CN=dcvCenter Admins,OU=Groups,DC=r38,DC=lab', recursive: false, evaluated: true, direct: false, via: [NESTED, ADMINS] }],
          nested_groups: [{ group: ADMINS, via: NESTED }],
          nested_truncated: true,
        },
        evaluation: {
          blocker: 'excluded_by_filter',
          subject: { dn: 'uid=carol', email: 'carol@r38.lab', name: 'Carol', groups: [NESTED] },
          allowedGroup: { enforced: false, allowed: null, nestedOnly: [] },
          role: { matchedGroup: null, roleId: null, defaultRoleId: 'role_viewer', nestedOnly: ['dcvCenter Admins'] },
          hints: ['nested_membership'],
        },
        account: { exists: false, email: 'carol@r38.lab' },
      },
    })
    renderLookup()
    await lookUp('carol')

    await waitFor(() => expect(screen.getByTestId('ldap-diag-verdict')).toHaveTextContent(/other clauses of the user filter exclude them/))
    expect(lastBody.test_username).toBe('carol')
    expect(lastBody.group_role_mapping).toEqual([{ group: 'dcvCenter Admins', role: 'role_operator' }])
    expect(screen.getByTestId('ldap-diag-clause')).toHaveTextContent(/nested member only \(cn=vc-ops-nested.* → cn=dcvCenter Admins/)
    expect(screen.getByTestId('ldap-diag-nested')).toBeInTheDocument()
    expect(screen.getByText(/nested group expansion stopped early/)).toBeInTheDocument()
    expect(screen.getByText('Role at sign-in, if the user were admitted')).toBeInTheDocument()
    expect(screen.getByTestId('ldap-diag-role')).toHaveTextContent('A new account gets the default role: Viewer')
    expect(screen.getByText(/therefore ignored: dcvCenter Admins/)).toBeInTheDocument()
    expect(screen.getByText(/No ProxCenter account for carol@r38.lab yet/)).toBeInTheDocument()
    expect(screen.getByTestId('ldap-diag-hint-nested_membership')).toHaveTextContent('1.2.840.113556.1.4.1941')
    expect(screen.getByText(/The password is not checked/)).toBeInTheDocument()
  })

  it('shows an admitted user with the mapped role and the allowed-group decision', async () => {
    diagnoseAnswers({
      success: true,
      data: {
        lookup: { status: 'found', filter: '(sAMAccountName=alice)', username_placeholder: true, match_count: 1, password_checked: false,
          user: { dn: 'uid=alice', email: 'alice@r38.lab', name: 'Alice', groups: [] } },
        evaluation: {
          blocker: null,
          subject: { dn: 'uid=alice', email: 'alice@r38.lab', name: 'Alice', groups: [] },
          allowedGroup: { enforced: true, allowed: true, nestedOnly: ['Other'] },
          role: { matchedGroup: 'dcvCenter Admins', roleId: 'role_operator', defaultRoleId: 'role_viewer', nestedOnly: [] },
          hints: [],
        },
        account: { exists: true, email: 'alice@r38.lab', enabled: false },
      },
    })
    renderLookup()
    await lookUp('alice')
    await waitFor(() => expect(screen.getByTestId('ldap-diag-verdict')).toHaveTextContent('Alice can sign in'))
    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.getByTestId('ldap-diag-allowed')).toHaveTextContent('Member of an allowed group.')
    expect(screen.getByText(/therefore not counted: Other/)).toBeInTheDocument()
    expect(screen.getByTestId('ldap-diag-role')).toHaveTextContent('Operator, from the mapping row dcvCenter Admins.')
    expect(screen.getByText(/exists for alice@r38.lab but is disabled/)).toBeInTheDocument()
  })

  it('lists the entries of an ambiguous match and keeps an existing role', async () => {
    diagnoseAnswers({
      success: true,
      data: {
        lookup: { status: 'ambiguous', filter: '(uid=dup)', username_placeholder: true, match_count: 5, more: true, password_checked: false,
          matches: ['uid=dup,ou=people', 'uid=dup,ou=contractors'],
          filter_groups: [{ group: 'CN=X', recursive: true, evaluated: false, direct: false }, { group: 'CN=Y', recursive: false, evaluated: false, direct: false }] },
        evaluation: { blocker: 'ambiguous', subject: null, allowedGroup: null, role: null, hints: [] },
        account: null,
      },
    })
    renderLookup()
    await lookUp('dup')
    await waitFor(() => expect(screen.getByTestId('ldap-diag-verdict')).toHaveTextContent('Several entries match'))
    expect(screen.getByText('uid=dup,ou=contractors')).toBeInTheDocument()
    expect(screen.getByText(/\(and more\)/)).toBeInTheDocument()
    expect(screen.getAllByTestId('ldap-diag-clause')[0]).toHaveTextContent('recursive clause, resolved by Active Directory')
    expect(screen.getAllByTestId('ldap-diag-clause')[1]).toHaveTextContent('not evaluated')
  })

  it('names the failing step and the invalid filter', async () => {
    diagnoseAnswers({ success: true, data: { lookup: { status: 'error', stage: 'bind', error: 'Invalid credentials for service account.', username_placeholder: true, match_count: 0, password_checked: false }, evaluation: { blocker: 'lookup_error', subject: null, allowedGroup: null, role: null, hints: [] }, account: null } })
    renderLookup()
    await lookUp('alice')
    await waitFor(() => expect(screen.getByTestId('ldap-diag-verdict')).toHaveTextContent('failed at the service account bind step: Invalid credentials for service account.'))
    cleanup()

    diagnoseAnswers({ success: true, data: { lookup: { status: 'invalid_filter', error: 'ldap: unexpected end of filter', username_placeholder: false, match_count: 0, password_checked: false }, evaluation: { blocker: 'invalid_filter', subject: null, allowedGroup: null, role: null, hints: [] }, account: null } })
    renderLookup()
    await lookUp('alice')
    await waitFor(() => expect(screen.getByTestId('ldap-diag-verdict')).toHaveTextContent('The user filter is invalid, every LDAP sign-in fails: ldap: unexpected end of filter'))
  })

  it('explains an outdated orchestrator and other failures', async () => {
    diagnoseAnswers({ success: false, error: 'orchestrator_outdated' }, 501)
    renderLookup()
    await lookUp('alice')
    await waitFor(() => expect(screen.getByText(/orchestrator is too old/)).toBeInTheDocument())
    cleanup()

    diagnoseAnswers({ success: false, error: 'orchestrator_error', detail: 'HTTP 500 boom' }, 502)
    renderLookup()
    await lookUp('alice')
    await waitFor(() => expect(screen.getByText('The diagnostic failed: HTTP 500 boom')).toBeInTheDocument())
    cleanup()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    renderLookup()
    await lookUp('alice')
    await waitFor(() => expect(screen.getByText('The diagnostic failed: offline')).toBeInTheDocument())
  })

  it('keeps the button disabled without a username, and runs on Enter', async () => {
    diagnoseAnswers({ success: false, error: 'username_required' }, 400)
    renderLookup()
    expect(screen.getByRole('button', { name: 'Look up user' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('ldap-diag-username'), { target: { value: 'bob' } })
    fireEvent.keyDown(screen.getByTestId('ldap-diag-username'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Enter a test username.')).toBeInTheDocument())
  })
})
