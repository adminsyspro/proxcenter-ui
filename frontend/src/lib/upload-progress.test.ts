import { describe, it, expect, beforeEach } from 'vitest'

import { setProgress, getProgress, clearProgress } from './upload-progress'

const transferring = { bytesSent: 10, totalBytes: 100, status: 'transferring' as const }

beforeEach(() => {
  clearProgress('up-1')
  clearProgress('up-2')
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

describe("a stopped transfer stays stopped", () => {
  // #974: the DELETE that stops an upload and the chunk loop that reports
  // progress are two different requests. The loop is inside an await when the
  // stop lands, and its next tick used to write "transferring" over the
  // outcome, so a reloaded page polled a transfer that no longer existed.
  it("ignores a later transferring update once the upload was cancelled", () => {
    setProgress("up-1", { bytesSent: 10, totalBytes: 100, status: "transferring" }, "user-1")
    setProgress("up-1", { bytesSent: 10, totalBytes: 100, status: "cancelled" })
    setProgress("up-1", { bytesSent: 20, totalBytes: 100, status: "transferring" })

    expect(getProgress("up-1", "user-1")?.status).toBe("cancelled")
  })

  it("keeps a finished or failed transfer too, and still lets a new outcome land", () => {
    setProgress("up-2", { bytesSent: 10, totalBytes: 100, status: "transferring" }, "user-1")
    setProgress("up-2", { bytesSent: 100, totalBytes: 100, status: "done" })
    setProgress("up-2", { bytesSent: 50, totalBytes: 100, status: "transferring" })
    expect(getProgress("up-2", "user-1")?.status).toBe("done")

    setProgress("up-2", { bytesSent: 100, totalBytes: 100, status: "error", error: "boom" })
    expect(getProgress("up-2", "user-1")?.status).toBe("error")
  })
})
