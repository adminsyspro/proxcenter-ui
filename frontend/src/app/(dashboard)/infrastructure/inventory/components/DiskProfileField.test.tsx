/** ui#1331: the disk profile row of the migration dialogs. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import DiskProfileField from './DiskProfileField'
import { DEFAULT_DISK_PROFILE } from './migrationReview'

afterEach(() => cleanup())

describe('DiskProfileField', () => {
  it('starts on discard and IO thread, and toggles one option per click', () => {
    const onChange = vi.fn()
    renderWithProviders(<DiskProfileField value={DEFAULT_DISK_PROFILE} onChange={onChange} />)
    expect(screen.getByTestId('disk-profile-discard').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('disk-profile-iothread').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('disk-profile-ssd').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByTestId('disk-profile-ssd'))
    expect(onChange).toHaveBeenCalledWith({ discard: true, iothread: true, ssd: true })
  })
})
