/**
 * The sudoers check lines of Test SSH: a node without sudo, without rights,
 * with a sudo too old, or with a file lacking some rules each get the line
 * that says what to do.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import SudoCheckLines, { NotDeployedLine, profilesAbsentEverywhere, uniformSudoCheck } from './SudoCheckLines'

afterEach(cleanup)

const FULL = { checked: 2, missing: [] }

describe('SudoCheckLines', () => {
  it('says sudo is missing', () => {
    renderWithProviders(<SudoCheckLines check={{ status: 'missing', version: null, profiles: {} }} user='proxcenter' />)
    expect(screen.getByText(/sudo is not installed/)).toBeTruthy()
  })

  it('says the account has no rights', () => {
    renderWithProviders(<SudoCheckLines check={{ status: 'no-rights', version: 'Sudo version 1.9.16p2', profiles: {} }} user='proxcenter' />)
    expect(screen.getByText(/proxcenter has no sudo rights/)).toBeTruthy()
  })

  it('lists the profiles, the missing features and the rules the file lacks', () => {
    renderWithProviders(
      <SudoCheckLines
        user='proxcenter'
        check={{
          status: 'too-old',
          version: 'Sudo version 1.9.5p2',
          profiles: {
            'node-ops': FULL,
            'site-recovery': { checked: 3, missing: [{ id: 'a', usedBy: 'Replication > ZFS' }, { id: 'b', usedBy: 'Replication > ZFS' }] },
            migrations: { checked: 1, missing: [{ id: 'pxc-migrations', usedBy: 'Migrations' }] },
          },
        }}
      />,
    )

    expect(screen.getByText(/needs sudo 1\.9\.10 or later/)).toBeTruthy()
    expect(screen.getByText(/✓ · .* 1\/3 · .* ✗/)).toBeTruthy()
    expect(screen.getByText(/2 rules are missing from the sudoers file \(Replication > ZFS\)/)).toBeTruthy()
  })
  it('asks to regenerate a file that allows more than the rules', () => {
    renderWithProviders(
      <SudoCheckLines
        user='proxcenter'
        check={{ status: 'ok', version: 'Sudo version 1.9.16p2', profiles: { 'node-ops': FULL }, tooOpen: [{ id: 'ui-sflow-configure', usedBy: 'Network Flows > Configure sFlow' }] }}
      />,
    )
    expect(screen.getByText(/still allows more than ProxCenter needs \(Network Flows > Configure sFlow\)/)).toBeTruthy()
  })
})

const OK = (migrations: boolean) => ({
  status: 'ok' as const,
  version: 'Sudo version 1.9.16p2',
  profiles: {
    'node-ops': FULL,
    'site-recovery': FULL,
    migrations: { checked: 1, missing: migrations ? [] : [{ id: 'pxc-migrations', usedBy: 'Migrations' }] },
  },
})

describe('several nodes', () => {
  it('sums up nodes that answered alike, and only them', () => {
    expect(uniformSudoCheck([{ status: 'ok', sudoCheck: OK(false) }, { status: 'ok', sudoCheck: OK(false) }, { status: 'error' }])).toEqual(OK(false))
    expect(uniformSudoCheck([{ status: 'ok', sudoCheck: OK(false) }, { status: 'ok', sudoCheck: OK(true) }])).toBeNull()
    expect(uniformSudoCheck([{ status: 'ok', sudoCheck: OK(false) }, { status: 'ok' }])).toBeNull()
    expect(uniformSudoCheck([{ status: 'ok', sudoCheck: OK(false) }])).toBeNull()
  })

  it('treats a profile no node holds as not deployed', () => {
    expect(profilesAbsentEverywhere([OK(false), OK(false)])).toEqual(['migrations'])
    expect(profilesAbsentEverywhere([OK(false), OK(true)])).toEqual([])
    expect(profilesAbsentEverywhere([{ status: 'missing', version: null, profiles: {} }])).toEqual([])
  })

  it('says it once, in grey for a profile not deployed, in orange for a node lacking one', () => {
    renderWithProviders(<SudoCheckLines check={OK(false)} user='proxcenter' absentEverywhere={['migrations']} summaryCount={3} />)
    expect(screen.getByText(/sudo profiles on the 3 nodes/)).toBeTruthy()
    expect(screen.getByText(/^Not deployed: /)).toBeTruthy()
    expect(screen.queryByText(/Unavailable on this node/)).toBeNull()
    cleanup()
    renderWithProviders(<SudoCheckLines check={OK(false)} user='proxcenter' />)
    expect(screen.getByText(/Unavailable on this node/)).toBeTruthy()
  })
  it('leaves the not deployed line to the one above the nodes when they differ', () => {
    renderWithProviders(
      <>
        <NotDeployedLine profiles={['migrations']} />
        <SudoCheckLines check={OK(false)} user='proxcenter' absentEverywhere={['migrations']} showNotDeployed={false} />
      </>,
    )
    expect(screen.getAllByText(/^Not deployed: /)).toHaveLength(1)
    cleanup()
    renderWithProviders(<NotDeployedLine profiles={[]} />)
    expect(screen.queryByText(/^Not deployed: /)).toBeNull()
  })
})
