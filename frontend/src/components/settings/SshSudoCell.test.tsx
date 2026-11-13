/**
 * The Sudo column of the PVE connections list: it tells, from the settings of
 * each connection, whether privileged commands run as root, through sudo, or
 * cannot run at all (dedicated account without sudo).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import SshSudoCell, { sudoMode } from './SshSudoCell'

afterEach(cleanup)

describe('sudoMode', () => {
  it('reads the mode from the SSH settings', () => {
    expect(sudoMode({ sshEnabled: false, sshUser: 'proxcenter', sshUseSudo: true })).toBe('none')
    expect(sudoMode({ sshEnabled: true, sshUser: 'root', sshUseSudo: true })).toBe('root')
    expect(sudoMode({ sshEnabled: true, sshUser: '', sshUseSudo: false })).toBe('root')
    expect(sudoMode({ sshEnabled: true, sshUser: 'proxcenter', sshUseSudo: true })).toBe('sudo')
    expect(sudoMode({ sshEnabled: true, sshUser: 'proxcenter', sshUseSudo: false })).toBe('plain')
    expect(sudoMode(undefined)).toBe('none')
  })
})

describe('SshSudoCell', () => {
  it('shows a sudo chip for a dedicated account with sudo', () => {
    renderWithProviders(<SshSudoCell connection={{ sshEnabled: true, sshUser: 'proxcenter', sshUseSudo: true }} />)

    expect(screen.getByText('sudo')).toBeTruthy()
  })

  it('warns about a dedicated account without sudo', () => {
    renderWithProviders(<SshSudoCell connection={{ sshEnabled: true, sshUser: 'proxcenter', sshUseSudo: false }} />)

    expect(screen.getByText('No sudo')).toBeTruthy()
  })

  it('shows root, and a dash without SSH', () => {
    renderWithProviders(<SshSudoCell connection={{ sshEnabled: true, sshUser: 'root', sshUseSudo: false }} />)
    expect(screen.getByText('root')).toBeTruthy()
    cleanup()
    renderWithProviders(<SshSudoCell connection={{ sshEnabled: false }} />)
    expect(screen.getByText('-')).toBeTruthy()
  })
})
