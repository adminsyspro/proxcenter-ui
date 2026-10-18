/**
 * The themed dialog that replaced the native alert() of the DRS page when a
 * recommendation action does not go through (roadmap#71).
 *
 * next-intl is mocked to echo the key.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import DrsActionNoticeDialog from './DrsActionNoticeDialog'

afterEach(() => cleanup())

describe('DrsActionNoticeDialog', () => {
  it('stays closed without a message', () => {
    render(<DrsActionNoticeDialog message={null} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the reason under a themed title and closes on its button', () => {
    const onClose = vi.fn()

    render(<DrsActionNoticeDialog message='a rolling update is in progress on this cluster' onClose={onClose} />)

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent('drsPage.actionNoticeTitle')
    expect(dialog).toHaveTextContent('a rolling update is in progress on this cluster')
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
