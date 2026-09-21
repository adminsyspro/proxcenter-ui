import { describe, expect, it } from 'vitest'

import { isHostKeyMismatch } from './hostKeyMismatch'

// The Re-trust button hangs off this predicate: too loose and every red row
// invites an operator to drop a pin, too strict and the one failure they can
// actually fix keeps sending them to a database client (#979).
describe('isHostKeyMismatch', () => {
  it('recognises the orchestrator wording', () => {
    expect(
      isHostKeyMismatch(
        'SSH connection failed: ssh: handshake failed: ssh host-key mismatch for "10.0.0.1": pinned ecdsa-sha2-nistp256, presented ecdsa-sha2-nistp256. Refusing to connect.'
      )
    ).toBe(true)
  })

  it('recognises the ssh2 wording, which spells the separator differently', () => {
    expect(isHostKeyMismatch('SSH host key mismatch for 10.0.0.1: pinned ssh-ed25519, presented ssh-rsa.')).toBe(true)
    expect(isHostKeyMismatch('host_key mismatch')).toBe(true)
  })

  it('ignores the case of the message', () => {
    expect(isHostKeyMismatch('HOST-KEY MISMATCH for 10.0.0.1')).toBe(true)
  })

  it.each([
    ['an authentication failure', 'ssh: handshake failed: ssh: unable to authenticate, attempted methods [none publickey]'],
    ['an unreachable host', 'connect ETIMEDOUT 10.0.0.1:22'],
    ['a permission error', 'Permission denied (publickey)'],
    ['a mismatch of something else', 'fingerprint mismatch'],
  ])('does not offer to drop the pin on %s', (_label, error) => {
    expect(isHostKeyMismatch(error)).toBe(false)
  })

  it('treats a missing error as no mismatch, so an ok row never grows a button', () => {
    expect(isHostKeyMismatch()).toBe(false)
    expect(isHostKeyMismatch('')).toBe(false)
  })
})
