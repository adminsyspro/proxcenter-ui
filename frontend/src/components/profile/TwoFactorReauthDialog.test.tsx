/**
 * roadmap#280: removing or replacing the second factor asks for the password
 * AND a code (authenticator or recovery); an SSO account gives the code alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import TwoFactorReauthDialog, { isSecondFactorCode } from './TwoFactorReauthDialog'

afterEach(() => cleanup())

function open(passwordRequired?: boolean) {
  const onConfirm = vi.fn()
  renderWithProviders(
    <TwoFactorReauthDialog open onClose={() => {}} onConfirm={onConfirm} title='Disable'
      {...(passwordRequired === undefined ? {} : { passwordRequired })} />,
  )
  return onConfirm
}

const confirm = () => screen.getByRole('button', { name: 'Confirm' })
const passwordField = () => screen.getByLabelText('Password')
const codeField = () => screen.getByLabelText('Authenticator or recovery code')

describe('TwoFactorReauthDialog', () => {
  it('needs both the password and a code before it confirms', async () => {
    const onConfirm = open()
    expect(confirm()).toBeDisabled()

    await userEvent.type(passwordField(), 'secret')
    expect(confirm()).toBeDisabled()

    await userEvent.type(codeField(), '123456')
    expect(confirm()).toBeEnabled()

    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith({ password: 'secret', totpCode: '123456' })
  })

  it('takes a recovery code, sent upper-cased', async () => {
    const onConfirm = open()
    await userEvent.type(passwordField(), 'secret')
    await userEvent.type(codeField(), 'y4gqt-8tt5q')
    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith({ password: 'secret', totpCode: 'Y4GQT-8TT5Q' })
  })

  it('keeps a code alone refused when the account has a password', async () => {
    open()
    await userEvent.type(codeField(), '123456')
    expect(confirm()).toBeDisabled()
  })

  it('asks an account without a local password for the code only', async () => {
    const onConfirm = open(false)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    await userEvent.type(codeField(), '654321{Enter}')
    expect(onConfirm).toHaveBeenCalledWith({ totpCode: '654321' })
  })
})

describe('isSecondFactorCode', () => {
  it('accepts a 6-digit code or a recovery code and nothing else', () => {
    expect(isSecondFactorCode('123456')).toBe(true)
    expect(isSecondFactorCode(' abcde-fgh23 ')).toBe(true)
    expect(isSecondFactorCode('12345')).toBe(false)
    expect(isSecondFactorCode('ABCDE-FGH1O')).toBe(false)
    expect(isSecondFactorCode('')).toBe(false)
  })
})
