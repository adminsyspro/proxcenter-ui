import { describe, it, expect, beforeEach, vi } from 'vitest'

const { getPrincipalMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: getPrincipalMock }))

import { runResolvingPrincipal, isResolvingPrincipal } from '@/lib/auth/principalResolution'
import { actorHeaders, ACTOR_EMAIL_HEADER } from './actor'

beforeEach(() => {
  getPrincipalMock.mockReset()
})

// The attribution itself is covered by headers.test.ts; this file covers the
// re-entrancy guard only.
describe('actorHeaders, principal resolution guard', () => {
  // roadmap#208: resolving again from inside a resolution re-entered the
  // token license check forever.
  it('leaves the call unattributed, without resolving, inside a principal resolution', async () => {
    const out = await runResolvingPrincipal(async () => {
      expect(isResolvingPrincipal()).toBe(true)
      return actorHeaders()
    })
    expect(out).toEqual({})
    expect(getPrincipalMock).not.toHaveBeenCalled()
  })

  it('does not carry the mark past the end of the resolution', async () => {
    await runResolvingPrincipal(async () => undefined)
    expect(isResolvingPrincipal()).toBe(false)
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: 'token', tokenId: 'tok-2' } })
    expect(await actorHeaders()).toEqual({ [ACTOR_EMAIL_HEADER]: 'token:tok-2' })
  })
})
