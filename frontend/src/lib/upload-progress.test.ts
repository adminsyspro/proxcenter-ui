import { describe, it, expect, beforeEach } from 'vitest'

import { setProgress, getProgress, clearProgress } from './upload-progress'

const transferring = { bytesSent: 10, totalBytes: 100, status: 'transferring' as const }

beforeEach(() => {
  clearProgress('up-1')
})

describe('upload progress ownership', () => {
  it('serves an entry back to the user who opened the transfer', () => {
    setProgress('up-1', transferring, 'user-1')

    expect(getProgress('up-1', 'user-1')).toEqual(transferring)
  })

  it('hides an entry from another user', () => {
    setProgress('up-1', transferring, 'user-1')

    expect(getProgress('up-1', 'user-2')).toBeNull()
  })

  it('answers an unknown id exactly like a foreign one', () => {
    setProgress('up-1', transferring, 'user-1')

    expect(getProgress('up-1', 'user-2')).toBe(getProgress('never-existed', 'user-2'))
  })

  it('keeps the owner across the updates of the same upload', () => {
    setProgress('up-1', transferring, 'user-1')
    setProgress('up-1', { bytesSent: 100, totalBytes: 100, status: 'done' })

    expect(getProgress('up-1', 'user-1')).toEqual({ bytesSent: 100, totalBytes: 100, status: 'done' })
    expect(getProgress('up-1', 'user-2')).toBeNull()
  })

  it('leaves an ownerless entry readable by nobody', () => {
    setProgress('up-1', transferring)

    expect(getProgress('up-1', 'user-1')).toBeNull()
  })

  it('forgets an entry once cleared', () => {
    setProgress('up-1', transferring, 'user-1')
    clearProgress('up-1')

    expect(getProgress('up-1', 'user-1')).toBeNull()
  })
})
