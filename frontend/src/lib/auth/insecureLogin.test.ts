import { describe, expect, it, vi } from 'vitest'

import { droppedSessionHttpsAddress, httpsAddress } from '@/lib/auth/insecureLogin'

const page = { hostname: '172.17.0.188', pathname: '/login', search: '?callbackUrl=%2Fhome' }

describe('httpsAddress', () => {
  it('keeps the host, path and query and drops the HTTP port', () => {
    expect(httpsAddress(page)).toBe('https://172.17.0.188/login?callbackUrl=%2Fhome')
  })
})

describe('droppedSessionHttpsAddress', () => {
  it('REGRESSION: points to HTTPS when the browser dropped the session on a plain-HTTP page', async () => {
    await expect(droppedSessionHttpsAddress(false, page, async () => null)).resolves.toBe(
      'https://172.17.0.188/login?callbackUrl=%2Fhome'
    )
  })

  it('treats a failed session read as no session', async () => {
    await expect(
      droppedSessionHttpsAddress(false, page, async () => {
        throw new Error('network')
      })
    ).resolves.toBe('https://172.17.0.188/login?callbackUrl=%2Fhome')
  })

  it('stays silent when the session exists over HTTP (an install still on http URLs)', async () => {
    await expect(droppedSessionHttpsAddress(false, page, async () => ({ user: { id: 'u1' } }))).resolves.toBeNull()
  })

  it('never reads the session on a secure page', async () => {
    const readSession = vi.fn()

    await expect(droppedSessionHttpsAddress(true, page, readSession)).resolves.toBeNull()
    expect(readSession).not.toHaveBeenCalled()
  })
})
